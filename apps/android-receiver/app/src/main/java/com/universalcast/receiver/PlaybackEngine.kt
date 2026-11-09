package com.universalcast.receiver

import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Small platform playback boundary. UCP commands will call this interface;
 * protocol parsing and authorization must remain outside the media engine.
 */
class PlaybackEngine(context: Context) {
    val player: ExoPlayer = ExoPlayer.Builder(context.applicationContext).build()

    fun load(uri: Uri) {
        require(uri.scheme == "http" || uri.scheme == "https") {
            "Only HTTP(S) media URLs are supported."
        }
        player.setMediaItem(MediaItem.fromUri(uri))
        player.prepare()
        player.play()
    }

    fun play() = player.play()

    fun pause() = player.pause()

    fun seek(positionMs: Long) {
        require(positionMs >= 0) { "Seek position cannot be negative." }
        player.seekTo(positionMs)
    }

    fun stop() = player.stop()

    fun release() = player.release()

    fun addListener(listener: Player.Listener) = player.addListener(listener)

    fun removeListener(listener: Player.Listener) = player.removeListener(listener)
}
