package net.nexventures.nfc_terminal

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encrypted cache of what the HCE service serves (Part 4 §3): primary card share_id,
 * share key (key_id + secret), public URL and flags. AES-256-GCM with a non-exportable
 * Android Keystore key; ciphertext in private SharedPreferences. Written by Dart via
 * the `hce` MethodChannel, read by [CardHostApduService]. Wiped on sign-out.
 */
class ShareCacheStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("nfc_share_cache", Context.MODE_PRIVATE)

    fun save(json: JSONObject) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
        val blob = cipher.iv + ct
        prefs.edit().putString(PREF, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
    }

    fun clear() {
        prefs.edit().remove(PREF).apply()
    }

    fun hasCache(): Boolean = prefs.contains(PREF)

    fun load(): CardCache? = try {
        val raw = prefs.getString(PREF, null) ?: return null
        val blob = Base64.decode(raw, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob.copyOfRange(0, 12)))
        val j = JSONObject(String(cipher.doFinal(blob.copyOfRange(12, blob.size)), Charsets.UTF_8))
        CardCache(
            shareId = DigitalCardToken.uuidBytes(j.getString("share_id")),
            keyId = j.getLong("key_id"),
            secret = Base64.decode(j.getString("secret"), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP),
            publicUrl = j.optString("public_url").ifBlank { null },
            webPageEnabled = j.optBoolean("web_page_enabled", false),
            nfcSharingEnabled = j.optBoolean("nfc_sharing_enabled", true),
        )
    } catch (_: Exception) {
        null // corrupt/invalidated key → behave as "not sharing"
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    companion object {
        private const val ALIAS = "nfc_terminal_share_cache"
        private const val PREF = "cache"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}
