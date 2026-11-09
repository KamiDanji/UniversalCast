package com.universalcast.receiver.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackStateMapperTest {
    private fun map(
        phase: EnginePhase,
        hasMedia: Boolean = true,
        isPlaying: Boolean = false,
        playWhenReady: Boolean = false,
        hasStarted: Boolean = false,
        hasError: Boolean = false
    ) = PlaybackStateMapper.map(phase, hasMedia, isPlaying, playWhenReady, hasStarted, hasError)

    @Test fun noMediaMapsToIdle() {
        assertEquals(PlaybackStatus.IDLE, map(EnginePhase.IDLE, hasMedia = false))
    }

    @Test fun mediaPreparingMapsToLoading() {
        assertEquals(PlaybackStatus.LOADING, map(EnginePhase.IDLE))
    }

    @Test fun bufferingMapsToBuffering() {
        assertEquals(PlaybackStatus.BUFFERING, map(EnginePhase.BUFFERING))
    }

    @Test fun readyBeforeFirstPlayMapsToReady() {
        assertEquals(PlaybackStatus.READY, map(EnginePhase.READY))
    }

    @Test fun activePlaybackMapsToPlaying() {
        assertEquals(PlaybackStatus.PLAYING, map(EnginePhase.READY, isPlaying = true, playWhenReady = true, hasStarted = true))
    }

    @Test fun userPausedPlaybackMapsToPaused() {
        assertEquals(PlaybackStatus.PAUSED, map(EnginePhase.READY, hasStarted = true))
    }

    @Test fun completedPlaybackMapsToEnded() {
        assertEquals(PlaybackStatus.ENDED, map(EnginePhase.ENDED, hasStarted = true))
    }

    @Test fun errorTakesPrecedenceOverOtherStates() {
        assertEquals(PlaybackStatus.ERROR, map(EnginePhase.BUFFERING, hasError = true))
    }
}
