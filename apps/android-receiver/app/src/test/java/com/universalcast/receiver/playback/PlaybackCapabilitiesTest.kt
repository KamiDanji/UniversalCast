package com.universalcast.receiver.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackCapabilitiesTest {
    @Test fun baselineAdvertisesOnlyImplementedFeatures() {
        val capabilities = PlaybackCapabilities.media3Baseline()
        assertTrue(capabilities.sourceProtocols.contains("progressive"))
        assertTrue(capabilities.sourceProtocols.contains("hls"))
        assertFalse(capabilities.sourceProtocols.contains("dash"))
        assertTrue(capabilities.supportsSeeking)
        assertTrue(capabilities.supportsPlaybackRate)
        assertFalse(capabilities.supportsAudioTrackSelection)
        assertFalse(capabilities.supportsSubtitleTrackSelection)
        assertEquals(0.5f, capabilities.minPlaybackRate, 0f)
        assertEquals(2.0f, capabilities.maxPlaybackRate, 0f)
    }
}
