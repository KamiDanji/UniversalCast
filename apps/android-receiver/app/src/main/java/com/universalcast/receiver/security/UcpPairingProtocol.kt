package com.universalcast.receiver.security

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECFieldFp
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

/** Canonical UCP pairing transcript shared by Android and sender implementations. */
object UcpPairingProtocol {
    private val pairDomain = "UCP-PAIR-1".toByteArray(StandardCharsets.US_ASCII)
    private const val NONCE_BYTES = 32
    private const val UUID_BYTES = 16
    private const val SHA256_BYTES = 32

    fun pairingTranscript(
        challenge: String,
        receiverId: String,
        senderId: String,
        senderPublicKey: ByteArray,
        senderNonce: String
    ): ByteArray {
        val challengeBytes = Base64Url.decode(challenge)
        val nonceBytes = Base64Url.decode(senderNonce)
        require(challengeBytes.size == NONCE_BYTES) { "Pairing challenge must be 32 bytes." }
        require(nonceBytes.size == NONCE_BYTES) { "Sender nonce must be 32 bytes." }
        val publicKeyFingerprint = MessageDigest.getInstance("SHA-256").digest(senderPublicKey)
        return ByteBuffer.allocate(
            pairDomain.size + UUID_BYTES + UUID_BYTES + SHA256_BYTES + NONCE_BYTES + NONCE_BYTES
        ).put(pairDomain)
            .put(uuidBytes(receiverId))
            .put(uuidBytes(senderId))
            .put(publicKeyFingerprint)
            .put(challengeBytes)
            .put(nonceBytes)
            .array()
    }

    fun validateP256PublicKey(encodedPublicKey: ByteArray) {
        val key = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(encodedPublicKey)) as? ECPublicKey
            ?: throw IllegalArgumentException("Sender key must be an EC public key.")
        require(isP256(key)) { "Sender key must be P-256 (secp256r1)." }
    }

    fun verifyPairingProof(
        challenge: String,
        receiverId: String,
        senderId: String,
        senderPublicKey: ByteArray,
        senderNonce: String,
        signature: ByteArray
    ): Boolean {
        val key = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(senderPublicKey)) as? ECPublicKey
            ?: return false
        require(isP256(key)) { "Sender key must be P-256 (secp256r1)." }
        val verifier = Signature.getInstance("SHA256withECDSA")
        verifier.initVerify(key)
        verifier.update(pairingTranscript(challenge, receiverId, senderId, senderPublicKey, senderNonce))
        return verifier.verify(signature)
    }

    fun authenticationTranscript(
        receiverId: String,
        senderId: String,
        protocolVersion: String,
        nonce: String
    ): ByteArray {
        val nonceBytes = Base64Url.decode(nonce)
        require(nonceBytes.size == NONCE_BYTES) { "Authentication nonce must be 32 bytes." }
        val versionParts = protocolVersion.split('.')
        require(versionParts.size == 2) { "Protocol version must have major.minor form." }
        val major = versionParts[0].toIntOrNull()?.takeIf { it in 0..255 }
            ?: throw IllegalArgumentException("Invalid protocol major version.")
        val minor = versionParts[1].toIntOrNull()?.takeIf { it in 0..255 }
            ?: throw IllegalArgumentException("Invalid protocol minor version.")
        val domain = "UCP-AUTH-1".toByteArray(StandardCharsets.US_ASCII)
        return ByteBuffer.allocate(domain.size + UUID_BYTES + UUID_BYTES + 2 + NONCE_BYTES)
            .put(domain)
            .put(uuidBytes(receiverId))
            .put(uuidBytes(senderId))
            .put(major.toByte())
            .put(minor.toByte())
            .put(nonceBytes)
            .array()
    }

    fun verifyAuthenticationProof(
        receiverId: String,
        senderId: String,
        protocolVersion: String,
        nonce: String,
        encodedPublicKey: ByteArray,
        signature: ByteArray
    ): Boolean {
        val key = KeyFactory.getInstance("EC")
            .generatePublic(X509EncodedKeySpec(encodedPublicKey)) as? ECPublicKey
            ?: return false
        require(isP256(key)) { "Sender key must be P-256 (secp256r1)." }
        return Signature.getInstance("SHA256withECDSA").run {
            initVerify(key)
            update(authenticationTranscript(receiverId, senderId, protocolVersion, nonce))
            verify(signature)
        }
    }
    fun fingerprintSha256(encodedPublicKey: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(encodedPublicKey)
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }

    private fun isP256(key: ECPublicKey): Boolean {
        val expected = AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(ECParameterSpec::class.java)
        val actual = key.params
        val actualField = actual.curve.field as? ECFieldFp ?: return false
        val expectedField = expected.curve.field as? ECFieldFp ?: return false
        return actualField.p == expectedField.p &&
            actual.curve.a == expected.curve.a &&
            actual.curve.b == expected.curve.b &&
            actual.generator.affineX == expected.generator.affineX &&
            actual.generator.affineY == expected.generator.affineY &&
            actual.order == expected.order &&
            actual.cofactor == expected.cofactor
    }
    private fun uuidBytes(value: String): ByteArray {
        val uuid = UUID.fromString(value)
        require(uuid.toString() == value.lowercase()) { "Identity must be a canonical UUID." }
        return ByteBuffer.allocate(UUID_BYTES).putLong(uuid.mostSignificantBits).putLong(uuid.leastSignificantBits).array()
    }
}

/** Minimal strict base64url codec, available on the app's Android API 23 minimum. */
internal object Base64Url {
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

    fun encode(bytes: ByteArray): String {
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var index = 0
        while (index < bytes.size) {
            val remaining = bytes.size - index
            val chunk = ((bytes[index].toInt() and 0xff) shl 16) or
                (if (remaining > 1) (bytes[index + 1].toInt() and 0xff) shl 8 else 0) or
                (if (remaining > 2) (bytes[index + 2].toInt() and 0xff) else 0)
            out.append(ALPHABET[(chunk ushr 18) and 63])
            out.append(ALPHABET[(chunk ushr 12) and 63])
            if (remaining > 1) out.append(ALPHABET[(chunk ushr 6) and 63])
            if (remaining > 2) out.append(ALPHABET[chunk and 63])
            index += 3
        }
        return out.toString()
    }

    fun decode(value: String): ByteArray {
        require(value.isNotEmpty() && value.length % 4 != 1) { "Invalid base64url value." }
        require(value.all { it in ALPHABET }) { "Invalid base64url value." }
        val out = ByteArrayOutputStream(value.length * 3 / 4)
        var buffer = 0
        var bits = 0
        value.forEach { char ->
            buffer = (buffer shl 6) or ALPHABET.indexOf(char)
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.write((buffer ushr bits) and 0xff)
            }
        }
        val decoded = out.toByteArray()
        require(encode(decoded) == value) { "Non-canonical base64url value." }
        return decoded
    }
}
