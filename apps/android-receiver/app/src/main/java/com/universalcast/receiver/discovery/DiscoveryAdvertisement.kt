package com.universalcast.receiver.discovery

/**
 * DNS-SD advertisement contract shared with the Windows simulator.
 *
 * Android's NsdManager expects the service type without the ".local." domain suffix.
 */
data class DiscoveryAdvertisement(
    val serviceName: String,
    val serviceType: String = SERVICE_TYPE,
    val port: Int = DEFAULT_PORT,
    val txtAttributes: Map<String, String>
) {
    init {
        require(serviceName.isNotBlank()) { "Service name must not be blank." }
        require(serviceName.toByteArray(Charsets.UTF_8).size <= 63) { "Service name exceeds the DNS-SD 63-byte limit." }
        require(serviceType == SERVICE_TYPE) { "Unexpected UniversalCast DNS-SD service type." }
        require(port in 1..65535) { "Port must be between 1 and 65535." }
        require(txtAttributes.isNotEmpty()) { "At least one TXT attribute is required." }
        txtAttributes.forEach { (key, value) ->
            require(key.isNotBlank() && key.length <= 9 && key.all { it.isLetterOrDigit() || it == '-' }) {
                "Invalid DNS-SD TXT key: $key"
            }
            require(value.toByteArray(Charsets.UTF_8).size <= 255) {
                "DNS-SD TXT value for $key exceeds 255 bytes."
            }
        }
    }

    companion object {
        const val SERVICE_TYPE = "_universalcast._tcp."
        const val SERVICE_DOMAIN = "_universalcast._tcp.local."
        const val DEFAULT_PORT = 8765
        const val CONTROL_PATH = "/ucp"

        fun androidTv(deviceId: String): DiscoveryAdvertisement {
            require(deviceId.isNotBlank()) { "Device ID must not be blank." }
            return DiscoveryAdvertisement(
                serviceName = "UniversalCast Android TV",
                port = DEFAULT_PORT,
                txtAttributes = linkedMapOf(
                    "ucp" to "1.0",
                    "id" to deviceId,
                    "name" to "UniversalCast Android TV",
                    "path" to CONTROL_PATH,
                    "tls" to "0",
                    "mode" to "development"
                )
            )
        }
    }
}
