package com.universalcast.receiver.playback

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.util.UUID
import com.universalcast.receiver.MediaUrlValidator

/** AndroidX Media3 implementation of the platform-neutral PlaybackEngine contract. */
class Media3PlaybackEngine(context: Context) : PlaybackEngine {
    private val player = ExoPlayer.Builder(context.applicationContext).build()
    private var listener: PlaybackListener? = null
    private var mediaId: String? = null
    private var title: String? = null
    private var hasStartedPlayback = false
    private var errorCode: String? = null
    private var revision = 0L
    private var lastPublished: PlaybackSnapshot? = null
    private var released = false

    override val capabilities: PlaybackCapabilities = PlaybackCapabilities.media3Baseline()

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) = publishIfChanged()
        override fun onIsPlayingChanged(isPlaying: Boolean) = publishIfChanged()
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) = publishIfChanged()
        override fun onPlaybackParametersChanged(playbackParameters: PlaybackParameters) = publishIfChanged()
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            mediaId = mediaItem?.mediaId
            title = mediaItem?.mediaMetadata?.title?.toString() ?: title
            publishIfChanged()
        }
        override fun onTimelineChanged(timeline: Timeline, reason: Int) = publishIfChanged()
        override fun onPlayerError(error: PlaybackException) {
            errorCode = error.errorCodeName
            publishIfChanged()
        }
        override fun onEvents(player: Player, events: Player.Events) = publishIfChanged()
    }

    init {
        player.addListener(playerListener)
        lastPublished = buildSnapshot()
    }

    /** Attaches the platform-specific video surface without exposing Media3 in PlaybackEngine. */
    fun attachPlayerView(view: PlayerView) {
        checkNotReleased()
        view.player = player
    }

    fun detachPlayerView(view: PlayerView) {
        if (!released && view.player === player) view.player = null
    }

    override fun setListener(listener: PlaybackListener?) {
        this.listener = listener
        listener?.onPlaybackSnapshot(snapshot())
    }

    override fun load(request: PlaybackLoadRequest) {
        checkNotReleased()
        require(MediaUrlValidator.isSupported(request.uri)) {
            "Only valid HTTP(S) media URLs without embedded credentials are supported."
        }
        require(request.startPositionMs >= 0L) { "startPositionMs must not be negative." }

        errorCode = null
        hasStartedPlayback = false
        mediaId = request.mediaId?.takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString()
        title = request.title?.takeIf { it.isNotBlank() }

        val metadata = MediaMetadata.Builder().apply {
            title?.let { setTitle(it) }
        }.build()
        val item = MediaItem.Builder()
            .setUri(request.uri)
            .setMediaId(mediaId!!)
            .setMediaMetadata(metadata)
            .apply { request.mimeType?.takeIf { it.isNotBlank() }?.let { setMimeType(it) } }
            .build()

        player.setMediaItem(item, request.startPositionMs)
        player.prepare()
        publishIfChanged()
    }

    override fun play() {
        checkNotReleased()
        if (player.currentMediaItem == null) return
        errorCode = null
        hasStartedPlayback = true
        player.play()
        publishIfChanged()
    }

    override fun pause() {
        checkNotReleased()
        if (player.currentMediaItem == null) return
        hasStartedPlayback = true
        player.pause()
        publishIfChanged()
    }

    override fun seekTo(positionMs: Long) {
        checkNotReleased()
        require(positionMs >= 0L) { "Seek position must not be negative." }
        if (player.currentMediaItem == null) return
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it >= 0L }
        val target = if (duration != null) positionMs.coerceAtMost(duration) else positionMs
        player.seekTo(target)
        publishIfChanged()
    }

    override fun setPlaybackRate(rate: Float) {
        checkNotReleased()
        require(rate.isFinite() && rate in capabilities.minPlaybackRate..capabilities.maxPlaybackRate) {
            "Playback rate must be between ${capabilities.minPlaybackRate} and ${capabilities.maxPlaybackRate}."
        }
        player.setPlaybackParameters(PlaybackParameters(rate))
        publishIfChanged()
    }

    override fun stop() {
        checkNotReleased()
        player.stop()
        player.clearMediaItems()
        mediaId = null
        title = null
        hasStartedPlayback = false
        errorCode = null
        publishIfChanged()
    }

    override fun snapshot(): PlaybackSnapshot = buildSnapshot()

    private fun buildSnapshot(): PlaybackSnapshot {
        val hasMedia = player.currentMediaItem != null
        val phase = when (player.playbackState) {
            Player.STATE_BUFFERING -> EnginePhase.BUFFERING
            Player.STATE_READY -> EnginePhase.READY
            Player.STATE_ENDED -> EnginePhase.ENDED
            else -> EnginePhase.IDLE
        }
        val status = PlaybackStateMapper.map(
            phase = phase,
            hasMedia = hasMedia,
            isPlaying = player.isPlaying,
            playWhenReady = player.playWhenReady,
            hasStartedPlayback = hasStartedPlayback,
            hasError = errorCode != null
        )
        val position = if (hasMedia) player.currentPosition.coerceAtLeast(0L) else null
        val buffered = if (hasMedia) {
            (player.bufferedPosition - player.currentPosition).coerceAtLeast(0L)
        } else null
        val duration = player.duration.takeIf { hasMedia && it != C.TIME_UNSET && it >= 0L }
        return PlaybackSnapshot(
            revision = revision,
            status = status,
            mediaId = mediaId,
            title = title,
            positionMs = position,
            durationMs = duration,
            bufferedMs = buffered,
            playbackRate = player.playbackParameters.speed,
            updatedAtEpochMs = System.currentTimeMillis(),
            errorCode = errorCode
        )
    }

    /** Publishes only when externally relevant state changes; position is sampled on snapshot(). */
    private fun publishIfChanged() {
        if (released) return
        val candidate = buildSnapshot()
        val previous = lastPublished
        val comparableCandidate = candidate.copy(revision = previous?.revision ?: 0L, updatedAtEpochMs = 0L)
        val comparablePrevious = previous?.copy(updatedAtEpochMs = 0L)
        if (previous == null || comparableCandidate != comparablePrevious) {
            revision += 1L
            val published = candidate.copy(revision = revision)
            lastPublished = published
            listener?.onPlaybackSnapshot(published)
        }
    }

    override fun release() {
        if (released) return
        listener = null
        player.removeListener(playerListener)
        player.release()
        released = true
    }

    private fun checkNotReleased() {
        check(!released) { "PlaybackEngine has already been released." }
    }
}
