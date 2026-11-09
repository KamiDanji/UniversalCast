package com.universalcast.receiver

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackEngineContractTest {
    @Test
    fun receiverPackageUsesExpectedNamespace() {
        assertEquals("com.universalcast.receiver", PlaybackEngineContractTest::class.java.packageName)
    }
}
