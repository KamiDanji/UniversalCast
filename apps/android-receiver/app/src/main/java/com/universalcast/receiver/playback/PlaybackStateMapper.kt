package com.universalcast.receiver.playback

/** Media-engine-neutral phases used to keep mapping logic straightforward to test. */
enum class EnginePhase { IDLE, BUFFERING, READY, ENDED }

object PlaybackStateMapper {
    fun map(
        phase: EnginePhase,
        hasMedia: Boolean,
        isPlaying: Boolean,
        playWhenReady: Boolean,
        hasStartedPlayback: Boolean,
        hasError: Boolean
    ): PlaybackStatus {
        if (hasError) return PlaybackStatus.ERROR
        if (!hasMedia) return PlaybackStatus.IDLE

        return when (phase) {
            EnginePhase.IDLE -> PlaybackStatus.LOADING
            EnginePhase.BUFFERING -> if (hasStartedPlayback && !playWhenReady) PlaybackStatus.PAUSED else PlaybackStatus.BUFFERING
            EnginePhase.ENDED -> PlaybackStatus.ENDED
            EnginePhase.READY -> when {
                isPlaying -> PlaybackStatus.PLAYING
                hasStartedPlayback && !playWhenReady -> PlaybackStatus.PAUSED
                else -> PlaybackStatus.READY
            }
        }
    }
}
