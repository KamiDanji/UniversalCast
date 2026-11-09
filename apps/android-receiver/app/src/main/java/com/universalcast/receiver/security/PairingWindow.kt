package com.universalcast.receiver.security

import android.os.SystemClock
import java.security.SecureRandom
import java.time.Instant


/** Owns one receiver-initiated, single-use pairing challenge. */
class PairingWindow(
    private val secureRandom: SecureRandom = SecureRandom(),
    private val elapsedRealtime: () -> Long = SystemClock::elapsedRealtime,
    private val wallClock: () -> Instant = Instant::now,
    private val durationMillis: Long = DEFAULT_DURATION_MILLIS
) {
    companion object {
        const val DEFAULT_DURATION_MILLIS = 120_000L
        private const val CHALLENGE_BYTES = 32
    }

    class Challenge internal constructor(
        val value: String,
        val expiresAt: Instant
    )

    private var active: Challenge? = null
    private var deadlineElapsedRealtime: Long? = null

    init {
        require(durationMillis > 0L) { "Pairing window duration must be positive." }
    }

    @Synchronized
    fun open(): Challenge {
        val bytes = ByteArray(CHALLENGE_BYTES).also(secureRandom::nextBytes)
        val challenge = Challenge(
            value = Base64Url.encode(bytes),
            expiresAt = wallClock().plusMillis(durationMillis)
        )
        active = challenge
        deadlineElapsedRealtime = elapsedRealtime() + durationMillis
        return challenge
    }

    /** Returns and consumes the challenge only if it is the current, unexpired value. */
    @Synchronized
    fun consume(value: String): Challenge? {
        val current = active ?: return null
        val deadline = deadlineElapsedRealtime ?: return null
        if (elapsedRealtime() >= deadline || current.value != value) {
            if (elapsedRealtime() >= deadline) closeInternal()
            return null
        }
        closeInternal()
        return current
    }

    @Synchronized
    fun close() {
        closeInternal()
    }

    @Synchronized
    fun current(): Challenge? {
        val current = active ?: return null
        if ((deadlineElapsedRealtime ?: 0L) <= elapsedRealtime()) {
            closeInternal()
            return null
        }
        return current
    }

    private fun closeInternal() {
        active = null
        deadlineElapsedRealtime = null
    }
}
