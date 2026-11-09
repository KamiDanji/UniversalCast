import { randomUUID } from "node:crypto";

export type PlaybackStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "buffering" | "ended" | "error";

export interface SessionSnapshot {
  revision: number;
  status: PlaybackStatus;
  mediaId: string | null;
  positionMs: number | null;
  durationMs: number | null;
  bufferedMs: number | null;
  playbackRate: number;
  updatedAt: string;
}

export interface MediaSourceRecord {
  uri: string;
  mimeType: string;
  protocol?: "hls" | "dash" | "progressive" | "unknown";
  priority?: number;
  delivery?: "remote" | "local";
  expiresAt?: string;
}

export interface MediaTrackRecord {
  id: string;
  kind: "audio" | "subtitle";
  language?: string;
  label?: string;
  mimeType?: string;
  uri?: string;
  isDefault?: boolean;
  forced?: boolean;
}

export interface MediaRecord {
  mediaId: string;
  title: string;
  sources: MediaSourceRecord[];
  startPositionMs?: number;
  metadata?: Record<string, string | number | boolean>;
  tracks?: MediaTrackRecord[];
}

export interface SessionRecord {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  snapshot: SessionSnapshot;
  controllerConnectionId: string | null;
  media: MediaRecord | null;
}

export type SessionFailureReason = "SESSION_NOT_FOUND" | "NOT_AUTHORIZED" | "SESSION_IN_USE" | "INVALID_STATE" | "INVALID_POSITION";
export type SessionResult<T> = { ok: true; value: T; changed?: boolean } | { ok: false; reason: SessionFailureReason };
export interface SessionStateChange { sessionId: string; snapshot: SessionSnapshot; }

/** In-memory development session registry. Production receivers must persist state and enforce paired-device authorization. */
export class SessionManager {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly listeners = new Set<(change: SessionStateChange) => void>();

  subscribe(listener: (change: SessionStateChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(connectionId: string): SessionRecord {
    const now = new Date().toISOString();
    const session: SessionRecord = {
      sessionId: randomUUID(),
      createdAt: now,
      updatedAt: now,
      controllerConnectionId: connectionId,
      media: null,
      snapshot: {
        revision: 0,
        status: "idle",
        mediaId: null,
        positionMs: null,
        durationMs: null,
        bufferedMs: null,
        playbackRate: 1,
        updatedAt: now
      }
    };
    this.sessions.set(session.sessionId, session);
    return this.clone(session);
  }

  join(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };
    if (session.controllerConnectionId && session.controllerConnectionId !== connectionId) return { ok: false, reason: "SESSION_IN_USE" };
    session.controllerConnectionId = connectionId;
    return { ok: true, value: this.clone(session) };
  }

  snapshot(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };
    if (session.controllerConnectionId !== connectionId) return { ok: false, reason: "NOT_AUTHORIZED" };
    return { ok: true, value: this.clone(session) };
  }

  leave(sessionId: string, connectionId: string): SessionResult<{ sessionId: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };
    if (session.controllerConnectionId !== connectionId) return { ok: false, reason: "NOT_AUTHORIZED" };
    session.controllerConnectionId = null;
    session.updatedAt = new Date().toISOString();
    return { ok: true, value: { sessionId } };
  }

  load(sessionId: string, connectionId: string, media: MediaRecord): SessionResult<SessionRecord> {
    const session = this.getControlledSession(sessionId, connectionId);
    if (!session.ok) return session;
    const now = new Date().toISOString();
    const durationMs = typeof media.metadata?.durationMs === "number" ? media.metadata.durationMs : null;
    const requestedStart = media.startPositionMs ?? 0;
    if (!Number.isSafeInteger(requestedStart) || requestedStart < 0 || (durationMs !== null && requestedStart > durationMs)) {
      return { ok: false, reason: "INVALID_POSITION" };
    }
    session.value.media = structuredClone(media);
    this.updateSnapshot(session.value, {
      status: "ready", mediaId: media.mediaId, positionMs: requestedStart,
      durationMs, bufferedMs: null, playbackRate: 1
    }, now);
    return { ok: true, value: this.clone(session.value), changed: true };
  }

  play(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.getControlledSession(sessionId, connectionId);
    if (!session.ok) return session;
    if (session.value.snapshot.status === "playing") return { ok: true, value: this.clone(session.value), changed: false };
    if (!["ready", "paused", "buffering"].includes(session.value.snapshot.status)) return { ok: false, reason: "INVALID_STATE" };
    this.updateSnapshot(session.value, { status: "playing" });
    return { ok: true, value: this.clone(session.value), changed: true };
  }

  pause(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.getControlledSession(sessionId, connectionId);
    if (!session.ok) return session;
    if (session.value.snapshot.status === "paused") return { ok: true, value: this.clone(session.value), changed: false };
    if (!["ready", "playing", "buffering"].includes(session.value.snapshot.status)) return { ok: false, reason: "INVALID_STATE" };
    this.updateSnapshot(session.value, { status: "paused" });
    return { ok: true, value: this.clone(session.value), changed: true };
  }

  seek(sessionId: string, connectionId: string, positionMs: number): SessionResult<SessionRecord> {
    const session = this.getControlledSession(sessionId, connectionId);
    if (!session.ok) return session;
    const snapshot = session.value.snapshot;
    if (!["ready", "playing", "paused", "buffering"].includes(snapshot.status)) return { ok: false, reason: "INVALID_STATE" };
    if (!Number.isSafeInteger(positionMs) || positionMs < 0 || (snapshot.durationMs !== null && positionMs > snapshot.durationMs)) {
      return { ok: false, reason: "INVALID_POSITION" };
    }
    this.updateSnapshot(session.value, { positionMs });
    return { ok: true, value: this.clone(session.value), changed: true };
  }

  stop(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.getControlledSession(sessionId, connectionId);
    if (!session.ok) return session;
    if (session.value.snapshot.status === "idle") return { ok: true, value: this.clone(session.value), changed: false };
    session.value.media = null;
    this.updateSnapshot(session.value, {
      status: "idle", mediaId: null, positionMs: null, durationMs: null,
      bufferedMs: null, playbackRate: 1
    });
    return { ok: true, value: this.clone(session.value), changed: true };
  }

  releaseConnection(connectionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.controllerConnectionId === connectionId) {
        session.controllerConnectionId = null;
        session.updatedAt = new Date().toISOString();
      }
    }
  }

  get size(): number { return this.sessions.size; }

  private getControlledSession(sessionId: string, connectionId: string): SessionResult<SessionRecord> {
    const session = this.sessions.get(sessionId);
    if (!session) return { ok: false, reason: "SESSION_NOT_FOUND" };
    if (session.controllerConnectionId !== connectionId) return { ok: false, reason: "NOT_AUTHORIZED" };
    return { ok: true, value: session };
  }

  private updateSnapshot(session: SessionRecord, patch: Partial<SessionSnapshot>, timestamp = new Date().toISOString()): void {
    session.updatedAt = timestamp;
    session.snapshot = { ...session.snapshot, ...patch, revision: session.snapshot.revision + 1, updatedAt: timestamp };
    const change = { sessionId: session.sessionId, snapshot: { ...session.snapshot } };
    for (const listener of this.listeners) listener(change);
  }

  private clone(session: SessionRecord): SessionRecord {
    return { ...session, media: session.media ? structuredClone(session.media) : null, snapshot: { ...session.snapshot } };
  }
}
