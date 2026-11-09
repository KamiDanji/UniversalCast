package com.universalcast.receiver.discovery

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryAdvertisementTest {
    @Test
    fun `android tv advertisement matches UCP DNS-SD contract`() {
        val advertisement = DiscoveryAdvertisement.androidTv("device-123")

        assertEquals("UniversalCast Android TV", advertisement.serviceName)
        assertEquals("_universalcast._tcp.", advertisement.serviceType)
        assertEquals(8765, advertisement.port)
        assertEquals(
            mapOf(
                "ucp" to "1.0",
                "id" to "device-123",
                "name" to "UniversalCast Android TV",
                "path" to "/ucp",
                "tls" to "0",
                "mode" to "development"
            ),
            advertisement.txtAttributes
        )
        assertEquals("_universalcast._tcp.local.", DiscoveryAdvertisement.SERVICE_DOMAIN)
    }

    @Test
    fun `advertisement uses same development TXT conventions as simulator`() {
        val keys = DiscoveryAdvertisement.androidTv("device-123").txtAttributes.keys
        assertTrue(keys.containsAll(listOf("ucp", "id", "name", "path", "tls", "mode")))
        assertFalse(keys.contains("token"))
        assertFalse(keys.contains("password"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects blank device id`() {
        DiscoveryAdvertisement.androidTv(" ")
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects invalid port`() {
        DiscoveryAdvertisement.androidTv("device-123").copy(port = 70000)
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects oversized TXT values`() {
        DiscoveryAdvertisement(
            serviceName = "UniversalCast",
            txtAttributes = mapOf("ucp" to "x".repeat(256))
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun `rejects TXT keys longer than DNS-SD key limit`() {
        DiscoveryAdvertisement(
            serviceName = "UniversalCast",
            txtAttributes = mapOf("capabilities" to "playback")
        )
    }
}
