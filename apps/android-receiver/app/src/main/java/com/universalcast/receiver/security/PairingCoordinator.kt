package com.universalcast.receiver.security

import android.content.Context
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

/** Coordinates one-at-a-time receiver-approved sender pairing. */
class PairingCoordinator(
    context: Context,
    private val receiverId: String = ReceiverIdStore(context).getOrCreate(),
    private val window: PairingWindow = PairingWindow()
) {
    val stableReceiverId: String get() = receiverId

    data class Request(
        val challenge: String,
        val senderId: String,
        val displayName: String,
        val publicKey: ByteArray,
        val senderNonce: String,
        val signature: ByteArray
    )

    class Proposal internal constructor(
        val senderId: String,
        val displayName: String,
        val shortAuthenticationString: String,
        internal val challenge: String,
        internal val publicKey: ByteArray
    )

    class PairingException(val code: String, message: String) : IllegalArgumentException(message)

    private val store = PairedSenderStore(context)
    private var pending: Proposal? = null

    @Synchronized
    fun openWindow(): PairingWindow.Challenge {
        pending = null
        return window.open()
    }

    @Synchronized
    fun closeWindow() {
        pending = null
        window.close()
    }

    @Synchronized
    fun bootstrapPayload(endpoint: String, certificateFingerprint: String): String {
        val challenge = window.current() ?: throw PairingException("PAIRING_CLOSED", "Pairing window is not open.")
        val endpointUri = java.net.URI(endpoint)
        require(endpointUri.scheme == "wss" && endpointUri.host != null && endpointUri.userInfo == null &&
            endpointUri.path == "/ucp" && endpointUri.rawQuery == null && endpointUri.rawFragment == null) {
            "Pairing requires a credential-free WSS /ucp endpoint."
        }
        val normalizedFingerprint = certificateFingerprint.replace(":", "").lowercase()
        require(normalizedFingerprint.matches(Regex("[0-9a-f]{64}"))) { "Receiver fingerprint must be SHA-256." }
        return JSONObject()
            .put("protocol", "UCP")
            .put("version", "1.0")
            .put("receiverId", receiverId)
            .put("endpoint", endpoint)
            .put("path", "/ucp")
            .put("certificateFingerprintSha256", certificateFingerprint)
            .put("challenge", challenge.value)
            .put("expiresAt", challenge.expiresAt.toString())
            .toString()
    }

    @Synchronized
    fun submit(request: Request): Proposal {
        val active = window.current() ?: throw PairingException("PAIRING_CLOSED", "Pairing window is not open or has expired.")
        if (pending != null) throw PairingException("PAIRING_PENDING", "Another sender is awaiting approval.")
        if (request.challenge != active.value) throw PairingException("PAIRING_CHALLENGE_INVALID", "Pairing challenge does not match the open window.")
        if (request.displayName.isBlank() || request.displayName.length > MAX_NAME_LENGTH || request.displayName.any(Char::isISOControl)) {
            throw PairingException("PAIRING_INVALID_SENDER", "Sender name must contain 1 to $MAX_NAME_LENGTH characters.")
        }
        if (store.find(request.senderId) != null) throw PairingException("ALREADY_PAIRED", "This sender is already paired.")
        val keyEncoded = request.publicKey
        if (request.senderNonce.length != BASE64_NONCE_LENGTH) {
            throw PairingException("PAIRING_INVALID_SENDER", "Sender nonce must encode exactly 32 bytes.")
        }
        if (keyEncoded.isEmpty() || keyEncoded.size > MAX_PUBLIC_KEY_BYTES) {
            throw PairingException("PAIRING_INVALID_SENDER", "Sender public key has an invalid length.")
        }
        val transcript = try {
            UcpPairingProtocol.pairingTranscript(
                request.challenge, receiverId, request.senderId, keyEncoded, request.senderNonce
            )
        } catch (error: IllegalArgumentException) {
            throw PairingException("PAIRING_INVALID_SENDER", error.message ?: "Invalid sender identity.")
        }
        val fingerprint = UcpPairingProtocol.fingerprintSha256(keyEncoded)
        if (store.containsFingerprint(fingerprint)) {
            throw PairingException("ALREADY_PAIRED", "This sender identity is already paired under another ID.")
        }
        val verified = try {
            UcpPairingProtocol.verifyPairingProof(
                request.challenge, receiverId, request.senderId, keyEncoded, request.senderNonce, request.signature
            )
        } catch (error: Exception) {
            throw PairingException("PAIRING_INVALID_SENDER", error.message ?: "Sender proof could not be verified.")
        }
        if (!verified) throw PairingException("PAIRING_PROOF_INVALID", "Sender proof of possession is invalid.")
        val sasValue = (MessageDigest.getInstance("SHA-256").digest(transcript).take(4)
            .fold(0L) { value, byte -> (value shl 8) or (byte.toLong() and 0xff) } % SAS_MODULUS)
        return Proposal(
            senderId = request.senderId,
            displayName = request.displayName.trim(),
            shortAuthenticationString = sasValue.toString().padStart(6, '0'),
            challenge = active.value,
            publicKey = keyEncoded.copyOf()
        ).also { pending = it }
    }

    @Synchronized
    fun approve(senderId: String, role: PairedSenderStore.Role): PairedSenderStore.Sender {
        val proposal = requirePending(senderId)
        if (window.consume(proposal.challenge) == null) {
            pending = null
            throw PairingException("PAIRING_EXPIRED", "Pairing challenge expired before approval.")
        }
        val fingerprint = UcpPairingProtocol.fingerprintSha256(proposal.publicKey)
        val sender = PairedSenderStore.Sender(
            senderId = proposal.senderId,
            displayName = proposal.displayName,
            role = role,
            publicKey = Base64Url.encode(proposal.publicKey),
            fingerprintSha256 = fingerprint,
            pairedAt = Instant.now().toString()
        )
        pending = null
        store.save(sender)
        return sender
    }

    @Synchronized
    fun reject(senderId: String) {
        val proposal = requirePending(senderId)
        pending = null
        if (window.consume(proposal.challenge) == null) {
            throw PairingException("PAIRING_EXPIRED", "Pairing challenge expired before rejection.")
        }
    }

    @Synchronized
    fun pairedSender(senderId: String): PairedSenderStore.Sender? = store.find(senderId)

    @Synchronized
    fun authenticate(
        senderId: String,
        protocolVersion: String,
        nonce: String,
        signature: ByteArray
    ): PairedSenderStore.Sender? {
        val sender = store.find(senderId) ?: return null
        val publicKey = Base64Url.decode(sender.publicKey)
        val valid = UcpPairingProtocol.verifyAuthenticationProof(
            receiverId, senderId, protocolVersion, nonce, publicKey, signature
        )
        return sender.takeIf { valid }
    }
    @Synchronized
    fun pairedSenders(): List<PairedSenderStore.Sender> = store.list()

    @Synchronized
    fun revoke(senderId: String): Boolean = store.revoke(senderId)

    private fun requirePending(senderId: String): Proposal = pending?.takeIf { it.senderId == senderId }
        ?: throw PairingException("PAIRING_NOT_PENDING", "No matching sender is awaiting approval.")

    private companion object {
        const val MAX_NAME_LENGTH = 64
        const val MAX_PUBLIC_KEY_BYTES = 1024
        const val SAS_MODULUS = 1_000_000L
        const val BASE64_NONCE_LENGTH = 43
    }
}
