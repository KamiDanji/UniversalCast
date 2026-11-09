package com.universalcast.receiver.security

import android.content.Context
import org.json.JSONException
import org.json.JSONObject
import java.time.Instant

/** Persists public sender identities and their explicitly assigned roles. */
class PairedSenderStore(context: Context) {
    enum class Role(val wireValue: String) { CONTROLLER("controller"), OBSERVER("observer") }

    data class Sender(
        val senderId: String,
        val displayName: String,
        val role: Role,
        val publicKey: String,
        val fingerprintSha256: String,
        val pairedAt: String
    )

    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME, Context.MODE_PRIVATE
    )

    @Synchronized
    fun list(): List<Sender> = preferences.all.values.mapNotNull { raw ->
        val json = raw as? String ?: return@mapNotNull null
        runCatching { decode(JSONObject(json)) }.getOrNull()
    }.sortedBy { it.displayName.lowercase() }

    @Synchronized
    fun find(senderId: String): Sender? = preferences.getString(senderId, null)
        ?.let { runCatching { decode(JSONObject(it)) }.getOrNull() }

    @Synchronized
    fun containsFingerprint(fingerprintSha256: String): Boolean =
        list().any { it.fingerprintSha256 == fingerprintSha256 }

    @Synchronized
    fun save(sender: Sender) {
        require(sender.senderId == canonicalUuid(sender.senderId)) { "Sender ID must be a canonical UUID." }
        require(sender.displayName.isNotBlank() && sender.displayName.length <= MAX_NAME_LENGTH) {
            "Sender display name must contain 1 to $MAX_NAME_LENGTH characters."
        }
        val encoded = Base64Url.decode(sender.publicKey)
        require(encoded.isNotEmpty() && encoded.size <= MAX_PUBLIC_KEY_BYTES) { "Sender public key is invalid." }
        UcpPairingProtocol.validateP256PublicKey(encoded)
        val fingerprint = UcpPairingProtocol.fingerprintSha256(encoded)
        require(fingerprint == sender.fingerprintSha256) { "Sender public key fingerprint mismatch." }
        require(preferences.edit().putString(sender.senderId, encode(sender).toString()).commit()) {
            "Unable to persist paired sender."
        }
    }

    @Synchronized
    fun revoke(senderId: String): Boolean {
        if (!preferences.contains(senderId)) return false
        return preferences.edit().remove(senderId).commit()
    }

    private fun encode(sender: Sender) = JSONObject()
        .put("senderId", sender.senderId)
        .put("displayName", sender.displayName)
        .put("role", sender.role.wireValue)
        .put("publicKey", sender.publicKey)
        .put("fingerprintSha256", sender.fingerprintSha256)
        .put("pairedAt", sender.pairedAt)

    private fun decode(json: JSONObject): Sender {
        val senderId = json.getString("senderId")
        val role = Role.entries.firstOrNull { it.wireValue == json.getString("role") }
            ?: throw JSONException("Invalid paired sender role")
        val sender = Sender(
            senderId = senderId,
            displayName = json.getString("displayName"),
            role = role,
            publicKey = json.getString("publicKey"),
            fingerprintSha256 = json.getString("fingerprintSha256"),
            pairedAt = json.getString("pairedAt")
        )
        require(sender.senderId == canonicalUuid(sender.senderId))
        require(sender.displayName.isNotBlank() && sender.displayName.length <= MAX_NAME_LENGTH)
        require(Instant.parse(sender.pairedAt) != null)
        val encoded = Base64Url.decode(sender.publicKey)
        UcpPairingProtocol.validateP256PublicKey(encoded)
        require(UcpPairingProtocol.fingerprintSha256(encoded) == sender.fingerprintSha256)
        return sender
    }

    companion object {
        private const val PREFERENCES_NAME = "ucp_paired_senders_v1"
        private const val MAX_NAME_LENGTH = 64
        private const val MAX_PUBLIC_KEY_BYTES = 1024

        private fun canonicalUuid(value: String): String {
            val parsed = java.util.UUID.fromString(value)
            require(parsed.toString() == value.lowercase()) { "Sender ID must be a canonical UUID." }
            return parsed.toString()
        }
    }
}
