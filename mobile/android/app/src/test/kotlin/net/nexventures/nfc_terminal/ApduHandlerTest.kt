package net.nexventures.nfc_terminal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

private fun hex(s: String) = ApduHandler.hex(s.replace(" ", ""))
private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
private fun sw(r: ByteArray) = r.copyOfRange(r.size - 2, r.size).hex().uppercase()

private fun b64url(s: String): ByteArray = java.util.Base64.getUrlDecoder().decode(s)
private fun b64urlEncode(b: ByteArray): String = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(b)

class OfficialVectorsTest {
    // PART4_CONTRACT.md §3 (reference: backend/app/services/card_tokens.py).
    private val vectors = listOf(
        listOf("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8", "00112233-4455-6677-8899-aabbccddeeff", "1", "1790000000",
            "AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM"),
        listOf("qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo", "7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f", "305419896", "1800000123",
            "AX8cLT5LWkxtjp8KGyw9Tl8SNFZ4a0nSe8Fk1b4SfbhyWc78tVbqa8M"),
        listOf("47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU", "c0ffee00-0000-4000-8000-000000000001", "4294967295", "0",
            "AcD_7gAAAEAAgAAAAAAAAAH_____AAAAAOkYlkbhvHUFoqWI5pKkMEE"),
    )

    @Test fun allVectors() {
        for (v in vectors) {
            val t = DigitalCardToken.generate(DigitalCardToken.uuidBytes(v[1]), v[2].toLong(), v[3].toLong(), b64url(v[0]))
            assertEquals(v[4], b64urlEncode(t))
        }
    }

    @Test fun hceResponseForVector1Is48Bytes() {
        val cache = CardCache(DigitalCardToken.uuidBytes("00112233-4455-6677-8899-aabbccddeeff"), 1,
            b64url("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"), null, false, true)
        val r = ApduHandler({ cache }, { 1790000000L }).process(ApduHandler.hex("00A4040007F04E464344430100"))
        assertEquals(48, r.size)
        assertEquals("AQARIjNEVWZ3iJmqu8zd7v8AAAABarE7gDqfF63howUbVssouoR5VwM", b64urlEncode(r.copyOfRange(5, 46)))
    }
}

class DigitalCardTokenTest {
    // Same vectors as test/digital_card_token_test.dart (computed independently with Python hmac).
    @Test fun vector1() {
        val t = DigitalCardToken.generate(
            DigitalCardToken.uuidBytes("3b241101-e2bb-4255-8caf-4136c566a962"), 7, 1790000000, ByteArray(32) { it.toByte() },
        )
        assertEquals(41, t.size)
        assertEquals("013b241101e2bb42558caf4136c566a962000000076ab13b80cf748bc914257d695f4953c2a439c205", t.hex())
    }

    @Test fun vector2() {
        val t = DigitalCardToken.generate(
            DigitalCardToken.uuidBytes("00000000-0000-4000-8000-000000000001"), 4294967295L, 1758789021, ByteArray(32) { 0xFF.toByte() },
        )
        assertEquals("0100000000000040008000000000000001ffffffff68d4fd9d3ce996b7bc9c0f1da3ed154c6dd3c1f6", t.hex())
    }
}

class ApduHandlerTest {
    private val cache = CardCache(
        shareId = DigitalCardToken.uuidBytes("3b241101-e2bb-4255-8caf-4136c566a962"),
        keyId = 7, secret = ByteArray(32) { it.toByte() },
        publicUrl = "https://cards.example.com/p/jane-doe", webPageEnabled = true, nfcSharingEnabled = true,
    )

    private fun handler(c: CardCache? = cache) = ApduHandler({ c }, { 1790000000L })

    @Test fun selectDigitalCardReturnsNfcdcTokenAnd9000() {
        val r = handler().process(hex("00A4040007F04E464344430100"))
        assertEquals(5 + 41 + 2, r.size)
        assertEquals("NFCDC", String(r.copyOfRange(0, 5), Charsets.US_ASCII))
        assertEquals("013b241101e2bb42558caf4136c566a962000000076ab13b80cf748bc914257d695f4953c2a439c205",
            r.copyOfRange(5, 46).hex())
        assertEquals("9000", sw(r))
        // Without Le as well
        assertEquals("9000", sw(handler().process(hex("00A4040007F04E4643444301"))))
    }

