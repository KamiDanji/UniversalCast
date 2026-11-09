import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const URL = "ws://127.0.0.1:8765/ucp";

function createSender(name) {
  const ws = new WebSocket(URL);
  let seq = 0;
  const pending = new Map();
  const events = [];

  ws.on("message", raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === "event") {
      events.push(message);
      return;
    }
    if (message.replyTo && pending.has(message.replyTo)) {
      const resolve = pending.get(message.replyTo);
      pending.delete(message.replyTo);
      resolve(message);
    }
  });

  async function connect() {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const welcome = await request("connection.hello", null, { supportedVersions: ["1.0"] });
    assert.equal(welcome.action, "connection.welcome");
    console.log(`[${name}] Connected using UCP ${welcome.payload.negotiatedVersion}`);
  }

  function request(action, sessionId = null, payload = {}) {
    const id = randomUUID();
    const message = {
      protocol: "UCP", version: "1.0", type: "request", id, sessionId,
      seq: ++seq, sentAt: new Date().toISOString(), action, payload
    };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`[${name}] Timeout waiting for ${action}`));
      }, 5000);
      pending.set(id, response => {
        clearTimeout(timeout);
        resolve(response);
      });
      ws.send(JSON.stringify(message));
    });
  }

  async function waitForStateEvent(revision) {
    const existing = events.find(event => event.action === "state.changed" && event.payload.snapshot.revision === revision);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`[${name}] Missing state.changed event for revision ${revision}`)), 3000);
      const poll = setInterval(() => {
        const found = events.find(event => event.action === "state.changed" && event.payload.snapshot.revision === revision);
        if (found) {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve(found);
        }
      }, 10);
    });
  }

  function close() {
    return new Promise(resolve => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once("close", resolve);
      ws.close();
    });
  }

  return { connect, request, waitForStateEvent, close };
}

async function run() {
  let a, b;
  try {
    console.log("\n=== UniversalCast M1.4 Live Playback Test ===\n");
    a = createSender("Sender A");
    b = createSender("Sender B");
    await Promise.all([a.connect(), b.connect()]);

    const created = await a.request("session.create");
    assert.equal(created.action, "session.created");
    const sessionId = created.payload.sessionId;
    console.log("[PASS] Receiver created session", sessionId);

    const denied = await b.request("session.join", sessionId);
    assert.equal(denied.type, "error");
    assert.equal(denied.payload.details.reason, "SESSION_IN_USE");
    console.log("[PASS] Second sender cannot control an occupied session");

    const media = {
      mediaId: "ucp-test-episode-001",
      title: "UniversalCast Test Episode",
      sources: [{ uri: "https://example.com/video.mp4", mimeType: "video/mp4", protocol: "progressive" }],
      metadata: { durationMs: 180000 }
    };

    const loaded = await a.request("media.load", sessionId, { media });
    assert.equal(loaded.action, "media.loaded");
    assert.equal(loaded.payload.snapshot.status, "ready");
    assert.equal(loaded.payload.snapshot.revision, 1);
    await a.waitForStateEvent(1);
    console.log("[PASS] media.load accepted; ready snapshot and state.changed event received");

    const played = await a.request("playback.play", sessionId);
    assert.equal(played.payload.snapshot.status, "playing");
    assert.equal(played.payload.snapshot.revision, 2);
    await a.waitForStateEvent(2);
    console.log("[PASS] playback.play transitioned to playing");

    const paused = await a.request("playback.pause", sessionId);
    assert.equal(paused.payload.snapshot.status, "paused");
    assert.equal(paused.payload.snapshot.revision, 3);
    await a.waitForStateEvent(3);
    console.log("[PASS] playback.pause transitioned to paused");

    const seeked = await a.request("playback.seek", sessionId, { positionMs: 72500 });
    assert.equal(seeked.payload.snapshot.positionMs, 72500);
    assert.equal(seeked.payload.snapshot.revision, 4);
    await a.waitForStateEvent(4);
    console.log("[PASS] playback.seek updated position and emitted state event");

    const invalidSeek = await a.request("playback.seek", sessionId, { positionMs: 180001 });
    assert.equal(invalidSeek.type, "error");
    assert.equal(invalidSeek.payload.details.reason, "INVALID_POSITION");
    console.log("[PASS] Out-of-range seek rejected");

    const stopped = await a.request("playback.stop", sessionId);
    assert.equal(stopped.payload.snapshot.status, "idle");
    assert.equal(stopped.payload.snapshot.mediaId, null);
    assert.equal(stopped.payload.snapshot.revision, 5);
    await a.waitForStateEvent(5);
    console.log("[PASS] playback.stop reset media state");

    const snapshot = await a.request("session.snapshot", sessionId);
    assert.equal(snapshot.payload.snapshot.revision, 5);
    assert.equal(snapshot.payload.snapshot.status, "idle");
    console.log("[PASS] session.snapshot returned authoritative final state");

    const left = await a.request("session.leave", sessionId);
    assert.equal(left.action, "session.left");
    const joined = await b.request("session.join", sessionId);
    assert.equal(joined.action, "session.joined");
    assert.equal(joined.payload.snapshot.status, "idle");
    console.log("[PASS] Session remains joinable after controller handover");

    console.log("\n==========================================");
    console.log("ALL 10 LIVE PLAYBACK CHECKS PASSED");
    console.log("M1.4 live WebSocket playback: VERIFIED");
    console.log("==========================================\n");
  } catch (error) {
    console.error("\n[FAIL] Playback integration test failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (a) await a.close();
    if (b) await b.close();
  }
}

run();
