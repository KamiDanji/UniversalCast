package com.universalcast.receiver.security

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.Base64

class UcpPairingProtocolTest {
    @Test
    fun canonicalTranscriptVerifiesOnlyForBoundChallengeAndIdentities() {
        val generator = KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }
        val sender = generator.generateKeyPair()
        val challenge = Base64Url.encode(ByteArray(32) { it.toByte() })
        val nonce = Base64Url.encode(ByteArray(32) { (it + 32).toByte() })
        val receiverId = UUID.fromString("12345678-1234-5678-9abc-def012345678").toString()
        val senderId = UUID.fromString("87654321-4321-8765-cba9-876543210fed").toString()
        val transcript = UcpPairingProtocol.pairingTranscript(
            challenge, receiverId, senderId, sender.public.encoded, nonce
        )
        val signer = Signature.getInstance("SHA256withECDSA").apply {
            initSign(sender.private)
            update(transcript)
        }
        val proof = signer.sign()

        assertTrue(UcpPairingProtocol.verifyPairingProof(
            challenge, receiverId, senderId, sender.public.encoded, nonce, proof
        ))
        assertFalse(UcpPairingProtocol.verifyPairingProof(
            Base64Url.encode(ByteArray(32) { (it + 1).toByte() }), receiverId, senderId,
            sender.public.encoded, nonce, proof
        ))
        assertArrayEquals(ByteArray(32) { it.toByte() }, Base64Url.decode(challenge))
    }

    @Test
    fun canonicalTranscriptsMatchSharedNodeVectors() {
        val receiverId = "12345678-1234-5678-9abc-def012345678"
        val senderId = "87654321-4321-8765-cba9-876543210fed"
        val publicKey = Base64.getDecoder().decode(
            "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmct7tLzqSWyePF3X2vsTtZ3vhWDzNq8E5lIZk3HEtD7jsHxOxTXHiNHSv3h9Qt987B3AMLRqF/FahQfDiRj7wA=="
        )
        val challenge = Base64Url.encode(ByteArray(32) { 0x11 })
        val senderNonce = Base64Url.encode(ByteArray(32) { 0x22 })
        val pairing = UcpPairingProtocol.pairingTranscript(challenge, receiverId, senderId, publicKey, senderNonce)
        assertEquals(
            "5543502d504149522d3112345678123456789abcdef0123456788765432143218765cba9876543210fedf61252489b17b647cf5840a5a1abd25688cd1b8a4bea2ec433d6124055c6865011111111111111111111111111111111111111111111111111111111111111112222222222222222222222222222222222222222222222222222222222222222",
            pairing.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        )
        val authentication = UcpPairingProtocol.authenticationTranscript(
            receiverId, senderId, "1.0", Base64Url.encode(ByteArray(32) { 0x33 })
        )
        assertEquals(
            "5543502d415554482d3112345678123456789abcdef0123456788765432143218765cba9876543210fed01003333333333333333333333333333333333333333333333333333333333333333",
            authentication.joinToString("") { "%02x".format(it.toInt() and 0xff) }
        )
    }
    @Test
    fun authenticationProofBindsFreshNonceAndProtocolVersion() {
        val generator = KeyPairGenerator.getInstance("EC").apply {
            initialize(ECGenParameterSpec("secp256r1"))
        }
        val sender = generator.generateKeyPair()
        val receiverId = "12345678-1234-5678-9abc-def012345678"
        val senderId = "87654321-4321-8765-cba9-876543210fed"
        val nonce = Base64Url.encode(ByteArray(32) { (it + 9).toByte() })
        val transcript = UcpPairingProtocol.authenticationTranscript(receiverId, senderId, "1.0", nonce)
        val proof = Signature.getInstance("SHA256withECDSA").run {
            initSign(sender.private)
            update(transcript)
            sign()
        }

        assertTrue(UcpPairingProtocol.verifyAuthenticationProof(
            receiverId, senderId, "1.0", nonce, sender.public.encoded, proof
        ))
        assertFalse(UcpPairingProtocol.verifyAuthenticationProof(
            receiverId, senderId, "1.0", Base64Url.encode(ByteArray(32) { (it + 10).toByte() }), sender.public.encoded, proof
        ))
        assertFalse(UcpPairingProtocol.verifyAuthenticationProof(
            receiverId, senderId, "1.1", nonce, sender.public.encoded, proof
        ))
    }
    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonCanonicalChallengeEncoding() {
        Base64Url.decode("AB")
    }
}
