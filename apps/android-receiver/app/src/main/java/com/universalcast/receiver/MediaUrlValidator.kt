package com.universalcast.receiver

import java.net.URI

/**
 * Minimal input validation for the development playback screen.
 *
 * This is not the production UCP media-origin security boundary. The receiver's
 * eventual media fetcher must additionally defend against DNS rebinding, unsafe
 * redirects, private-network access and time-of-check/time-of-use changes.
 */
internal object MediaUrlValidator {
    fun isSupported(raw: String): Boolean {
        val value = raw.trim()
        if (value.isEmpty()) return false

        return try {
            val uri = URI(value)
            val scheme = uri.scheme?.lowercase()
            scheme in setOf("http", "https") &&
                !uri.host.isNullOrBlank() &&
                uri.rawUserInfo == null
        } catch (_: Exception) {
            false
        }
    }
}
