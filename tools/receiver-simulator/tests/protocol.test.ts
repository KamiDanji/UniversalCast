import test from "node:test";
import assert from "node:assert/strict";
import { createProtocolConnection } from "../src/protocol.js";
import { SessionManager as SessionManagerForTests } from "../src/sessions.js";

function request(overrides: Record<string, unknown> = {}) {
  return {
    protocol: "UCP",
    version: "1.0",
    type: "request",
    id: "request-1",
    sessionId: null,
    seq: 1,
    sentAt: "2026-11-08T20:00:00.000Z",
    action: "connection.hello",
    payload: { supportedVersions: ["1.0"] },
    ...overrides
  };
}

test("valid hello returns a correlated welcome and starts outgoing sequence at 1", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle(JSON.stringify(request()));
  assert.equal(response?.type, "response");
  assert.equal(response?.action, "connection.welcome");
  assert.equal(response?.replyTo, "request-1");
  assert.equal(response?.seq, 1);
  assert.equal((response?.payload as any).negotiatedVersion, "1.0");
});

test("malformed JSON returns INVALID_MESSAGE", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle("{not-json");
  assert.equal(response?.type, "error");
  assert.equal((response?.payload as any).code, "INVALID_MESSAGE");
});

test("invalid envelope returns INVALID_MESSAGE", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle(JSON.stringify({ protocol: "UCP", type: "request" }));
  assert.equal((response?.payload as any).code, "INVALID_MESSAGE");
});

test("unsupported envelope version returns supported versions", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle(JSON.stringify(request({ version: "9.0" })));
  assert.equal((response?.payload as any).code, "UNSUPPORTED_VERSION");
  assert.deepEqual((response?.payload as any).details.supportedVersions, ["1.0"]);
});

test("no common version in hello is rejected", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle(JSON.stringify(request({ payload: { supportedVersions: ["2.0"] } })));
  assert.equal((response?.payload as any).code, "UNSUPPORTED_VERSION");
  assert.deepEqual((response?.payload as any).details.receiverSupportedVersions, ["1.0"]);
});

test("non-hello request before handshake is rejected", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const [response] = connection.handle(JSON.stringify(request({ action: "session.create" })));
  assert.equal((response?.payload as any).code, "INVALID_MESSAGE");
});

test("unsupported action after handshake returns a correlated error", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [response] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "made.up" })));
  assert.equal(response?.type, "error");
  assert.equal(response?.replyTo, "request-2");
  assert.equal((response?.payload as any).code, "UNSUPPORTED_ACTION");
});

test("duplicate request IDs are rejected", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [response] = connection.handle(JSON.stringify(request({ seq: 2 })));
  assert.equal((response?.payload as any).code, "INVALID_MESSAGE");
  assert.equal((response?.payload as any).details.reason, "DUPLICATE_REQUEST_ID");
});

test("non-increasing incoming sequence numbers are rejected", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [response] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 1 })));
  assert.equal((response?.payload as any).code, "INVALID_MESSAGE");
  assert.equal((response?.payload as any).details.reason, "SEQUENCE_NOT_INCREASING");
});

test("outgoing sequence numbers increase for every response", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  const first = connection.handle(JSON.stringify(request()))[0];
  const second = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "not.implemented" })))[0];
  assert.equal(first?.seq, 1);
  assert.equal(second?.seq, 2);
});


test("session.create returns a receiver-generated session and idle snapshot", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [response] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "session.create", payload: {} })));
  assert.equal(response?.action, "session.created");
  assert.equal(response?.type, "response");
  assert.equal(typeof (response?.payload as any).sessionId, "string");
  assert.equal(response?.sessionId, (response?.payload as any).sessionId);
  assert.equal((response?.payload as any).snapshot.status, "idle");
  assert.equal((response?.payload as any).snapshot.revision, 0);
});

test("session.snapshot returns the authoritative snapshot to its controller", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [created] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "session.create", payload: {} })));
  const sessionId = (created?.payload as any).sessionId;
  const [snapshot] = connection.handle(JSON.stringify(request({ id: "request-3", seq: 3, action: "session.snapshot", sessionId, payload: {} })));
  assert.equal(snapshot?.action, "session.snapshot");
  assert.equal((snapshot?.payload as any).snapshot.revision, 0);
});

test("session.leave releases control but preserves the session for a later join", () => {
  const sessions = new SessionManagerForTests();
  const connection = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "sender-a", sessions });
  connection.handle(JSON.stringify(request()));
  const [created] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "session.create", payload: {} })));
  const sessionId = (created?.payload as any).sessionId;
  const [left] = connection.handle(JSON.stringify(request({ id: "request-3", seq: 3, action: "session.leave", sessionId, payload: {} })));
  assert.equal(left?.action, "session.left");
  assert.equal((left?.payload as any).playbackPreserved, true);
  const rejoiner = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "sender-b", sessions });
  rejoiner.handle(JSON.stringify(request({ id: "hello-b", seq: 1 })));
  const [joined] = rejoiner.handle(JSON.stringify(request({ id: "join-b", seq: 2, action: "session.join", sessionId, payload: {} })));
  assert.equal(joined?.action, "session.joined");
});

