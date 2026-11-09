import { randomUUID } from "node:crypto";
import type { UcpEnvelope, UcpErrorPayload } from "@universalcast/protocol-types";
import { SessionManager, type MediaRecord, type SessionFailureReason } from "./sessions.js";

export const UCP_VERSION = "1.0" as const;
const MAX_MESSAGE_ID_LENGTH = 128;
const MAX_ACTION_LENGTH = 128;
const MAX_TRACKED_REQUEST_IDS = 1024;

export interface ProtocolConnectionOptions {
  deviceName: string;
  connectionId?: string;
  sessions?: SessionManager;
}

export interface ProtocolConnection {
  handle(raw: string): UcpEnvelope[];
  disconnect(): void;
  eventForSession(sessionId: string, action: string, payload: Record<string, unknown>): UcpEnvelope | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isEnvelopeShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return value.protocol === "UCP" &&
    typeof value.version === "string" && value.version.length > 0 &&
    value.type === "request" &&
    typeof value.id === "string" && value.id.length > 0 && value.id.length <= MAX_MESSAGE_ID_LENGTH &&
    (typeof value.sessionId === "string" || value.sessionId === null) &&
    Number.isSafeInteger(value.seq) && (value.seq as number) > 0 &&
    isTimestamp(value.sentAt) &&
    typeof value.action === "string" && value.action.length > 0 && value.action.length <= MAX_ACTION_LENGTH &&
    isRecord(value.payload);
}

