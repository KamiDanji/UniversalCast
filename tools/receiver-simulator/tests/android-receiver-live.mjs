import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  if (process.argv[i].startsWith("--")) args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const url = args.get("url") ?? "ws://127.0.0.1:8765/ucp";
const mediaUrl = args.get("media-url");
if (!mediaUrl) {
  console.error("Usage: node tools/receiver-simulator/tests/android-receiver-live.mjs --media-url <temporary-media-url> [--url ws://127.0.0.1:8765/ucp]");
  process.exit(2);
}

const socket = new WebSocket(url);
let seq = 0;
const pending = new Map();
const events = [];

function envelope(action, payload = {}, sessionId = null) {
  return {
    protocol: "UCP", version: "1.0", type: "request", id: randomUUID(),
    sessionId, seq: ++seq, sentAt: new Date().toISOString(), action, payload
  };
}

function request(action, payload = {}, sessionId = null, timeoutMs = 10_000) {
  const message = envelope(action, payload, sessionId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(message.id);
      reject(new Error(`Timed out waiting for ${action}`));
    }, timeoutMs);
    pending.set(message.id, { resolve, reject, timer });
    socket.send(JSON.stringify(message));
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS  ${message}`);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForStatus(sessionId, status, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await request("session.snapshot", {}, sessionId);
    const actual = response.payload?.snapshot?.status;
    if (actual === status) return response.payload.snapshot;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for playback status '${status}'`);
}

socket.on("message", raw => {
  let message;
  try { message = JSON.parse(raw.toString()); } catch { return; }
  if (message.type === "event") {
    events.push(message);
    if (message.action === "state.changed") {
      console.log(`EVENT state.changed: ${message.payload?.snapshot?.status} (revision ${message.payload?.snapshot?.revision})`);
    }
  }
  if (message.replyTo && pending.has(message.replyTo)) {
    const item = pending.get(message.replyTo);
    pending.delete(message.replyTo);
    clearTimeout(item.timer);
    if (message.type === "error") item.reject(new Error(`${message.payload?.code}: ${message.payload?.message}`));
    else item.resolve(message);
  }
});

try {
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  console.log(`Connected to ${url}`);

  const hello = await request("connection.hello", { supportedVersions: ["1.0"] });
  assert(hello.action === "connection.welcome" && hello.payload?.negotiatedVersion === "1.0", "UCP 1.0 handshake and capability negotiation");
  assert(hello.payload?.security?.authenticated === false, "Receiver explicitly reports development unauthenticated mode");

  const created = await request("session.create");
  assert(created.action === "session.created", "Session creation");
  const sessionId = created.payload.sessionId;
  assert(typeof sessionId === "string" && created.sessionId === sessionId, "Session ID returned in envelope and payload");

  const loaded = await request("media.load", {
    media: {
      mediaId: "android-live-test",
      title: "UniversalCast Android receiver live test",
      sources: [{ uri: mediaUrl, mimeType: "video/mp4", protocol: "progressive" }]
    }
  }, sessionId);
  assert(loaded.action === "media.loaded" && loaded.payload?.status === "accepted", "media.load accepted by Android receiver");

  await request("playback.play", {}, sessionId);
  await waitForStatus(sessionId, "playing");
  assert(true, "Media3 enters playing state and receiver reports it");

  await request("playback.pause", {}, sessionId);
  await waitForStatus(sessionId, "paused");
  assert(true, "Remote pause command reaches Media3");

  await request("playback.play", {}, sessionId);
  await waitForStatus(sessionId, "playing");
  assert(true, "Remote resume command reaches Media3");

  await request("playback.seek", { positionMs: 1_000 }, sessionId);
  const afterSeek = await request("session.snapshot", {}, sessionId);
  assert((afterSeek.payload?.snapshot?.positionMs ?? 0) >= 900, "Remote seek updates receiver playback position");

  await request("playback.stop", {}, sessionId);
  await waitForStatus(sessionId, "idle");
  assert(true, "Remote stop command clears Media3 playback");

  assert(events.some(event => event.action === "state.changed"), "Receiver emits state.changed events");
  console.log("\nAndroid receiver live UCP test: all checks passed.");
} catch (error) {
  console.error("\nAndroid receiver live UCP test failed:", error.message);
  process.exitCode = 1;
} finally {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(new Error("Test client closing"));
  }
  pending.clear();
  socket.close();
}
