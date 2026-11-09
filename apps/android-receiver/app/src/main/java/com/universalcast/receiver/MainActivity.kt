package com.universalcast.receiver

import android.app.Activity
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.universalcast.receiver.playback.Media3PlaybackEngine
import com.universalcast.receiver.playback.PlaybackEngine
import com.universalcast.receiver.playback.PlaybackLoadRequest
import com.universalcast.receiver.playback.PlaybackListener
import com.universalcast.receiver.playback.PlaybackSnapshot
import com.universalcast.receiver.discovery.MdnsDiscoveryManager
import com.universalcast.receiver.ucp.UcpWebSocketServer

/** M2.2 receiver UI: local playback and development UCP control share the PlaybackEngine contract. */
class MainActivity : Activity() {
    private lateinit var playbackEngine: PlaybackEngine
    private lateinit var media3Engine: Media3PlaybackEngine
    private lateinit var playerView: PlayerView
    private lateinit var statusView: TextView
    private lateinit var urlInput: EditText
    private lateinit var networkStatusView: TextView
    private lateinit var discoveryStatusView: TextView
    private var discoveryManager: MdnsDiscoveryManager? = null
    private var ucpServer: UcpWebSocketServer? = null
    private var secureUcpServer: UcpWebSocketServer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE

        media3Engine = Media3PlaybackEngine(this)
        playbackEngine = media3Engine
        setContentView(createContentView())
        media3Engine.attachPlayerView(playerView)
        if (BuildConfig.DEBUG) {
            ucpServer = UcpWebSocketServer(
                playback = playbackEngine,
                onStatus = { message -> runOnUiThread { networkStatusView.text = message } }
            ).also { it.start() }
            discoveryManager = MdnsDiscoveryManager(
                context = this,
                onStatus = { message -> runOnUiThread { discoveryStatusView.text = message } }
            ).also { it.start() }
            provisionTlsEndpoint()
        } else {
            networkStatusView.text = "Remote control is disabled until authenticated pairing is implemented."
            discoveryStatusView.text = "Receiver discovery is disabled in release builds."
        }
        playbackEngine.setListener(PlaybackListener(::renderSnapshot))
    }

    private fun createContentView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(12, 16, 24))
            setPadding(dp(28), dp(18), dp(28), dp(18))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val title = TextView(this).apply {
            text = "UniversalCast Receiver"
            setTextColor(Color.WHITE)
            textSize = 25f
            gravity = Gravity.CENTER_VERTICAL
        }
        root.addView(title, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(42)
        ))

        statusView = TextView(this).apply {
            text = "Media3 playback engine initialized • UCP server starting"
            setTextColor(Color.rgb(150, 190, 220))
            textSize = 14f
            gravity = Gravity.CENTER_VERTICAL
        }
        root.addView(statusView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(32)
        ))

        networkStatusView = TextView(this).apply {
            text = "UCP development server starting on port 8765…"
            setTextColor(Color.rgb(220, 180, 105))
            textSize = 12f
            gravity = Gravity.CENTER_VERTICAL
        }
        root.addView(networkStatusView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(26)
        ))

        discoveryStatusView = TextView(this).apply {
            text = "mDNS discovery starting…"
            setTextColor(Color.rgb(135, 190, 155))
            textSize = 12f
            gravity = Gravity.CENTER_VERTICAL
        }
        root.addView(discoveryStatusView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(24)
        ))

        val inputRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        urlInput = EditText(this).apply {
            hint = "Enter an HTTP(S) media URL"
            setSingleLine(true)
            textSize = 16f
            setTextColor(Color.WHITE)
            setHintTextColor(Color.LTGRAY)
            setSelectAllOnFocus(true)
            setPadding(dp(12), 0, dp(12), 0)
            setBackgroundColor(Color.rgb(34, 42, 55))
        }
        inputRow.addView(urlInput, LinearLayout.LayoutParams(0, dp(52), 1f))
        inputRow.addView(makeButton("Play URL") { playEnteredUrl() }, LinearLayout.LayoutParams(dp(150), dp(52)).apply {
            marginStart = dp(12)
        })
        root.addView(inputRow, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(58)
        ))

        playerView = PlayerView(this).apply {
            useController = true
            controllerAutoShow = true
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
            setBackgroundColor(Color.BLACK)
            contentDescription = "UniversalCast media playback"
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
        }
        root.addView(playerView, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ).apply {
            topMargin = dp(12)
            bottomMargin = dp(10)
        })

        val controls = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        controls.addView(makeButton("Pause") { playbackEngine.pause() })
        controls.addView(makeButton("Resume") { playbackEngine.play() }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)
        ).apply { marginStart = dp(10) })
        controls.addView(makeButton("Stop") { playbackEngine.stop() }, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)
        ).apply { marginStart = dp(10) })
        root.addView(controls, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(52)
        ))
        return root
    }

    private fun provisionTlsEndpoint() {
        Thread {
            runCatching {
                val identity = com.universalcast.receiver.security.ReceiverIdentity()
                val publicIdentity = identity.loadOrCreate()
                val tlsContext = identity.createServerTlsContext()
                publicIdentity to tlsContext
            }.onSuccess { (identity, tlsContext) ->
                runOnUiThread {
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    android.util.Log.i(
                        "UniversalCastIdentity",
                        "TLS development endpoint fingerprint: ${identity.certificateFingerprintSha256}"
                    )
                    secureUcpServer = UcpWebSocketServer(
                        playback = playbackEngine,
                        onStatus = { message -> runOnUiThread { networkStatusView.text = message } },
                        port = UcpWebSocketServer.DEVELOPMENT_TLS_PORT,
                        tlsContext = tlsContext
                    ).also { it.start() }
                }
            }.onFailure { error ->
                android.util.Log.e("UniversalCastIdentity", "TLS endpoint provisioning failed", error)
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        networkStatusView.text = "Secure development endpoint unavailable; see app log."
                    }
                }
            }
        }.start()
    }

    private fun makeButton(label: String, onClick: () -> Unit): Button = Button(this).apply {
        text = label
        isFocusable = true
        isFocusableInTouchMode = true
        textSize = 15f
        setOnClickListener { onClick() }
    }

    private fun playEnteredUrl() {
        val url = urlInput.text?.toString().orEmpty().trim()
        if (!MediaUrlValidator.isSupported(url)) {
            Toast.makeText(this, "Enter a valid HTTP(S) media URL without embedded credentials.", Toast.LENGTH_LONG).show()
            statusView.text = "Invalid media URL"
            return
        }
        try {
            playbackEngine.load(PlaybackLoadRequest(uri = url, title = "Manual URL media"))
                playbackEngine.play()
        } catch (error: IllegalArgumentException) {
            statusView.text = "Unable to load media: ${error.message}"
        }
    }

    private fun renderSnapshot(snapshot: PlaybackSnapshot) {
        runOnUiThread {
            val detail = when (snapshot.status) {
                com.universalcast.receiver.playback.PlaybackStatus.IDLE -> "Idle"
                com.universalcast.receiver.playback.PlaybackStatus.LOADING -> "Loading media…"
                com.universalcast.receiver.playback.PlaybackStatus.READY -> "Ready"
                com.universalcast.receiver.playback.PlaybackStatus.PLAYING -> "Playing"
                com.universalcast.receiver.playback.PlaybackStatus.PAUSED -> "Paused"
                com.universalcast.receiver.playback.PlaybackStatus.BUFFERING -> "Buffering media…"
                com.universalcast.receiver.playback.PlaybackStatus.ENDED -> "Playback ended"
                com.universalcast.receiver.playback.PlaybackStatus.ERROR -> "Playback error: ${snapshot.errorCode ?: "unknown"}"
            }
            statusView.text = "${snapshot.status.wireValue} • $detail • revision ${snapshot.revision}"
            ucpServer?.publishPlaybackSnapshot(snapshot)
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        if (::playerView.isInitialized && ::media3Engine.isInitialized) {
            media3Engine.detachPlayerView(playerView)
        }
        discoveryManager?.stop()
        discoveryManager = null
        ucpServer?.stopServer()
        ucpServer = null
        secureUcpServer?.stopServer()
        secureUcpServer = null
        if (::playbackEngine.isInitialized) playbackEngine.release()
        super.onDestroy()
    }
}
