package com.universalcast.receiver.ucp

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.universalcast.receiver.MediaUrlValidator
import com.universalcast.receiver.playback.PlaybackEngine
import com.universalcast.receiver.playback.PlaybackLoadRequest
import com.universalcast.receiver.playback.PlaybackSnapshot
import com.universalcast.receiver.security.PairingCoordinator
import com.universalcast.receiver.security.PairedSenderStore
import com.universalcast.receiver.security.Base64Url
import org.java_websocket.WebSocket
import org.java_websocket.server.DefaultSSLWebSocketServerFactory
import org.java_websocket.server.WebSocketServer
import org.java_websocket.framing.CloseFrame
import org.java_websocket.handshake.ClientHandshake
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.InetSocketAddress
import java.time.Instant
import java.util.LinkedHashMap
import java.util.UUID
import java.security.SecureRandom
import javax.net.ssl.SSLContext

/**
 * Development-only UCP 1.0 WebSocket endpoint.
 *
 * All protocol/session/player work is serialized onto the Android main looper because
 * Media3's player is main-looper confined. This endpoint is deliberately unauthenticated
 * and plain ws:// for trusted-LAN emulator testing only. It is not production secure.
 */
class UcpWebSocketServer(
    private val playback: PlaybackEngine,
    private val onStatus: (String) -> Unit,
    private val port: Int = DEFAULT_PORT,
    private val tlsContext: SSLContext? = null,
    private val pairingCoordinator: PairingCoordinator? = null,
    private val onPairingProposal: (PairingCoordinator.Proposal) -> Unit = {},
    private val onPairingCancelled: (String) -> Unit = {}
) : WebSocketServer(InetSocketAddress("0.0.0.0", port)) {

    companion object {
        const val DEFAULT_PORT = 8765
        const val DEVELOPMENT_TLS_PORT = 8766
        private const val AUTH_CHALLENGE_TTL_MILLIS = 30_000L
        private const val MAX_AUTH_ATTEMPTS = 3
        private const val UCP_VERSION = "1.0"
        private const val MAX_MESSAGE_CHARS = 256 * 1024
        private const val MAX_TRACKED_IDS = 1024
    }

    private data class ClientState(
        val connectionId: String = UUID.randomUUID().toString(),
        var incomingSeq: Long = 0L,
        var outgoingSeq: Long = 0L,
        var handshaken: Boolean = false,
        var helloRequestId: String? = null,
        var authNonce: String? = null,
        var authDeadlineElapsed: Long? = null,
        var authAttempts: Int = 0,
        var authenticatedSender: PairedSenderStore.Sender? = null,
        var controlledSessionId: String? = null,
        val seenIds: LinkedHashSet<String> = LinkedHashSet()
    )

    private data class PendingPairingConnection(val conn: WebSocket, val requestId: String)

    private data class SessionState(
        val id: String,
        val createdAt: String,
        var controllerConnectionId: String?,
        var lastPublishedRevision: Long
    )

    private val mainHandler = Handler(Looper.getMainLooper())
    private val clients = LinkedHashMap<WebSocket, ClientState>()
    private val sessions = LinkedHashMap<String, SessionState>()
    private val pendingPairingConnections = LinkedHashMap<String, PendingPairingConnection>()
    private val authRandom = SecureRandom()
    private var activeSessionId: String? = null
    private var deferStateEvents = false
    private var deferredSnapshot: PlaybackSnapshot? = null
    @Volatile private var stopping = false

    init {
        setReuseAddr(true)
        setConnectionLostTimeout(30)
        tlsContext?.let { setWebSocketFactory(DefaultSSLWebSocketServerFactory(it)) }
    }

    override fun onStart() {
        val scheme = if (tlsContext == null) "ws" else "wss"
        val mode = if (tlsContext == null) "plaintext" else "TLS 1.2; pairing and authentication enabled (debug)"
        mainHandler.post { onStatus("UCP $scheme development endpoint ready on port $port ($mode)") }
    }

    override fun onOpen(conn: WebSocket, handshake: ClientHandshake) {
        mainHandler.post {
            if (stopping) {
                conn.close(CloseFrame.GOING_AWAY, "Receiver is stopping")
                return@post
            }
            if (conn.resourceDescriptor != "/ucp") {
                conn.close(CloseFrame.POLICY_VALIDATION, "Only /ucp is supported")
                return@post
            }
            clients[conn] = ClientState()
            onStatus("UCP server ready • ${clients.size} client(s) • port $port")
        }
    }

    override fun onMessage(conn: WebSocket, message: String) {
        mainHandler.post {
            val client = clients[conn] ?: return@post
            if (message.length > MAX_MESSAGE_CHARS) {
                sendError(conn, client, "INVALID_MESSAGE", "Message exceeds the 256 KiB development limit.")
                return@post
            }
            handleRequest(conn, client, message)
        }
    }

    override fun onClose(conn: WebSocket, code: Int, reason: String, remote: Boolean) {
        mainHandler.post {
            val client = clients.remove(conn) ?: return@post
            client.controlledSessionId?.let { sessionId ->
                sessions[sessionId]?.let { session ->
                    if (session.controllerConnectionId == client.connectionId) {
                        session.controllerConnectionId = null
                    }
                }
            }
            val interruptedPairings = pendingPairingConnections.filterValues { it.conn == conn }.keys.toList()
            interruptedPairings.forEach { senderId ->
                pendingPairingConnections.remove(senderId)
                runCatching { pairingCoordinator?.reject(senderId) }
                onPairingCancelled(senderId)
            }
            onStatus("UCP client disconnected • ${clients.size} client(s) remain")
        }
    }

    override fun onError(conn: WebSocket?, ex: Exception) {
        mainHandler.post { onStatus("UCP server error: ${ex.message ?: ex.javaClass.simpleName}") }
    }

    /** Called by the Activity's PlaybackEngine listener on the main thread. */
    fun publishPlaybackSnapshot(snapshot: PlaybackSnapshot) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { publishPlaybackSnapshot(snapshot) }
            return
        }
        if (deferStateEvents) {
            deferredSnapshot = snapshot
            return
        }
        emitStateChanged(snapshot)
    }

    fun stopServer() {
        stopping = true
        Thread {
            runCatching { stop(1_000) }
            mainHandler.post {
                clients.clear()
                onStatus("UCP server stopped")
            }
        }.start()
    }

    private fun handleRequest(conn: WebSocket, client: ClientState, raw: String) {
        val request = try {
            JSONObject(raw)
        } catch (_: JSONException) {
            sendError(conn, client, "INVALID_MESSAGE", "Message must contain valid JSON.")
            return
        }

        val requestId = request.optString("id").takeIf { it.isNotBlank() && it.length <= 128 }
        if (request.optString("protocol") != "UCP" ||
            request.optString("type") != "request" ||
            request.optString("version").isBlank() ||
            requestId == null ||
            !request.has("sessionId") ||
            !request.has("seq") ||
            !isValidTimestamp(request.optString("sentAt")) ||
            request.optString("action").isBlank() || request.optString("action").length > 128 ||
            request.opt("payload") !is JSONObject
        ) {
            sendError(conn, client, "INVALID_MESSAGE", "Invalid UCP request envelope.", requestId)
            return
        }

        val sessionField = request.opt("sessionId")
        if (sessionField !== JSONObject.NULL && sessionField !is String) {
            sendError(conn, client, "INVALID_MESSAGE", "sessionId must be a string or null.", requestId)
            return
        }
        val seq = exactLong(request.opt("seq"))
        if (seq == null || seq <= 0L) {
            sendError(conn, client, "INVALID_MESSAGE", "seq must be a positive safe integer.", requestId)
            return
        }

        val version = request.optString("version")
        if (version != UCP_VERSION) {
            sendError(conn, client, "UNSUPPORTED_VERSION", "Unsupported envelope version: $version.", requestId,
                JSONObject().put("supportedVersions", JSONArray().put(UCP_VERSION)))
            return
        }
        if (client.seenIds.contains(requestId)) {
            sendError(conn, client, "INVALID_MESSAGE", "Duplicate request id on this connection.", requestId,
                JSONObject().put("reason", "DUPLICATE_REQUEST_ID"))
            return
        }
        if (seq <= client.incomingSeq) {
            sendError(conn, client, "INVALID_MESSAGE", "Request sequence must increase on this connection.", requestId,
                JSONObject().put("reason", "SEQUENCE_NOT_INCREASING").put("lastAcceptedSeq", client.incomingSeq).put("receivedSeq", seq))
            return
        }
        client.incomingSeq = seq
        client.seenIds.add(requestId)
        if (client.seenIds.size > MAX_TRACKED_IDS) client.seenIds.remove(client.seenIds.first())

        val action = request.getString("action")
        val payload = request.getJSONObject("payload")
        val envelopeSessionId = if (sessionField === JSONObject.NULL) null else sessionField as String

        if (!client.handshaken) {
            if (action != "connection.hello") {
                sendError(conn, client, "INVALID_MESSAGE", "connection.hello must be the first request on a connection.", requestId)
                return
            }
            val supported = payload.optJSONArray("supportedVersions")
            if (supported == null || !allStrings(supported)) {
                sendError(conn, client, "INVALID_MESSAGE", "connection.hello requires a supportedVersions string array.", requestId)
                return
            }
            if ((0 until supported.length()).none { supported.optString(it) == UCP_VERSION }) {
                sendError(conn, client, "UNSUPPORTED_VERSION", "No mutually supported UCP version was found.", requestId,
                    JSONObject().put("receiverSupportedVersions", JSONArray().put(UCP_VERSION)))
                return
            }
            client.handshaken = true
            if (tlsContext != null && pairingCoordinator != null) {
                sendAuthenticationChallenge(conn, client, requestId)
            } else {
                sendResponse(conn, client, "connection.welcome", requestId, null, welcomePayload())
            }
            return
        }

        if (action == "connection.hello") {
            sendError(conn, client, "INVALID_MESSAGE", "connection.hello may only be sent once per connection.", requestId)
            return
        }

        val secureEndpoint = tlsContext != null && pairingCoordinator != null
        if (secureEndpoint && client.authenticatedSender == null && action !in setOf("connection.auth.prove", "pairing.request")) {
            sendError(conn, client, "NOT_PAIRED", "Authenticate a paired sender or complete receiver pairing before using UCP.", requestId)
            return
        }
        if (client.authenticatedSender?.role == PairedSenderStore.Role.OBSERVER &&
            action !in setOf("connection.ping", "state.snapshot", "session.snapshot")) {
            sendError(conn, client, "NOT_AUTHORIZED", "Observer role cannot change playback or control sessions.", requestId)
            return
        }

        when (action) {
            "connection.auth.prove" -> authenticateConnection(conn, client, requestId, payload)
            "pairing.request" -> pairingRequest(conn, requestId, payload)
            "connection.ping" -> sendResponse(conn, client, "connection.pong", requestId, null,
                JSONObject().put("receivedAt", Instant.now().toString()).put("echo", payload))
            "session.create" -> createSession(conn, client, requestId, envelopeSessionId)
            "session.join" -> joinSession(conn, client, requestId, envelopeSessionId)
            "session.snapshot", "state.snapshot" -> sessionSnapshot(conn, client, requestId, envelopeSessionId)
            "session.leave" -> leaveSession(conn, client, requestId, envelopeSessionId)
            "media.load" -> loadMedia(conn, client, requestId, envelopeSessionId, payload)
            "media.unload", "playback.stop" -> stopPlayback(conn, client, requestId, envelopeSessionId)
            "playback.play" -> playbackCommand(conn, client, requestId, envelopeSessionId, action)
            "playback.pause" -> playbackCommand(conn, client, requestId, envelopeSessionId, action)
            "playback.seek" -> seekPlayback(conn, client, requestId, envelopeSessionId, payload)
            else -> sendError(conn, client, "UNSUPPORTED_ACTION", "Action not implemented by Android receiver: $action", requestId)
        }
    }

    private fun sendAuthenticationChallenge(conn: WebSocket, client: ClientState, helloRequestId: String) {
        val nonce = ByteArray(32).also(authRandom::nextBytes)
        val nonceText = Base64Url.encode(nonce)
        val expiresAtElapsed = SystemClock.elapsedRealtime() + AUTH_CHALLENGE_TTL_MILLIS
        client.helloRequestId = helloRequestId
        client.authNonce = nonceText
        client.authDeadlineElapsed = expiresAtElapsed
        sendEnvelope(conn, client, "event", "connection.auth.challenge", null,
            JSONObject()
                .put("receiverId", pairingCoordinator?.stableReceiverId)
                .put("nonce", nonceText)
                .put("protocolVersion", UCP_VERSION)
                .put("expiresInMs", AUTH_CHALLENGE_TTL_MILLIS), null)
    }

    private fun authenticateConnection(conn: WebSocket, client: ClientState, requestId: String, payload: JSONObject) {
        val coordinator = pairingCoordinator
        if (coordinator == null) {
            sendError(conn, client, "AUTH_UNAVAILABLE", "Sender authentication is unavailable.", requestId)
            return
        }
        if (client.authenticatedSender != null) {
            sendError(conn, client, "AUTH_CHALLENGE_INVALID", "This connection is already authenticated.", requestId)
            return
        }
        val nonce = client.authNonce
        if (nonce == null) {
            client.authAttempts += 1
            sendError(conn, client, "AUTH_CHALLENGE_INVALID", "No unused authentication challenge is pending.", requestId)
            if (client.authAttempts >= MAX_AUTH_ATTEMPTS) conn.close(CloseFrame.POLICY_VALIDATION, "Authentication challenge replayed")
            return
        }
        if ((client.authDeadlineElapsed ?: 0L) <= SystemClock.elapsedRealtime()) {
            client.authNonce = null
            client.authDeadlineElapsed = null
            sendError(conn, client, "AUTH_CHALLENGE_EXPIRED", "The authentication challenge expired.", requestId)
            return
        }
        // Consume before processing any proof so a nonce cannot be tried repeatedly.
        client.authNonce = null
        client.authDeadlineElapsed = null
        try {
            val senderId = payload.getString("senderId")
            val signatureText = payload.getString("signature")
            require(signatureText.length <= 96) { "Sender proof is too large." }
            val knownSender = coordinator.pairedSender(senderId)
                ?: return sendError(conn, client, "NOT_PAIRED", "This sender is not paired with the receiver.", requestId)
            val signature = Base64Url.decode(signatureText)
            require(signature.size in 8..72) { "Sender signature has an invalid length." }
            val authenticated = runCatching {
                coordinator.authenticate(senderId, UCP_VERSION, nonce, signature)
            }.getOrNull() ?: run {
                client.authAttempts += 1
                sendError(conn, client, "NOT_AUTHORIZED", "Sender signature did not prove possession of the paired key.", requestId)
                if (client.authAttempts >= MAX_AUTH_ATTEMPTS) conn.close(CloseFrame.POLICY_VALIDATION, "Authentication failed")
                return
            }
            client.authenticatedSender = authenticated
            sendResponse(conn, client, "connection.authenticated", requestId, null,
                JSONObject().put("senderId", authenticated.senderId).put("role", authenticated.role.wireValue))
            client.helloRequestId?.let { helloId ->
                sendResponse(conn, client, "connection.welcome", helloId, null, welcomePayload(knownSender))
                client.helloRequestId = null
            }
        } catch (error: Exception) {
            sendError(conn, client, "INVALID_MESSAGE", error.message ?: "Invalid authentication proof.", requestId)
        }
    }
    fun revokePairedSender(senderId: String): Boolean {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { revokePairedSender(senderId) }
            return false
        }
        val removed = pairingCoordinator?.revoke(senderId) ?: false
        if (removed) {
            clients.filterValues { it.authenticatedSender?.senderId == senderId }
                .keys.toList()
                .forEach { it.close(CloseFrame.POLICY_VALIDATION, "Sender revoked") }
        }
        return removed
    }
    private fun pairingRequest(conn: WebSocket, requestId: String, payload: JSONObject) {
        val coordinator = pairingCoordinator
        if (tlsContext == null || coordinator == null) {
            sendError(conn, clients[conn] ?: return, "PAIRING_UNAVAILABLE", "Pairing is available only on the TLS receiver endpoint.", requestId)
            return
        }
        try {
            val challenge = payload.getString("challenge")
            val senderId = payload.getString("senderId")
            val displayName = payload.getString("displayName")
            val publicKeyText = payload.getString("senderPublicKey")
            val nonce = payload.getString("senderNonce")
            val signatureText = payload.getString("signature")
            require(publicKeyText.length <= 2048 && signatureText.length <= 256) { "Sender proof is too large." }
            val proposal = coordinator.submit(
                PairingCoordinator.Request(
                    challenge = challenge,
                    senderId = senderId,
                    displayName = displayName,
                    publicKey = Base64Url.decode(publicKeyText),
                    senderNonce = nonce,
                    signature = Base64Url.decode(signatureText)
                )
            )
            pendingPairingConnections[senderId] = PendingPairingConnection(conn, requestId)
            val client = clients[conn] ?: return
            sendResponse(conn, client, "pairing.awaiting_approval", requestId, null,
                JSONObject().put("senderId", senderId).put("shortAuthenticationString", proposal.shortAuthenticationString))
            onPairingProposal(proposal)
        } catch (error: PairingCoordinator.PairingException) {
            clients[conn]?.let { sendError(conn, it, error.code, error.message ?: "Pairing request rejected.", requestId) }
        } catch (error: Exception) {
            clients[conn]?.let { sendError(conn, it, "PAIRING_INVALID_SENDER", error.message ?: "Invalid pairing request.", requestId) }
        }
    }

    fun approvePairing(senderId: String, role: PairedSenderStore.Role): Boolean {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { approvePairing(senderId, role) }
            return false
        }
        val connection = pendingPairingConnections.remove(senderId) ?: return false
        val client = clients[connection.conn] ?: return false
        return try {
            val sender = pairingCoordinator?.approve(senderId, role)
                ?: throw IllegalStateException("Pairing coordinator is unavailable.")
            sendResponse(connection.conn, client, "pairing.approved", connection.requestId, null,
                JSONObject().put("senderId", sender.senderId).put("role", sender.role.wireValue)
                    .put("senderFingerprintSha256", sender.fingerprintSha256))
            onStatus("Paired ${sender.displayName} as ${sender.role.wireValue} • ${pairingCoordinator.pairedSenders().size} sender(s)")
            true
        } catch (error: Exception) {
            sendError(connection.conn, client, "PAIRING_FAILED", error.message ?: "Pairing could not be saved.", connection.requestId)
            false
        }
    }
    fun rejectPairing(senderId: String) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post { rejectPairing(senderId) }
            return
        }
        val connection = pendingPairingConnections.remove(senderId) ?: return
        runCatching { pairingCoordinator?.reject(senderId) }
        clients[connection.conn]?.let {
            sendError(connection.conn, it, "PAIRING_REJECTED", "Pairing was rejected on the receiver.", connection.requestId)
        }
    }
    private fun createSession(conn: WebSocket, client: ClientState, requestId: String, envelopeSessionId: String?) {
        if (envelopeSessionId != null) {
            sendError(conn, client, "INVALID_MESSAGE", "session.create must use sessionId: null.", requestId)
            return
        }
        if (activeSessionId != null) {
            sendError(conn, client, "NOT_AUTHORIZED", "The receiver already has an active playback session.", requestId,
                JSONObject().put("reason", "SESSION_IN_USE"))
            return
        }
        val id = UUID.randomUUID().toString()
        val now = Instant.now().toString()
        val current = playback.snapshot()
        sessions[id] = SessionState(id, now, client.connectionId, current.revision)
        activeSessionId = id
        client.controlledSessionId = id
        sendResponse(conn, client, "session.created", requestId, id,
            JSONObject().put("sessionId", id).put("createdAt", now).put("snapshot", snapshotJson(current)))
    }

    private fun joinSession(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?) {
        if (sessionId.isNullOrBlank()) {
            sendError(conn, client, "INVALID_MESSAGE", "session.join requires a sessionId.", requestId)
            return
        }
        val session = sessions[sessionId]
        if (session == null || sessionId != activeSessionId) {
            sendError(conn, client, "SESSION_NOT_FOUND", "The requested session does not exist.", requestId)
            return
        }
        if (session.controllerConnectionId != null && session.controllerConnectionId != client.connectionId) {
            sendError(conn, client, "NOT_AUTHORIZED", "The session already has an active controller.", requestId,
                JSONObject().put("reason", "SESSION_IN_USE"))
            return
        }
        session.controllerConnectionId = client.connectionId
        session.lastPublishedRevision = playback.snapshot().revision
        client.controlledSessionId = sessionId
        sendResponse(conn, client, "session.joined", requestId, sessionId,
            JSONObject().put("sessionId", sessionId).put("snapshot", snapshotJson(playback.snapshot())))
    }

    private fun sessionSnapshot(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?) {
        val isObserver = client.authenticatedSender?.role == PairedSenderStore.Role.OBSERVER
        if (isObserver) {
            if (sessionId.isNullOrBlank() || sessions[sessionId] == null || sessionId != activeSessionId) {
                sendError(conn, client, "SESSION_NOT_FOUND", "The requested session does not exist.", requestId)
                return
            }
            sendResponse(conn, client, "session.snapshot", requestId, sessionId,
                JSONObject().put("sessionId", sessionId).put("snapshot", snapshotJson(playback.snapshot())))
            return
        }
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        sendResponse(conn, client, "session.snapshot", requestId, session.id,
            JSONObject().put("sessionId", session.id).put("snapshot", snapshotJson(playback.snapshot())))
    }

    private fun leaveSession(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?) {
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        session.controllerConnectionId = null
        client.controlledSessionId = null
        sendResponse(conn, client, "session.left", requestId, session.id,
            JSONObject().put("sessionId", session.id).put("playbackPreserved", true))
    }

    private fun loadMedia(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?, payload: JSONObject) {
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        val media = payload.optJSONObject("media")
        if (media == null) {
            sendError(conn, client, "INVALID_MESSAGE", "media.load requires a media object.", requestId)
            return
        }
        val mediaId = media.optString("mediaId").trim()
        val title = media.optString("title").trim()
        val sources = media.optJSONArray("sources")
        if (mediaId.isEmpty() || mediaId.length > 256 || title.isEmpty() || sources == null || sources.length() !in 1..8) {
            sendError(conn, client, "INVALID_MESSAGE", "media requires mediaId, title and one to eight sources.", requestId)
            return
        }

        var selected: JSONObject? = null
        for (index in 0 until sources.length()) {
            val source = sources.optJSONObject(index) ?: continue
            val uri = source.optString("uri")
            val mime = source.optString("mimeType").substringBefore(';').lowercase()
            val protocol = source.optString("protocol", "unknown").lowercase()
            if (!MediaUrlValidator.isSupported(uri)) continue
            if (mime.isBlank() || mime !in playback.capabilities.mimeTypes.map { it.lowercase() }) continue
            if (protocol == "dash" || (protocol != "unknown" && protocol !in playback.capabilities.sourceProtocols)) continue
            val delivery = source.optString("delivery")
            if (delivery.isNotEmpty() && delivery !in setOf("local", "remote")) continue
            if (delivery == "local" && !source.has("expiresAt")) continue
            if (source.has("expiresAt")) {
                val expiry = parseInstant(source.optString("expiresAt"))
                if (expiry == null || !expiry.isAfter(Instant.now())) continue
            }
            selected = source
            break
        }
        if (selected == null) {
            sendError(conn, client, "UNSUPPORTED_MEDIA", "No source matches the receiver's HTTP(S), MIME and protocol capabilities.", requestId)
            return
        }
        val startPosition = if (media.has("startPositionMs")) exactLong(media.opt("startPositionMs")) else 0L
        if (startPosition == null || startPosition < 0L) {
            sendError(conn, client, "INVALID_MESSAGE", "startPositionMs must be a non-negative integer.", requestId)
            return
        }
        val mime = selected.optString("mimeType").substringBefore(';').lowercase()
        val uri = selected.optString("uri")

        executePlaybackCommand {
            try {
                playback.load(PlaybackLoadRequest(uri, mediaId, title, mime, startPosition))
                val current = playback.snapshot()
                sendResponse(conn, client, "media.loaded", requestId, session.id,
                    JSONObject().put("status", "accepted").put("snapshot", snapshotJson(current)).put("changed", true))
            } catch (error: Exception) {
                sendError(conn, client, "MEDIA_UNAVAILABLE", error.message ?: "Media could not be loaded.", requestId)
            }
        }
    }

    private fun playbackCommand(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?, action: String) {
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        val before = playback.snapshot()
        if (before.mediaId == null) {
            sendError(conn, client, "INVALID_MESSAGE", "No media is loaded.", requestId, JSONObject().put("reason", "INVALID_STATE"))
            return
        }
        executePlaybackCommand {
            try {
                if (action == "playback.play") playback.play() else playback.pause()
                val current = playback.snapshot()
                val responseAction = if (action == "playback.play") "playback.playing" else "playback.paused"
                sendResponse(conn, client, responseAction, requestId, session.id,
                    JSONObject().put("status", "accepted").put("snapshot", snapshotJson(current)).put("changed", current.revision != before.revision))
            } catch (error: Exception) {
                sendError(conn, client, "INTERNAL_ERROR", error.message ?: "Playback command failed.", requestId)
            }
        }
    }

    private fun seekPlayback(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?, payload: JSONObject) {
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        val position = exactLong(payload.opt("positionMs"))
        val current = playback.snapshot()
        if (current.mediaId == null || position == null || position < 0L || (current.durationMs != null && position > current.durationMs)) {
            sendError(conn, client, "INVALID_MESSAGE", "positionMs must be a valid position within the loaded media duration.", requestId,
                JSONObject().put("reason", "INVALID_POSITION"))
            return
        }
        executePlaybackCommand {
            try {
                playback.seekTo(position)
                sendResponse(conn, client, "playback.seeked", requestId, session.id,
                    JSONObject().put("status", "accepted").put("snapshot", snapshotJson(playback.snapshot())).put("changed", true))
            } catch (error: Exception) {
                sendError(conn, client, "INTERNAL_ERROR", error.message ?: "Seek command failed.", requestId)
            }
        }
    }

    private fun stopPlayback(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?) {
        val session = controlledSession(conn, client, requestId, sessionId) ?: return
        executePlaybackCommand {
            try {
                playback.stop()
                sendResponse(conn, client, "playback.stopped", requestId, session.id,
                    JSONObject().put("status", "accepted").put("snapshot", snapshotJson(playback.snapshot())).put("changed", true))
            } catch (error: Exception) {
                sendError(conn, client, "INTERNAL_ERROR", error.message ?: "Stop command failed.", requestId)
            }
        }
    }

    private fun controlledSession(conn: WebSocket, client: ClientState, requestId: String, sessionId: String?): SessionState? {
        if (sessionId.isNullOrBlank()) {
            sendError(conn, client, "INVALID_MESSAGE", "This action requires a sessionId.", requestId)
            return null
        }
        val session = sessions[sessionId]
        if (session == null || sessionId != activeSessionId) {
            sendError(conn, client, "SESSION_NOT_FOUND", "The requested session does not exist.", requestId)
            return null
        }
        if (session.controllerConnectionId != client.connectionId || client.controlledSessionId != sessionId) {
            sendError(conn, client, "NOT_AUTHORIZED", "This connection is not the active session controller.", requestId)
            return null
        }
        return session
    }

    private fun executePlaybackCommand(block: () -> Unit) {
        deferStateEvents = true
        deferredSnapshot = null
        try {
            block()
        } finally {
            deferStateEvents = false
            deferredSnapshot?.let { emitStateChanged(it) }
            deferredSnapshot = null
        }
    }

    private fun emitStateChanged(snapshot: PlaybackSnapshot) {
        val sessionId = activeSessionId ?: return
        val session = sessions[sessionId] ?: return
        if (session.controllerConnectionId == null || snapshot.revision <= session.lastPublishedRevision) return
        val conn = clients.entries.firstOrNull { it.value.connectionId == session.controllerConnectionId }?.key ?: return
        val client = clients[conn] ?: return
        session.lastPublishedRevision = snapshot.revision
        sendEnvelope(conn, client, "event", "state.changed", sessionId, JSONObject().put("snapshot", snapshotJson(snapshot)), null)
    }

    private fun welcomePayload(sender: PairedSenderStore.Sender? = null): JSONObject {
        val capabilities = playback.capabilities
        val formats = JSONArray()
        capabilities.mimeTypes.sorted().forEach { formats.put(it) }
        val playbackCaps = JSONObject()
            .put("seek", capabilities.supportsSeeking)
            .put("rate", capabilities.supportsPlaybackRate)
            .put("minRate", capabilities.minPlaybackRate.toDouble())
            .put("maxRate", capabilities.maxPlaybackRate.toDouble())
        return JSONObject()
            .put("device", JSONObject().put("name", "UniversalCast Android TV").put("platform", "android-tv").put("simulator", false))
            .put("protocolVersions", JSONArray().put(UCP_VERSION))
            .put("negotiatedVersion", UCP_VERSION)
            .put("capabilities", JSONObject()
                .put("media", JSONObject()
                    .put("formats", formats)
                    .put("hls", capabilities.sourceProtocols.contains("hls"))
                    .put("dash", capabilities.sourceProtocols.contains("dash"))
                    .put("progressiveHttp", capabilities.sourceProtocols.contains("progressive")))
                .put("playback", playbackCaps)
                .put("tracks", JSONObject()
                    .put("audioSelect", capabilities.supportsAudioTrackSelection)
                    .put("subtitleExternal", false)
                    .put("subtitleSelect", capabilities.supportsSubtitleTrackSelection))
                .put("volume", JSONObject().put("set", false).put("mute", false)))
            .put("security", JSONObject()
                .put("mode", if (sender != null) "paired-sender" else "development-unauthenticated-lan")
                .put("authenticated", sender != null)
                .put("senderId", sender?.senderId ?: JSONObject.NULL)
                .put("role", sender?.role?.wireValue ?: JSONObject.NULL))
    }

    private fun snapshotJson(snapshot: PlaybackSnapshot): JSONObject = JSONObject()
        .put("revision", snapshot.revision)
        .put("status", snapshot.status.wireValue)
        .put("mediaId", snapshot.mediaId ?: JSONObject.NULL)
        .put("positionMs", snapshot.positionMs ?: JSONObject.NULL)
        .put("durationMs", snapshot.durationMs ?: JSONObject.NULL)
        .put("bufferedMs", snapshot.bufferedMs ?: JSONObject.NULL)
        .put("playbackRate", snapshot.playbackRate.toDouble())
        .put("updatedAt", Instant.ofEpochMilli(snapshot.updatedAtEpochMs).toString())

    private fun sendResponse(conn: WebSocket, client: ClientState, action: String, replyTo: String, sessionId: String?, payload: JSONObject) {
        sendEnvelope(conn, client, "response", action, sessionId, payload, replyTo)
    }

    private fun sendError(
        conn: WebSocket,
        client: ClientState,
        code: String,
        message: String,
        replyTo: String? = null,
        details: JSONObject? = null
    ) {
        val payload = JSONObject().put("code", code).put("message", message).put("retryable", false)
        if (details != null) payload.put("details", details)
        sendEnvelope(conn, client, "error", "error", null, payload, replyTo)
    }

    private fun sendEnvelope(
        conn: WebSocket,
        client: ClientState,
        type: String,
        action: String,
        sessionId: String?,
        payload: JSONObject,
        replyTo: String?
    ) {
        if (!conn.isOpen) return
        val envelope = JSONObject()
            .put("protocol", "UCP")
            .put("version", UCP_VERSION)
            .put("type", type)
            .put("id", UUID.randomUUID().toString())
            .put("sessionId", sessionId ?: JSONObject.NULL)
            .put("seq", ++client.outgoingSeq)
            .put("sentAt", Instant.now().toString())
            .put("action", action)
            .put("payload", payload)
        if (replyTo != null) envelope.put("replyTo", replyTo)
        runCatching { conn.send(envelope.toString()) }
    }

    private fun allStrings(array: JSONArray): Boolean = (0 until array.length()).all { array.opt(it) is String }

    private fun exactLong(value: Any?): Long? {
        if (value !is Number) return null
        val double = value.toDouble()
        if (!double.isFinite() || double < 0.0 || double > 9_007_199_254_740_991.0) return null
        val long = value.toLong()
        return long.takeIf { it.toDouble() == double }
    }

    private fun parseInstant(value: String): Instant? = runCatching { Instant.parse(value) }.getOrNull()

    private fun isValidTimestamp(value: String): Boolean = parseInstant(value) != null
}
