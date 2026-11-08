/** UCP 1.0 draft shared TypeScript contracts. Runtime validation belongs in protocol-validation. */

export type UcpVersion = "1.0";
export type MessageType = "request" | "response" | "event" | "error";

export interface UcpEnvelope<TPayload = Record<string, unknown>> {
  protocol: "UCP";
  version: UcpVersion;
  type: MessageType;
  id: string;
  sessionId: string | null;
  seq: number;
  sentAt: string;
  action: string;
  payload: TPayload;
  replyTo?: string;
}

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "error";

export interface MediaSource {
  uri: string;
  mimeType: string;
  protocol?: "hls" | "dash" | "progressive" | "unknown";
  priority?: number;
}

export interface SubtitleTrackDescriptor {
  id: string;
  uri: string;
  mimeType: "text/vtt" | "application/x-subrip" | string;
  language?: string;
  label?: string;
  isDefault?: boolean;
}

export interface MediaDescriptor {
  mediaId: string;
  title: string;
  sources: MediaSource[];
  subtitleTracks?: SubtitleTrackDescriptor[];
  startPositionMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ReceiverCapabilities {
  protocolVersions: UcpVersion[];
  media: {
    formats: string[];
    hls: boolean;
    dash: boolean;
    progressiveHttp: boolean;
  };
  playback: {
    seek: boolean;
    rate: boolean;
    rates?: number[];
  };
  tracks: {
    audioSelect: boolean;
    subtitleExternal: boolean;
    subtitleSelect: boolean;
  };
  volume: {
    set: boolean;
    mute: boolean;
  };
}

export interface PlaybackSnapshot {
  revision: number;
  status: PlaybackStatus;
  mediaId: string | null;
  positionMs: number | null;
  durationMs: number | null;
  bufferedMs: number | null;
  playbackRate: number;
  updatedAt: string;
}

export interface UcpErrorPayload {
  code:
    | "UNSUPPORTED_VERSION"
    | "UNSUPPORTED_ACTION"
    | "INVALID_MESSAGE"
    | "NOT_PAIRED"
    | "NOT_AUTHORIZED"
    | "SESSION_NOT_FOUND"
    | "MEDIA_UNAVAILABLE"
    | "UNSUPPORTED_MEDIA"
    | "INVALID_MEDIA_URI"
    | "COMMAND_EXPIRED"
    | "INTERNAL_ERROR";
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface CommandResultPayload {
  status: "accepted" | "rejected";
  reason?: string;
}

export interface SeekPayload {
  positionMs: number;
}

export interface LoadMediaPayload {
  media: MediaDescriptor;
}

export interface StateChangedPayload {
  snapshot: PlaybackSnapshot;
}
