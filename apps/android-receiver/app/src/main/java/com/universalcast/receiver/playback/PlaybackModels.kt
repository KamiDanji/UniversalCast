package com.universalcast.receiver.playback

/** UCP 1.0 playback status values, independent of Android and Media3. */
enum class PlaybackStatus(val wireValue: String) {
    IDLE("idle"),
    LOADING("loading"),
    READY("ready"),
    PLAYING("playing"),
    PAUSED("paused"),
    BUFFERING("buffering"),
    ENDED("ended"),
    ERROR("error")
}

data class PlaybackLoadRequest(
    val uri: String,
    val mediaId: String? = null,
    val title: String? = null,
    val mimeType: String? = null,
    val startPositionMs: Long = 0L
)

/**
 * Receiver-authoritative playback snapshot.
 * bufferedMs is the amount buffered ahead of the current playhead, not an absolute timestamp.
 * updatedAtEpochMs is converted to an RFC 3339 timestamp by the future UCP transport layer.
 */
data class PlaybackSnapshot(
    val revision: Long,
    val status: PlaybackStatus,
    val mediaId: String?,
    val title: String?,
    val positionMs: Long?,
    val durationMs: Long?,
    val bufferedMs: Long?,
    val playbackRate: Float,
    val updatedAtEpochMs: Long,
    val errorCode: String? = null
)

/** Capabilities are reported conservatively; codec support still depends on device decoders. */
data class PlaybackCapabilities(
    val sourceProtocols: Set<String>,
    val mimeTypes: Set<String>,
    val supportsSeeking: Boolean,
    val supportsPlaybackRate: Boolean,
    val minPlaybackRate: Float,
    val maxPlaybackRate: Float,
    val supportsAudioTrackSelection: Boolean,
    val supportsSubtitleTrackSelection: Boolean
) {
    companion object {
        fun media3Baseline() = PlaybackCapabilities(
            sourceProtocols = setOf("progressive", "hls"),
            mimeTypes = setOf(
                "video/mp4",
                "video/webm",
                "audio/mp4",
                "audio/mpeg",
                "application/vnd.apple.mpegurl",
                "application/x-mpegURL"
            ),
            supportsSeeking = true,
            supportsPlaybackRate = true,
            minPlaybackRate = 0.5f,
            maxPlaybackRate = 2.0f,
            supportsAudioTrackSelection = false,
            supportsSubtitleTrackSelection = false
        )
    }
}

fun interface PlaybackListener {
    fun onPlaybackSnapshot(snapshot: PlaybackSnapshot)
}