test("unknown session returns SESSION_NOT_FOUND", () => {
  const connection = createProtocolConnection({ deviceName: "Test Receiver" });
  connection.handle(JSON.stringify(request()));
  const [response] = connection.handle(JSON.stringify(request({ id: "request-2", seq: 2, action: "session.snapshot", sessionId: "missing-session", payload: {} })));
  assert.equal((response?.payload as any).code, "SESSION_NOT_FOUND");
});

test("a different connection cannot control a session while its controller is attached", () => {
  const sessions = new SessionManagerForTests();
  const owner = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "owner", sessions });
  owner.handle(JSON.stringify(request()));
  const [created] = owner.handle(JSON.stringify(request({ id: "create", seq: 2, action: "session.create", payload: {} })));
  const sessionId = (created?.payload as any).sessionId;
  const other = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "other", sessions });
  other.handle(JSON.stringify(request({ id: "hello-other", seq: 1 })));
  const [response] = other.handle(JSON.stringify(request({ id: "join-other", seq: 2, action: "session.join", sessionId, payload: {} })));
  assert.equal((response?.payload as any).code, "NOT_AUTHORIZED");
  assert.equal((response?.payload as any).details.reason, "SESSION_IN_USE");
});



test("disconnect releases the controller lease without deleting the session", () => {
  const sessions = new SessionManagerForTests();
  const owner = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "disconnect-owner", sessions });
  owner.handle(JSON.stringify(request()));
  const [created] = owner.handle(JSON.stringify(request({ id: "create-session", seq: 2, action: "session.create", payload: {} })));
  const sessionId = (created?.payload as any).sessionId;
  owner.disconnect();
  const next = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "next-controller", sessions });
  next.handle(JSON.stringify(request({ id: "next-hello", seq: 1 })));
  const [joined] = next.handle(JSON.stringify(request({ id: "next-join", seq: 2, action: "session.join", sessionId, payload: {} })));
  assert.equal(joined?.action, "session.joined");
  assert.equal((joined?.payload as any).snapshot.status, "idle");
});

function command(connection: ReturnType<typeof createProtocolConnection>, id: string, seq: number, action: string, sessionId: string | null, payload: Record<string, unknown> = {}) {
  return connection.handle(JSON.stringify(request({ id, seq, action, sessionId, payload })))[0];
}

function makeOwnedSession(sessions = new SessionManagerForTests()) {
  const owner = createProtocolConnection({ deviceName: "Test Receiver", connectionId: `owner-${Math.random()}`, sessions });
  owner.handle(JSON.stringify(request()));
  const created = command(owner, "create-session", 2, "session.create", null, {});
  return { owner, sessions, sessionId: (created?.payload as any).sessionId as string };
}

const sampleMedia = {
  mediaId: "episode-001",
  title: "Test Episode",
  sources: [{ uri: "http://127.0.0.1:9000/episode.mp4", mimeType: "video/mp4", protocol: "progressive" }],
  metadata: { durationMs: 120_000 }
};

test("media.load establishes a ready snapshot and increments its revision", () => {
  const { owner, sessionId } = makeOwnedSession();
  const response = command(owner, "load", 3, "media.load", sessionId, { media: sampleMedia });
  assert.equal(response?.action, "media.loaded");
  assert.equal((response?.payload as any).snapshot.status, "ready");
  assert.equal((response?.payload as any).snapshot.mediaId, "episode-001");
  assert.equal((response?.payload as any).snapshot.durationMs, 120_000);
  assert.equal((response?.payload as any).snapshot.revision, 1);
});

test("play, pause, seek and stop update authoritative state revisions", () => {
  const { owner, sessionId } = makeOwnedSession();
  command(owner, "load", 3, "media.load", sessionId, { media: sampleMedia });
  const play = command(owner, "play", 4, "playback.play", sessionId);
  assert.equal(play?.action, "playback.playing");
  assert.equal((play?.payload as any).snapshot.status, "playing");
  assert.equal((play?.payload as any).snapshot.revision, 2);

  const pause = command(owner, "pause", 5, "playback.pause", sessionId);
  assert.equal((pause?.payload as any).snapshot.status, "paused");
  assert.equal((pause?.payload as any).snapshot.revision, 3);

  const seek = command(owner, "seek", 6, "playback.seek", sessionId, { positionMs: 45_000 });
  assert.equal((seek?.payload as any).snapshot.positionMs, 45_000);
  assert.equal((seek?.payload as any).snapshot.revision, 4);

  const stop = command(owner, "stop", 7, "playback.stop", sessionId);
  assert.equal(stop?.action, "playback.stopped");
  assert.equal((stop?.payload as any).snapshot.status, "idle");
  assert.equal((stop?.payload as any).snapshot.mediaId, null);
  assert.equal((stop?.payload as any).snapshot.revision, 5);
});