function validateMedia(value: unknown): { ok: true; media: MediaRecord } | { ok: false; code: UcpErrorPayload["code"]; message: string; details?: Record<string, unknown> } {
  if (!isRecord(value) || typeof value.mediaId !== "string" || !value.mediaId.trim() || value.mediaId.length > 256 ||
      typeof value.title !== "string" || !value.title.trim() || !Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 8) {
    return { ok: false, code: "INVALID_MESSAGE", message: "media.load requires mediaId, title and between one and eight sources." };
  }
  const sources: MediaRecord["sources"] = [];
  for (const [index, source] of value.sources.entries()) {
    if (!isRecord(source) || typeof source.uri !== "string" || typeof source.mimeType !== "string" ||
        !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;.*)?$/i.test(source.mimeType)) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Media source ${index} requires a valid URI and MIME type.` };
    }
    let parsed: URL;
    try { parsed = new URL(source.uri); } catch {
      return { ok: false, code: "INVALID_MEDIA_URI", message: `Media source ${index} has an invalid URI.` };
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { ok: false, code: "INVALID_MEDIA_URI", message: `Media source ${index} must use HTTP(S) without embedded credentials.` };
    }
    const protocol = source.protocol;
    if (protocol !== undefined && !["hls", "dash", "progressive", "unknown"].includes(String(protocol))) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Media source ${index} has an unsupported protocol value.` };
    }
    const delivery = source.delivery;
    if (delivery !== undefined && !["remote", "local"].includes(String(delivery))) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Media source ${index} has an unsupported delivery value.` };
    }
    if (source.expiresAt !== undefined && !isTimestamp(source.expiresAt)) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Media source ${index} expiresAt must be an RFC 3339 timestamp.` };
    }
    if (delivery === "local" && !source.expiresAt) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Local media source ${index} must include expiresAt.` };
    }
    if (delivery === "local" && Date.parse(source.expiresAt as string) <= Date.now()) {
      return { ok: false, code: "INVALID_MESSAGE", message: `Local media source ${index} grant has already expired.` };
    }
    sources.push({ uri: parsed.toString(), mimeType: source.mimeType, ...(protocol ? { protocol: protocol as MediaRecord["sources"][number]["protocol"] } : {}),
      ...(delivery ? { delivery: delivery as MediaRecord["sources"][number]["delivery"] } : {}), ...(source.expiresAt ? { expiresAt: source.expiresAt as string } : {}) });
  }
  const startPositionMs = value.startPositionMs;
  if (startPositionMs !== undefined && (!Number.isSafeInteger(startPositionMs) || (startPositionMs as number) < 0)) {
    return { ok: false, code: "INVALID_MESSAGE", message: "startPositionMs must be a non-negative integer." };
  }
  const metadata = value.metadata;
  if (metadata !== undefined && !isRecord(metadata)) return { ok: false, code: "INVALID_MESSAGE", message: "media.metadata must be an object." };
  if (isRecord(metadata) && metadata.durationMs !== undefined &&
      (!Number.isSafeInteger(metadata.durationMs) || (metadata.durationMs as number) < 0)) {
    return { ok: false, code: "INVALID_MESSAGE", message: "metadata.durationMs must be a non-negative integer." };
  }
  if (isRecord(metadata)) {
    for (const field of ["width", "height", "bitrate"] as const) {
      const n = metadata[field];
      if (n !== undefined && (!Number.isSafeInteger(n) || (n as number) <= 0)) {
        return { ok: false, code: "INVALID_MESSAGE", message: `media.metadata.${field} must be a positive integer.` };
      }
    }
  }
  const tracks: NonNullable<MediaRecord["tracks"]> = [];
  if (value.tracks !== undefined && !Array.isArray(value.tracks)) return { ok: false, code: "INVALID_MESSAGE", message: "media.tracks must be an array." };
  if (Array.isArray(value.tracks)) {
    if (value.tracks.length > 32) return { ok: false, code: "INVALID_MESSAGE", message: "media.tracks cannot contain more than 32 entries." };
    const trackIds = new Set<string>();
    for (const [index, track] of value.tracks.entries()) {
      if (!isRecord(track) || typeof track.id !== "string" || !track.id.trim() || track.id.length > 128 ||
          !["audio", "subtitle"].includes(String(track.kind))) {
        return { ok: false, code: "INVALID_MESSAGE", message: `Media track ${index} requires a unique id and audio/subtitle kind.` };
      }
      if (trackIds.has(track.id)) return { ok: false, code: "INVALID_MESSAGE", message: `Media track ${index} has a duplicate id.` };
      trackIds.add(track.id);
      for (const field of ["language", "label", "mimeType", "uri"] as const) {
        if (track[field] !== undefined && typeof track[field] !== "string") return { ok: false, code: "INVALID_MESSAGE", message: `Media track ${index}.${field} must be a string.` };
      }
      if (track.uri !== undefined) {
        let trackUrl: URL;
        try { trackUrl = new URL(track.uri as string); } catch { return { ok: false, code: "INVALID_MEDIA_URI", message: `Media track ${index} has an invalid URI.` }; }
        if (!["http:", "https:"].includes(trackUrl.protocol) || trackUrl.username || trackUrl.password) return { ok: false, code: "INVALID_MEDIA_URI", message: `Media track ${index} URI must use HTTP(S) without credentials.` };
      }
      if (track.isDefault !== undefined && typeof track.isDefault !== "boolean") return { ok: false, code: "INVALID_MESSAGE", message: `Media track ${index}.isDefault must be boolean.` };
      if (track.forced !== undefined && typeof track.forced !== "boolean") return { ok: false, code: "INVALID_MESSAGE", message: `Media track ${index}.forced must be boolean.` };
      tracks.push({ id: track.id, kind: track.kind as "audio" | "subtitle", ...(track.language ? { language: track.language as string } : {}),
        ...(track.label ? { label: track.label as string } : {}), ...(track.mimeType ? { mimeType: track.mimeType as string } : {}),
        ...(track.uri ? { uri: track.uri as string } : {}), ...(track.isDefault !== undefined ? { isDefault: track.isDefault as boolean } : {}),
        ...(track.forced !== undefined ? { forced: track.forced as boolean } : {}) });
    }
  }
  return { ok: true, media: {
    mediaId: value.mediaId, title: value.title, sources,
    ...(startPositionMs !== undefined ? { startPositionMs: startPositionMs as number } : {}),
    ...(isRecord(metadata) ? { metadata: metadata as MediaRecord["metadata"] } : {}),
    ...(tracks.length ? { tracks } : {})
  } };
}

export function createProtocolConnection(options: ProtocolConnectionOptions): ProtocolConnection {
  let outgoingSeq = 0;
  let lastIncomingSeq = 0;
  let handshaken = false;
  const seenRequestIds = new Set<string>();
  const connectionId = options.connectionId ?? randomUUID();
  const sessions = options.sessions ?? new SessionManager();
  const controlledSessions = new Set<string>();

  function makeEnvelope(type: UcpEnvelope["type"], action: string, payload: Record<string, unknown>, replyTo?: string, sessionId: string | null = null): UcpEnvelope {
    outgoingSeq += 1;
    return { protocol: "UCP", version: UCP_VERSION, type, id: randomUUID(), sessionId, seq: outgoingSeq,
      sentAt: new Date().toISOString(), action, payload, ...(replyTo ? { replyTo } : {}) };
  }

  function makeError(code: UcpErrorPayload["code"], message: string, replyTo?: string, details?: Record<string, unknown>): UcpEnvelope {
    const payload: UcpErrorPayload = { code, message, retryable: false, ...(details ? { details } : {}) };
    return makeEnvelope("error", "error", payload as unknown as Record<string, unknown>, replyTo);
  }

  function sessionError(reason: SessionFailureReason, replyTo: string): UcpEnvelope {
    if (reason === "SESSION_NOT_FOUND") return makeError("SESSION_NOT_FOUND", "The requested session does not exist.", replyTo);
    if (reason === "SESSION_IN_USE") return makeError("NOT_AUTHORIZED", "The session already has an active controller.", replyTo, { reason: "SESSION_IN_USE" });
    if (reason === "INVALID_STATE") return makeError("INVALID_MESSAGE", "The command is not valid in the current playback state.", replyTo, { reason: "INVALID_STATE" });
    if (reason === "INVALID_POSITION") return makeError("INVALID_MESSAGE", "The requested playback position is outside the valid range.", replyTo, { reason: "INVALID_POSITION" });
    return makeError("NOT_AUTHORIZED", "This connection is not the active controller for the session.", replyTo);
  }

  function stateResponse(action: string, requestId: string, sessionId: string, result: { ok: true; value: { snapshot: unknown }; changed?: boolean }): UcpEnvelope {
    return makeEnvelope("response", action, { status: "accepted", snapshot: result.value.snapshot, changed: result.changed ?? true }, requestId, sessionId);
  }

  return {
    handle(raw: string): UcpEnvelope[] {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch { return [makeError("INVALID_MESSAGE", "Message must contain valid JSON.")]; }

      if (!isEnvelopeShape(parsed)) {
        const possibleId = isRecord(parsed) && typeof parsed.id === "string" && parsed.id.length > 0 && parsed.id.length <= MAX_MESSAGE_ID_LENGTH ? parsed.id : undefined;
        return [makeError("INVALID_MESSAGE", "Invalid UCP request envelope.", possibleId, {
          expected: "UCP 1.0 request envelope with valid id, sessionId, positive seq, RFC 3339 sentAt, action and object payload"
        })];
      }

      const message = parsed;
      const requestId = message.id as string;
      const incomingSeq = message.seq as number;
      const version = message.version as string;
      const action = message.action as string;
      const payload = message.payload as Record<string, unknown>;

      if (version !== UCP_VERSION) return [makeError("UNSUPPORTED_VERSION", `Unsupported envelope version: ${version}.`, requestId, { supportedVersions: [UCP_VERSION] })];
      if (seenRequestIds.has(requestId)) return [makeError("INVALID_MESSAGE", "Duplicate request id on this connection.", requestId, { reason: "DUPLICATE_REQUEST_ID" })];
      if (incomingSeq <= lastIncomingSeq) return [makeError("INVALID_MESSAGE", "Request sequence must increase for each message on a connection.", requestId, {
        reason: "SEQUENCE_NOT_INCREASING", lastAcceptedSeq: lastIncomingSeq, receivedSeq: incomingSeq
      })];
      lastIncomingSeq = incomingSeq;
      seenRequestIds.add(requestId);
      if (seenRequestIds.size > MAX_TRACKED_REQUEST_IDS) {
        const oldest = seenRequestIds.values().next().value as string | undefined;
        if (oldest) seenRequestIds.delete(oldest);
      }

      if (!handshaken) {
        if (action !== "connection.hello") return [makeError("INVALID_MESSAGE", "connection.hello must be the first request on a connection.", requestId)];
        const supportedVersions = payload.supportedVersions;
        if (!Array.isArray(supportedVersions) || !supportedVersions.every(v => typeof v === "string")) return [makeError("INVALID_MESSAGE", "connection.hello payload must include a supportedVersions string array.", requestId)];
        if (!supportedVersions.includes(UCP_VERSION)) return [makeError("UNSUPPORTED_VERSION", "No mutually supported UCP version was found.", requestId, {
          receiverSupportedVersions: [UCP_VERSION], senderSupportedVersions: supportedVersions
        })];
        handshaken = true;
        return [makeEnvelope("response", "connection.welcome", {
          device: { name: options.deviceName, simulator: true }, protocolVersions: [UCP_VERSION], negotiatedVersion: UCP_VERSION,
          capabilities: { media: { formats: ["video/mp4", "video/webm", "application/vnd.apple.mpegurl"], hls: true, dash: false, progressiveHttp: true },
            playback: { seek: true, rate: false }, tracks: { audioSelect: false, subtitleExternal: false, subtitleSelect: false }, volume: { set: false, mute: false } },
          security: { mode: "development-simulator-only", authenticated: false }
        }, requestId)];
      }
      if (action === "connection.hello") return [makeError("INVALID_MESSAGE", "connection.hello may only be sent once per connection.", requestId)];

      const sessionId = typeof message.sessionId === "string" ? message.sessionId : null;
      if (action === "session.create") {
        if (sessionId !== null) return [makeError("INVALID_MESSAGE", "session.create must use sessionId: null.", requestId)];
        const session = sessions.create(connectionId);
        controlledSessions.add(session.sessionId);
        return [makeEnvelope("response", "session.created", { sessionId: session.sessionId, createdAt: session.createdAt, snapshot: session.snapshot }, requestId, session.sessionId)];
      }
      if (action === "session.join") {
        if (!sessionId) return [makeError("INVALID_MESSAGE", "session.join requires a sessionId.", requestId)];
        const result = sessions.join(sessionId, connectionId);
        if (!result.ok) return [sessionError(result.reason, requestId)];
        controlledSessions.add(sessionId);
        return [makeEnvelope("response", "session.joined", { sessionId, snapshot: result.value.snapshot }, requestId, sessionId)];
      }
      if (action === "session.snapshot") {
        if (!sessionId) return [makeError("INVALID_MESSAGE", "session.snapshot requires a sessionId.", requestId)];
        const result = sessions.snapshot(sessionId, connectionId);
        if (!result.ok) return [sessionError(result.reason, requestId)];
        return [makeEnvelope("response", "session.snapshot", { sessionId, snapshot: result.value.snapshot }, requestId, sessionId)];
      }
      if (action === "session.leave") {
        if (!sessionId) return [makeError("INVALID_MESSAGE", "session.leave requires a sessionId.", requestId)];
        const result = sessions.leave(sessionId, connectionId);
        if (!result.ok) return [sessionError(result.reason, requestId)];
        controlledSessions.delete(sessionId);
        return [makeEnvelope("response", "session.left", { sessionId, playbackPreserved: true }, requestId, sessionId)];
      }

      if (["media.load", "playback.play", "playback.pause", "playback.seek", "playback.stop"].includes(action)) {
        if (!sessionId) return [makeError("INVALID_MESSAGE", `${action} requires a sessionId.`, requestId)];
        if (action === "media.load") {
          const validated = validateMedia(payload.media);
          if (!validated.ok) return [makeError(validated.code, validated.message, requestId, validated.details)];
          const result = sessions.load(sessionId, connectionId, validated.media);
          if (!result.ok) return [sessionError(result.reason, requestId)];
          return [stateResponse("media.loaded", requestId, sessionId, result)];
        }
        const result = action === "playback.play" ? sessions.play(sessionId, connectionId)
          : action === "playback.pause" ? sessions.pause(sessionId, connectionId)
          : action === "playback.seek" ? sessions.seek(sessionId, connectionId, payload.positionMs as number)
          : sessions.stop(sessionId, connectionId);
        if (!result.ok) return [sessionError(result.reason, requestId)];
        const responseAction = action === "playback.play" ? "playback.playing"
          : action === "playback.pause" ? "playback.paused"
          : action === "playback.seek" ? "playback.seeked" : "playback.stopped";
        return [stateResponse(responseAction, requestId, sessionId, result)];
      }

      return [makeError("UNSUPPORTED_ACTION", `Action not implemented by simulator: ${action}`, requestId)];
    },
    eventForSession(sessionId: string, action: string, payload: Record<string, unknown>): UcpEnvelope | null {
      if (!controlledSessions.has(sessionId)) return null;
      return makeEnvelope("event", action, payload, undefined, sessionId);
    },
    disconnect(): void { controlledSessions.clear(); sessions.releaseConnection(connectionId); }
  };
}
