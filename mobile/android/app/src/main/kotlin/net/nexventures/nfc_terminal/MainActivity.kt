package net.nexventures.nfc_terminal

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.cardemulation.CardEmulation
import android.nfc.tech.IsoDep
import android.nfc.tech.MifareUltralight
import android.nfc.tech.NfcA
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File

class MainActivity : FlutterActivity() {
    private var linksChannel: MethodChannel? = null
    private var tagsChannel: MethodChannel? = null
    private val main = Handler(Looper.getMainLooper())

    /** Pairing deep link that launched the app, handed to Dart once. */
    private var initialLink: String? = null

    /** Dispatched tags not yet taken by Dart (buffered until Dart is ready). */
    private val pendingTags = mutableListOf<Map<String, Any?>>()
    private var dartTagsReady = false

    /** Not visible (cold start or in background) → a dispatched tag "launched" us. */
    private var stopped = true
    private var pendingPermissionResult: MethodChannel.Result? = null
    private var notificationId = 1000

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Launch intent: the activity was not in the foreground.
        if (savedInstanceState == null) handleTagIntent(intent, fromBackground = true)
    }

    override fun onStart() {
        super.onStart()
        stopped = false
    }

    override fun onStop() {
        super.onStop()
        stopped = true
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val messenger = flutterEngine.dartExecutor.binaryMessenger
        MethodChannel(messenger, SETTINGS_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "openNfcSettings" -> result.success(openSettings(Intent(Settings.ACTION_NFC_SETTINGS)))
                "openAppSettings" -> result.success(
                    openSettings(
                        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            .setData(Uri.fromParts("package", packageName, null))
                    )
                )
                else -> result.notImplemented()
            }
        }
        initialLink = pairingLink(intent)
        linksChannel = MethodChannel(messenger, LINKS_CHANNEL).apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    "getInitialLink" -> {
                        result.success(initialLink)
                        initialLink = null
                    }
                    else -> result.notImplemented()
                }
            }
        }
        MethodChannel(messenger, HCE_CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "isSupported" -> result.success(
                    NfcAdapter.getDefaultAdapter(this) != null &&
                        packageManager.hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)
                )
                "setCache" -> {
                    val m = call.arguments as? Map<*, *>
                    if (m == null) result.error("bad_args", "map expected", null) else {
                        ShareCacheStore(this).save(JSONObject(m))
                        result.success(null)
                    }
                }
                "clearCache" -> {
                    ShareCacheStore(this).clear()
                    result.success(null)
                }
                "setServiceEnabled" -> {
                    setComponent(hceComponent(), call.arguments == true)
                    result.success(null)
                }
                "isServiceEnabled" -> result.success(
                    packageManager.getComponentEnabledSetting(hceComponent()) ==
                        PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                )
                "setPreferred" -> result.success(setPreferredHce(call.arguments == true))
                else -> result.notImplemented()
            }
        }
        MethodChannel(messenger, CONTACTS_CHANNEL).setMethodCallHandler { call, result ->
            val vcard = call.argument<String>("vcard")
            val name = (call.argument<String>("name") ?: "contact").replace(Regex("[^A-Za-z0-9_-]"), "_").take(40)
            if (vcard == null) {
                result.error("bad_args", "vcard missing", null)
                return@setMethodCallHandler
            }
            try {
                val dir = File(cacheDir, "shared").apply { mkdirs() }
                val file = File(dir, "$name.vcf").apply { writeText(vcard) }
                val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
                val intent = when (call.method) {
                    "saveVcard" -> Intent(Intent.ACTION_VIEW).setDataAndType(uri, "text/x-vcard")
                    "shareVcard" -> Intent.createChooser(
                        Intent(Intent.ACTION_SEND).setType("text/x-vcard").putExtra(Intent.EXTRA_STREAM, uri),
                        "Share contact",
                    )
                    else -> {
                        result.notImplemented()
                        return@setMethodCallHandler
                    }
                }
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                startActivity(intent)
                result.success(true)
            } catch (e: Exception) {
                result.success(false)
            }
        }
        tagsChannel = MethodChannel(messenger, TAGS_CHANNEL).apply {
            setMethodCallHandler { call, result ->
                when (call.method) {
                    "takePendingTags" -> {
                        dartTagsReady = true
                        result.success(ArrayList(pendingTags))
                        pendingTags.clear()
                    }
                    "setDispatchEnabled" -> {
                        setAliasEnabled(call.arguments == true)
                        result.success(null)
                    }
                    "isDispatchEnabled" -> result.success(isAliasEnabled())
                    "showNotification" -> {
                        showNotification(call.argument<String>("title") ?: "", call.argument<String>("body") ?: "")
                        result.success(null)
                    }
                    "requestNotificationPermission" -> requestNotificationPermission(result)
                    "moveToBack" -> result.success(moveTaskToBack(true))
                    else -> result.notImplemented()
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pairingLink(intent)?.let { linksChannel?.invokeMethod("onLink", it) }
        // singleTop: later taps arrive here. Android pauses (not stops) a visible
        // activity before onNewIntent, so `stopped` tells foreground from background.
        handleTagIntent(intent, fromBackground = stopped)
    }

    // ------------------------------------------------------------ tag dispatch --

    private fun handleTagIntent(intent: Intent?, fromBackground: Boolean) {
        val action = intent?.action ?: return
        if (action != NfcAdapter.ACTION_TECH_DISCOVERED &&
            action != NfcAdapter.ACTION_TAG_DISCOVERED &&
            action != NfcAdapter.ACTION_NDEF_DISCOVERED
        ) return
        val tag: Tag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG, Tag::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(NfcAdapter.EXTRA_TAG)
        } ?: return
        // Consume it so a config change / re-delivery doesn't process it twice.
        intent.removeExtra(NfcAdapter.EXTRA_TAG)
        intent.action = Intent.ACTION_MAIN

        // Probe on a worker thread (I/O with the tag), then hand to Dart on main.
        Thread {
            val data = tagToMap(tag, fromBackground)
            main.post { deliverTag(data) }
        }.start()
    }

    private fun deliverTag(data: Map<String, Any?>) {
        val channel = tagsChannel
        if (dartTagsReady && channel != null) {
            channel.invokeMethod("onTag", data)
        } else {
            pendingTags.add(data)
        }
    }

    private fun tagToMap(tag: Tag, fromBackground: Boolean): Map<String, Any?> {
        val uid = tag.id?.joinToString("") { "%02X".format(it) } ?: ""
        val techs = tag.techList.toList()
        var sak: Int? = null
        var atqa: String? = null
        var productType: Int? = null
        val digitalToken = if (techs.contains(IsoDep::class.java.name)) probeDigitalCard(tag) else null
        if (digitalToken != null) {
            return mapOf("uid" to uid, "techList" to techs, "digitalCardToken" to digitalToken,
                "fromBackground" to fromBackground)
        }
        NfcA.get(tag)?.let { nfcA ->
            sak = nfcA.sak.toInt()
            atqa = nfcA.atqa?.joinToString("") { "%02X".format(it) }
            val type2 = techs.contains(MifareUltralight::class.java.name) || nfcA.sak.toInt() == 0
            if (type2 && !techs.contains("android.nfc.tech.IsoDep")) {
                productType = getVersionProductType(nfcA)
            }
        }
        return mapOf(
            "uid" to uid,
            "techList" to techs,
            "sak" to sak,
            "atqa" to atqa,
            "productType" to productType,
            "fromBackground" to fromBackground,
        )
    }

    /** NXP GET_VERSION: byte 2 = product type (0x03 Ultralight, 0x04 NTAG). Best effort. */
    private fun getVersionProductType(nfcA: NfcA): Int? = try {
        nfcA.connect()
        nfcA.timeout = 300
        val r = nfcA.transceive(byteArrayOf(0x60))
        if (r.size >= 8) r[2].toInt() and 0xFF else null
    } catch (_: Exception) {
        null
    } finally {
        try { nfcA.close() } catch (_: Exception) {}
    }

    /**
     * Part 4 §3 reader side: SELECT the digital-card AID (150 ms). Returns the base64url token
     * when the tag is a phone sharing a digital card, else null (→ normal UID flow).
     */
    private fun probeDigitalCard(tag: Tag): String? {
        val iso = IsoDep.get(tag) ?: return null
        return try {
            iso.connect()
            iso.timeout = 150
            val r = iso.transceive(ApduHandler.hex("00A4040007F04E464344430100"))
            val ok = r.size == 5 + DigitalCardToken.LENGTH + 2 &&
                String(r.copyOfRange(0, 5), Charsets.US_ASCII) == "NFCDC" &&
                r[r.size - 2] == 0x90.toByte() && r[r.size - 1] == 0x00.toByte()
            if (!ok) null else android.util.Base64.encodeToString(
                r.copyOfRange(5, 5 + DigitalCardToken.LENGTH),
                android.util.Base64.URL_SAFE or android.util.Base64.NO_PADDING or android.util.Base64.NO_WRAP,
            )
        } catch (_: Exception) {
            null
        } finally {
            try { iso.close() } catch (_: Exception) {}
        }
    }

    private fun hceComponent() = ComponentName(this, CardHostApduService::class.java)

    private fun setComponent(component: ComponentName, enabled: Boolean) {
        packageManager.setComponentEnabledSetting(
            component,
            if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }

    /** While the Share screen is visible, prefer our service over other apps with the same AIDs. */
    private fun setPreferredHce(preferred: Boolean): Boolean = try {
        val adapter = NfcAdapter.getDefaultAdapter(this) ?: return false
        val ce = CardEmulation.getInstance(adapter)
        if (preferred) ce.setPreferredService(this, hceComponent()) else ce.unsetPreferredService(this)
    } catch (_: Exception) {
        false
    }

    private fun aliasComponent() = ComponentName(this, "$packageName.NfcTagLauncher")

    private fun setAliasEnabled(enabled: Boolean) {
        packageManager.setComponentEnabledSetting(
            aliasComponent(),
            if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED
            else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
            PackageManager.DONT_KILL_APP,
        )
    }

    private fun isAliasEnabled(): Boolean =
        packageManager.getComponentEnabledSetting(aliasComponent()) ==
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED

    // ----------------------------------------------------------- notifications --

    private fun showNotification(title: String, body: String) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return // denied: background reading still works, just silently
        val nm = getSystemService(NotificationManager::class.java) ?: return
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(NOTIFICATION_CHANNEL, "Card reads", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "Result of cards read while the app was in the background"
                }
            )
            Notification.Builder(this, NOTIFICATION_CHANNEL)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
            android.app.PendingIntent.getActivity(
                this, 0, it,
                android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }
        val n = builder
            .setSmallIcon(R.drawable.ic_stat_card)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .apply { if (open != null) setContentIntent(open) }
            .build()
        // Keep only the last few results visible.
        notificationId = if (notificationId >= 1004) 1000 else notificationId + 1
        nm.notify(notificationId, n)
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            result.success(true)
            return
        }
        pendingPermissionResult?.success(false)
        pendingPermissionResult = result
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_NOTIFICATIONS) {
            pendingPermissionResult?.success(grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED)
            pendingPermissionResult = null
        }
    }

    // ------------------------------------------------------------------- misc --

    /** Only `nfcterminal://pair|login|card...` VIEW intents are forwarded. */
    private fun pairingLink(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        val data = intent.data ?: return null
        if (data.scheme != "nfcterminal" || data.host !in setOf("pair", "login", "card")) return null
        return data.toString()
    }

    /** Opens a settings screen, falling back to wireless / general settings. */
    private fun openSettings(primary: Intent): Boolean {
        val candidates = listOf(primary, Intent(Settings.ACTION_WIRELESS_SETTINGS), Intent(Settings.ACTION_SETTINGS))
        for (candidate in candidates) {
            try {
                startActivity(candidate.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return true
            } catch (_: ActivityNotFoundException) {
                // try next
            }
        }
        return false
    }

    companion object {
        private const val SETTINGS_CHANNEL = "net.nexventures.nfc_terminal/settings"
        private const val LINKS_CHANNEL = "net.nexventures.nfc_terminal/links"
        private const val TAGS_CHANNEL = "net.nexventures.nfc_terminal/tags"
        private const val HCE_CHANNEL = "net.nexventures.nfc_terminal/hce"
        private const val CONTACTS_CHANNEL = "net.nexventures.nfc_terminal/contacts"
        private const val NOTIFICATION_CHANNEL = "card_reads"
        private const val REQUEST_NOTIFICATIONS = 4711
    }
}
