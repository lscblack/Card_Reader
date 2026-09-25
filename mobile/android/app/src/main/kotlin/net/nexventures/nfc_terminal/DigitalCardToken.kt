package net.nexventures.nfc_terminal

import java.nio.ByteBuffer
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Digital-card token (Part 4 §3). Pure JVM so it is unit-testable; must match
 * lib/core/digital_card_token.dart byte for byte.
 *
 * token = 0x01 ‖ share_id (16, UUID big-endian) ‖ key_id (u32 BE) ‖ issued_at (u32 BE)
 *         ‖ first 16 bytes of HMAC-SHA256(secret, first 25 bytes)
 */
object DigitalCardToken {
    const val VERSION: Byte = 0x01
    const val LENGTH = 41

    fun uuidBytes(uuid: String): ByteArray {
        val u = UUID.fromString(uuid)
        return ByteBuffer.allocate(16).putLong(u.mostSignificantBits).putLong(u.leastSignificantBits).array()
    }

    fun generate(shareId: ByteArray, keyId: Long, issuedAt: Long, secret: ByteArray): ByteArray {
        require(shareId.size == 16) { "share_id must be 16 bytes" }
        require(keyId in 0..0xFFFFFFFFL && issuedAt in 0..0xFFFFFFFFL) { "u32 out of range" }
        val head = ByteBuffer.allocate(25)
            .put(VERSION)
            .put(shareId)
            .putInt(keyId.toInt())
            .putInt(issuedAt.toInt())
            .array()
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(secret, "HmacSHA256")) }.doFinal(head)
        return head + mac.copyOf(16)
    }
}
