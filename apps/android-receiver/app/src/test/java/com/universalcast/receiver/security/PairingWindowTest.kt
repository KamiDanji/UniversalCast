package com.universalcast.receiver.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.time.Instant

class PairingWindowTest {
    @Test
    fun challengeIsSingleUseAndExpiresOnMonotonicClock() {
        var elapsed = 10_000L
        var wall = Instant.parse("2026-11-09T12:00:00Z")
        val window = PairingWindow(
            elapsedRealtime = { elapsed },
            wallClock = { wall },
            durationMillis = 120_000L
        )
        val challenge = window.open()
        assertEquals(43, challenge.value.length)
        assertEquals(wall.plusSeconds(120), challenge.expiresAt)
        assertNotNull(window.current())
        assertNull(window.consume("not-the-challenge"))
        assertNotNull(window.consume(challenge.value))
        assertNull(window.consume(challenge.value))

        val expiring = window.open()
        elapsed += 120_000L
        wall = wall.plusSeconds(120)
        assertNull(window.current())
        assertNull(window.consume(expiring.value))
    }
}
