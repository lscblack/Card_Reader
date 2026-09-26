package net.nexventures.nfc_terminal

/** What the HCE service serves; loaded from the encrypted share cache. */
class CardCache(
    val shareId: ByteArray,
    val keyId: Long,
    val secret: ByteArray,
    /** Public card page, e.g. https://web/p/jane (served as `?via=nfc`). */
    val publicUrl: String?,
    val webPageEnabled: Boolean,
    val nfcSharingEnabled: Boolean,
)

/**
 * Pure APDU state machine for the two AIDs of Part 4 §3 (no Android classes, unit-tested on the JVM).
 *
 * A. F04E4643444301 → "NFCDC" ‖ fresh 41-byte token ‖ 9000
 * B. D2760000850101 → NFC Forum Type 4 Tag (CC E103, NDEF E104, READ BINARY), one URI record.
 */
class ApduHandler(
    private val cacheProvider: () -> CardCache?,
    private val clockSeconds: () -> Long = { System.currentTimeMillis() / 1000 },
) {
    private enum class App { NONE, DIGITAL, T4T }
    private enum class File { NONE, CC, NDEF }

    private var app = App.NONE
    private var file = File.NONE
    private var ndefFile: ByteArray = ByteArray(0)

    fun reset() {
        app = App.NONE
        file = File.NONE
        ndefFile = ByteArray(0)
    }

    fun process(apdu: ByteArray): ByteArray {
        if (apdu.size < 4) return SW_WRONG_LENGTH
        val cla = apdu[0].toInt() and 0xFF
        val ins = apdu[1].toInt() and 0xFF
        if (cla != 0x00) return SW_CLA_NOT_SUPPORTED
        return when (ins) {
            0xA4 -> select(apdu)
            0xB0 -> readBinary(apdu)
            0xD6 -> if (app == App.T4T) SW_SECURITY_NOT_SATISFIED else SW_CONDITIONS_NOT_SATISFIED // read-only
            else -> SW_INS_NOT_SUPPORTED
        }
    }

    private fun select(apdu: ByteArray): ByteArray {
        if (apdu.size < 5) return SW_WRONG_LENGTH
        val p1 = apdu[2].toInt() and 0xFF
        val lc = apdu[4].toInt() and 0xFF
        if (apdu.size < 5 + lc) return SW_WRONG_LENGTH
        val data = apdu.copyOfRange(5, 5 + lc)
        return when (p1) {
            0x04 -> selectAid(data)
            0x00 -> selectFile(data)
            else -> SW_INCORRECT_P1P2
        }
    }

    private fun selectAid(aid: ByteArray): ByteArray {
        file = File.NONE
        val cache = cacheProvider()
        return when {
            aid.contentEquals(AID_DIGITAL_CARD) -> {
                if (cache == null || !cache.nfcSharingEnabled) {
                    app = App.NONE
                    return SW_FILE_NOT_FOUND
                }
                // A malformed cache (e.g. empty secret → SecretKeySpec throws) must not crash the
                // HCE service (it runs in the app process): answer "not found" instead.
                val token = try {
                    DigitalCardToken.generate(cache.shareId, cache.keyId, clockSeconds(), cache.secret)
                } catch (_: Exception) {
                    app = App.NONE
                    return SW_FILE_NOT_FOUND
                }
                app = App.DIGITAL
                PREFIX_NFCDC + token + SW_OK
            }
            aid.contentEquals(AID_NDEF) -> {
                val url = cache?.publicUrl
                if (cache == null || !cache.webPageEnabled || url.isNullOrBlank()) {
                    app = App.NONE
                    return SW_FILE_NOT_FOUND
                }
                val ndef = ndefFileFor(withVia(url))
                if (ndef == null) {
                    app = App.NONE
                    return SW_FILE_NOT_FOUND
                }
                app = App.T4T
                ndefFile = ndef
                SW_OK
            }
            else -> {
                app = App.NONE
                SW_FILE_NOT_FOUND
            }
        }
    }

    private fun selectFile(fid: ByteArray): ByteArray {
        if (app != App.T4T) return SW_FILE_NOT_FOUND
        if (fid.size != 2) return SW_WRONG_LENGTH
        file = when {
            fid.contentEquals(FID_CC) -> File.CC
            fid.contentEquals(FID_NDEF) -> File.NDEF
            else -> return SW_FILE_NOT_FOUND
        }
        return SW_OK
    }

    private fun readBinary(apdu: ByteArray): ByteArray {
        if (app != App.T4T || file == File.NONE) return SW_NO_CURRENT_EF
        val offset = ((apdu[2].toInt() and 0x7F) shl 8) or (apdu[3].toInt() and 0xFF)
        val le = if (apdu.size >= 5) (apdu[4].toInt() and 0xFF).let { if (it == 0) 256 else it } else 256
        val content = if (file == File.CC) CC_FILE else ndefFile
        if (offset > content.size) return SW_WRONG_OFFSET
        val end = minOf(content.size, offset + le)
        return content.copyOfRange(offset, end) + SW_OK
    }

    companion object {
        val AID_DIGITAL_CARD = hex("F04E4643444301")
        val AID_NDEF = hex("D2760000850101")
        val FID_CC = hex("E103")
        val FID_NDEF = hex("E104")
        val PREFIX_NFCDC = "NFCDC".toByteArray(Charsets.US_ASCII)

        const val MAX_NDEF_FILE = 1024
        const val MLE = 0x003B // max R-APDU data the reader may request per READ BINARY

        val SW_OK = hex("9000")
        val SW_WRONG_LENGTH = hex("6700")
        val SW_SECURITY_NOT_SATISFIED = hex("6982")
        val SW_CONDITIONS_NOT_SATISFIED = hex("6985")
        val SW_NO_CURRENT_EF = hex("6986")
        val SW_FILE_NOT_FOUND = hex("6A82")
        val SW_INCORRECT_P1P2 = hex("6A86")
        val SW_WRONG_OFFSET = hex("6B00")
        val SW_INS_NOT_SUPPORTED = hex("6D00")
        val SW_CLA_NOT_SUPPORTED = hex("6E00")

        /** Capability Container: T4T v2.0, MLe/MLc, NDEF File Control TLV (E104, 1 KB, read-only). */
        val CC_FILE: ByteArray = hex(
            "000F" + "20" + "%04X".format(MLE) + "0034" +
                "04" + "06" + "E104" + "%04X".format(MAX_NDEF_FILE) + "00" + "FF"
        )

        fun withVia(url: String): String = url + (if (url.contains('?')) "&" else "?") + "via=nfc"

        /** NDEF file = NLEN (2 bytes BE) ‖ NDEF message with one URI record. Null if > 1 KB. */
        fun ndefFileFor(uri: String): ByteArray? {
            val msg = uriRecord(uri)
            if (msg.size + 2 > MAX_NDEF_FILE) return null
            return byteArrayOf(((msg.size shr 8) and 0xFF).toByte(), (msg.size and 0xFF).toByte()) + msg
        }

        private val PREFIXES = listOf(
            0x02 to "https://www.", 0x01 to "http://www.", 0x04 to "https://", 0x03 to "http://",
        )

        fun uriRecord(uri: String): ByteArray {
            var code = 0
            var rest = uri
            for ((c, p) in PREFIXES) {
                if (uri.startsWith(p)) {
                    code = c
                    rest = uri.substring(p.length)
                    break
                }
            }
            val payload = byteArrayOf(code.toByte()) + rest.toByteArray(Charsets.UTF_8)
            return if (payload.size <= 255) {
                // MB|ME|SR, TNF=1 (well-known), type "U"
                byteArrayOf(0xD1.toByte(), 0x01, payload.size.toByte(), 0x55) + payload
            } else {
                val n = payload.size
                byteArrayOf(
                    0xC1.toByte(), 0x01,
                    (n shr 24).toByte(), (n shr 16).toByte(), (n shr 8).toByte(), n.toByte(), 0x55,
                ) + payload
            }
        }

        fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}
