package com.universalcast.receiver.playback

/**
 * Platform-neutral contract consumed by the future UCP command dispatcher.
 * Implementations own the media player and publish receiver-authoritative snapshots.
 */
interface PlaybackEngine {
    val capabilities: PlaybackCapabilities

    fun setListener(listener: PlaybackListener?)
    fun load(request: PlaybackLoadRequest)
    fun play()
    fun pause()
    fun seekTo(positionMs: Long)
    fun setPlaybackRate(rate: Float)
    fun stop()
    fun snapshot(): PlaybackSnapshot
    fun release()
}