test("invalid playback transitions and out-of-range seeks are rejected", () => {
  const { owner, sessionId } = makeOwnedSession();
  const playBeforeLoad = command(owner, "play-before-load", 3, "playback.play", sessionId);
  assert.equal(playBeforeLoad?.type, "error");
  assert.equal((playBeforeLoad?.payload as any).details.reason, "INVALID_STATE");

  command(owner, "load", 4, "media.load", sessionId, { media: sampleMedia });
  const seekTooFar = command(owner, "seek-too-far", 5, "playback.seek", sessionId, { positionMs: 120_001 });
  assert.equal(seekTooFar?.type, "error");
  assert.equal((seekTooFar?.payload as any).details.reason, "INVALID_POSITION");
});

test("media.load rejects non-HTTP media URIs", () => {
  const { owner, sessionId } = makeOwnedSession();
  const response = command(owner, "bad-uri", 3, "media.load", sessionId, {
    media: { ...sampleMedia, sources: [{ uri: "file:///etc/passwd", mimeType: "video/mp4" }] }
  });
  assert.equal(response?.type, "error");
  assert.equal((response?.payload as any).code, "INVALID_MEDIA_URI");
});

test("state changes emit events to session controllers with increasing outgoing sequence", () => {
  const { owner, sessionId, sessions } = makeOwnedSession();
  const outsider = createProtocolConnection({ deviceName: "Test Receiver", connectionId: "outsider", sessions });
  outsider.handle(JSON.stringify(request()));

  command(owner, "load", 3, "media.load", sessionId, { media: sampleMedia });
  const event = owner.eventForSession(sessionId, "state.changed", { snapshot: { revision: 1 } });
  assert.equal(event?.type, "event");
  assert.equal(event?.action, "state.changed");
  assert.equal(event?.sessionId, sessionId);
  assert.equal(event?.seq, 4);
  assert.equal(outsider.eventForSession(sessionId, "state.changed", {}), null);
});

test("a former controller cannot mutate playback after leaving", () => {
  const sessions = new SessionManagerForTests();
  const { owner, sessionId } = makeOwnedSession(sessions);
  command(owner, "leave", 3, "session.leave", sessionId);
  const response = command(owner, "load-after-leave", 4, "media.load", sessionId, { media: sampleMedia });
  assert.equal(response?.type, "error");
  assert.equal((response?.payload as any).code, "NOT_AUTHORIZED");
});

test("media.load preserves local delivery expiry and HLS/audio/subtitle descriptors", () => {
  const { owner, sessionId } = makeOwnedSession();
  const media = {
    ...sampleMedia,
    sources: [{ uri: "http://192.168.2.15:8766/media/token/file", mimeType: "application/vnd.apple.mpegurl", protocol: "hls", delivery: "local", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }],
    metadata: { durationMs: 120_000, width: 1920, height: 1080, bitrate: 4_000_000 },
    tracks: [
      { id: "audio-en", kind: "audio", language: "en", label: "English", isDefault: true },
      { id: "sub-en", kind: "subtitle", language: "en", label: "English subtitles", mimeType: "text/vtt", uri: "http://192.168.2.15:8766/media/token/subtitle", isDefault: false }
    ]
  };
  const response = command(owner, "load-descriptors", 3, "media.load", sessionId, { media });
  assert.equal(response?.action, "media.loaded");
  assert.equal((response?.payload as any).snapshot.status, "ready");
});

test("media.load rejects local sources without an expiry and duplicate track ids", () => {
  const { owner, sessionId } = makeOwnedSession();
  const noExpiry = command(owner, "local-no-expiry", 3, "media.load", sessionId, {
    media: { ...sampleMedia, sources: [{ uri: "http://192.168.2.15:8766/media/token/file", mimeType: "video/mp4", delivery: "local" }] }
  });
  assert.equal(noExpiry?.type, "error");
  assert.equal((noExpiry?.payload as any).code, "INVALID_MESSAGE");

  const duplicateTracks = command(owner, "duplicate-tracks", 4, "media.load", sessionId, {
    media: { ...sampleMedia, tracks: [{ id: "track", kind: "audio" }, { id: "track", kind: "subtitle" }] }
  });
  assert.equal(duplicateTracks?.type, "error");
  assert.equal((duplicateTracks?.payload as any).code, "INVALID_MESSAGE");
});
