package com.universalcast.receiver

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaUrlValidatorTest {
    @Test
    fun acceptsHttpAndHttpsUrls() {
        assertTrue(MediaUrlValidator.isSupported("http://192.168.2.15:8766/video.mp4"))
        assertTrue(MediaUrlValidator.isSupported("https://cdn.example.com/video.m3u8"))
    }

    @Test
    fun rejectsUnsupportedSchemesAndMalformedUrls() {
        assertFalse(MediaUrlValidator.isSupported("file:///sdcard/video.mp4"))
        assertFalse(MediaUrlValidator.isSupported("ftp://example.com/video.mp4"))
        assertFalse(MediaUrlValidator.isSupported("not a url"))
        assertFalse(MediaUrlValidator.isSupported(""))
    }

    @Test
    fun rejectsEmbeddedCredentials() {
        assertFalse(MediaUrlValidator.isSupported("https://user:password@example.com/video.mp4"))
    }
}
