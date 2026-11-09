package com.universalcast.receiver.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/**
 * Long-lived receiver signing key stored in Android Keystore. Private key material is
 * never exported. This is identity provisioning ONLY: it does not enable TLS, pairing,
 * client authentication or secure UCP control.
 */
class ReceiverIdentity {
    companion object {
        const val KEY_ALIAS = "universalcast.receiver.identity.v1"
        private const val KEYSTORE = "AndroidKeyStore"

        fun fingerprintSha256(encodedCertificate: ByteArray): String =
            MessageDigest.getInstance("SHA-256")
                .digest(encodedCertificate)
                .joinToString(":") { "%02X".format(it.toInt() and 0xff) }
    }

    data class PublicIdentity(
        val certificateFingerprintSha256: String,
        val publicKeyAlgorithm: String
    )

    @Synchronized
    fun loadOrCreate(): PublicIdentity {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (!store.containsAlias(KEY_ALIAS)) {
            val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
            generator.initialize(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
                )
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            generator.generateKeyPair()
        }
        val certificate = store.getCertificate(KEY_ALIAS) as? X509Certificate
            ?: error("Receiver identity certificate is missing")
        require(certificate.publicKey.algorithm == "EC") { "Unexpected receiver key algorithm" }
        return PublicIdentity(
            certificateFingerprintSha256 = fingerprintSha256(certificate.encoded),
            publicKeyAlgorithm = certificate.publicKey.algorithm
        )
    }

    /**
     * Creates a TLS 1.2 server context backed directly by the non-exportable
     * Android Keystore key. The certificate is self-signed and must be pinned by
     * clients; this does not authenticate or authorize a connecting sender.
     */
    @Synchronized
    fun createServerTlsContext(): SSLContext {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        require(store.containsAlias(KEY_ALIAS)) { "Receiver identity has not been provisioned" }
        val certificate = store.getCertificate(KEY_ALIAS) as? X509Certificate
            ?: error("Receiver identity certificate is missing")
        val privateKey = store.getKey(KEY_ALIAS, null) as? PrivateKey
            ?: error("Receiver identity private key is unavailable")

        certificate.checkValidity()
        require(certificate.publicKey.algorithm == "EC" && privateKey.algorithm == "EC") {
            "Receiver TLS identity must use the provisioned EC key"
        }
        certificate.verify(certificate.publicKey)
        certificate.keyUsage?.let { usage ->
            require(usage.isNotEmpty() && usage[0]) {
                "Receiver certificate does not permit digital signatures"
            }
        }

        val keyManagers = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).run {
            init(store, null)
            keyManagers
        }
        return SSLContext.getInstance("TLSv1.2").apply {
            init(keyManagers, null, SecureRandom())
        }
    }
}