    @Test fun digitalCardUnavailableWhenNotSharingOrNoCache() {
        assertEquals("6A82", sw(handler(null).process(hex("00A4040007F04E464344430100"))))
        val off = CardCache(cache.shareId, 7, cache.secret, cache.publicUrl, true, nfcSharingEnabled = false)
        assertEquals("6A82", sw(handler(off).process(hex("00A4040007F04E464344430100"))))
    }

    @Test fun unknownAidAndBadApdus() {
        val h = handler()
        assertEquals("6A82", sw(h.process(hex("00A4040007A000000003101000"))))
        assertEquals("6D00", sw(h.process(hex("00CA000000"))))
        assertEquals("6E00", sw(h.process(hex("80A4040000"))))
        assertEquals("6700", sw(h.process(hex("00A4"))))
        assertEquals("6700", sw(h.process(hex("00A4040007F04E46"))))
        assertEquals("6986", sw(h.process(hex("00B0000010")))) // READ BINARY with no file
    }

    @Test fun type4TagFullReadSequence() {
        val h = handler()
        assertEquals("9000", sw(h.process(hex("00A4040007D276000085010100"))))
        assertEquals("9000", sw(h.process(hex("00A4000C02E103"))))
        val cc = h.process(hex("00B000000F"))
        assertEquals("9000", sw(cc))
        assertArrayEquals(ApduHandler.CC_FILE, cc.copyOfRange(0, cc.size - 2))
        assertEquals("000F20003B0034", ApduHandler.CC_FILE.copyOfRange(0, 7).hex().uppercase())
        assertEquals("0406E104040000FF", ApduHandler.CC_FILE.copyOfRange(7, 15).hex().uppercase())

        assertEquals("9000", sw(h.process(hex("00A4000C02E104"))))
        val nlen = h.process(hex("00B0000002"))
        val len = ((nlen[0].toInt() and 0xFF) shl 8) or (nlen[1].toInt() and 0xFF)
        // Read the message in 59-byte chunks with offsets, like a real reader honouring MLe.
        val out = ArrayList<Byte>()
        var off = 2
        while (off < 2 + len) {
            val n = minOf(0x3B, 2 + len - off)
            val r = h.process(byteArrayOf(0x00, 0xB0.toByte(), (off shr 8).toByte(), off.toByte(), n.toByte()))
            assertEquals("9000", sw(r))
            out.addAll(r.copyOfRange(0, r.size - 2).toList())
            off += n
        }
        val msg = out.toByteArray()
        assertEquals(0xD1.toByte(), msg[0]) // MB|ME|SR, well-known
        assertEquals(0x55.toByte(), msg[3]) // 'U'
        assertEquals(0x04.toByte(), msg[4]) // https://
        assertEquals("cards.example.com/p/jane-doe?via=nfc", String(msg.copyOfRange(5, msg.size), Charsets.UTF_8))
        assertEquals((msg[2].toInt() and 0xFF), msg.size - 4)

        assertEquals("6B00", sw(h.process(hex("00B0FFF001"))))
        assertEquals("6A82", sw(h.process(hex("00A4000C02E105"))))
        assertEquals("6982", sw(h.process(hex("00D6000001AA")))) // read-only
    }

    @Test fun ndefAppOnlyWhenWebPageEnabled() {
        val noWeb = CardCache(cache.shareId, 7, cache.secret, cache.publicUrl, webPageEnabled = false, nfcSharingEnabled = true)
        assertEquals("6A82", sw(handler(noWeb).process(hex("00A4040007D276000085010100"))))
        // File select without the T4T app selected fails
        assertEquals("6A82", sw(handler().process(hex("00A4000C02E103"))))
    }

    @Test fun longUrlUsesLongRecordAndOversizedIsRejected() {
        val long = "https://x.example/p/" + "a".repeat(300)
        val f = ApduHandler.ndefFileFor(long)!!
        assertEquals(0xC1.toByte(), f[2])
        assertTrue(ApduHandler.ndefFileFor("https://x/" + "a".repeat(1100)) == null)
        assertEquals("https://a/p/x?via=nfc", ApduHandler.withVia("https://a/p/x"))
        assertEquals("https://a/p/x?s=1&via=nfc", ApduHandler.withVia("https://a/p/x?s=1"))
    }
}
