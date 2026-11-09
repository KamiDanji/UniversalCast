import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const URL = "ws://127.0.0.1:8765/ucp";

function createSender(name) {
  const ws = new WebSocket(URL);
  let seq = 0;

  async function connect() {
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });

    const welcome = await request("connection.hello", null, {
      supportedVersions: ["1.0"]
    });

    assert.equal(welcome.type, "response");
    assert.equal(welcome.action, "connection.welcome");
    console.log(`[${name}] Connected and negotiated UCP ${welcome.payload.negotiatedVersion}`);
  }

  function request(action, sessionId = null, payload = {}) {
    const id = randomUUID();

    const message = {
      protocol: "UCP",
      version: "1.0",
      type: "request",
      id,
      sessionId,
      seq: ++seq,
      sentAt: new Date().toISOString(),
      action,
      payload
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.off("message", onMessage);
        reject(new Error(`[${name}] Timeout waiting for ${action}`));
      }, 5000);

      function onMessage(raw) {
        let response;

        try {
          response = JSON.parse(raw.toString());
        } catch {
          clearTimeout(timeout);
          ws.off("message", onMessage);
          reject(new Error("Receiver returned invalid JSON"));
          return;
        }

        if (response.replyTo !== id) return;

        clearTimeout(timeout);
        ws.off("message", onMessage);
        resolve(response);
      }

      ws.on("message", onMessage);
      ws.send(JSON.stringify(message));
    });
  }

  function close() {
    return new Promise(resolve => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once("close", resolve);
      ws.close();
    });
  }

  return { name, ws, connect, request, close };
}

async function run() {
  let a, b, c;

  try {
    console.log("\n=== UniversalCast M1.3 Live Session Test ===\n");

    // 1. Sender A connects and creates a session.
    a = createSender("Sender A");
    await a.connect();

    const created = await a.request("session.create");
    assert.equal(created.type, "response");
    assert.equal(created.action, "session.created");

    const sessionId = created.payload.sessionId;
    const originalSnapshot = created.payload.snapshot;

    assert.ok(sessionId);
    assert.equal(created.sessionId, sessionId);
    assert.equal(originalSnapshot.status, "idle");

    console.log("[PASS] Sender A created session:", sessionId);

    // 2. Sender A retrieves its authoritative snapshot.
    const snapshotA = await a.request("session.snapshot", sessionId);
    assert.equal(snapshotA.type, "response");
    assert.deepEqual(snapshotA.payload.snapshot, originalSnapshot);

    console.log("[PASS] Sender A retrieved the authoritative snapshot");

    // 3. Sender B connects and tries to join while A controls the session.
    b = createSender("Sender B");
    await b.connect();

    const blockedJoin = await b.request("session.join", sessionId);
    assert.equal(blockedJoin.type, "error");
    assert.equal(blockedJoin.payload.code, "NOT_AUTHORIZED");
    assert.equal(blockedJoin.payload.details.reason, "SESSION_IN_USE");

    console.log("[PASS] Sender B was correctly rejected while A held control");

    // 4. Sender A leaves, releasing control.
    const left = await a.request("session.leave", sessionId);
    assert.equal(left.type, "response");
    assert.equal(left.action, "session.left");
    assert.equal(left.payload.playbackPreserved, true);

    console.log("[PASS] Sender A released control without destroying the session");

    // 5. Sender B joins successfully.
    const joinedB = await b.request("session.join", sessionId);
    assert.equal(joinedB.type, "response");
    assert.equal(joinedB.action, "session.joined");
    assert.equal(joinedB.payload.sessionId, sessionId);

    console.log("[PASS] Sender B successfully took control");

    // 6. Sender B retrieves the same session snapshot.
    const snapshotB = await b.request("session.snapshot", sessionId);
    assert.deepEqual(snapshotB.payload.snapshot, originalSnapshot);

    console.log("[PASS] Session ID and playback snapshot survived handover");

    // 7. Sender B disconnects unexpectedly.
    await b.close();
    b = null;

    console.log("[INFO] Sender B disconnected unexpectedly");

    // 8. Sender C should be able to join after B disconnects.
    c = createSender("Sender C");
    await c.connect();

    const joinedC = await c.request("session.join", sessionId);
    assert.equal(joinedC.type, "response");
    assert.equal(joinedC.action, "session.joined");

    const snapshotC = await c.request("session.snapshot", sessionId);
    assert.deepEqual(snapshotC.payload.snapshot, originalSnapshot);

    console.log("[PASS] Sender C acquired control after B disconnected");
    console.log("[PASS] Session and snapshot survived unexpected disconnect");

    console.log("\n==========================================");
    console.log("ALL 8 LIVE SESSION CHECKS PASSED");
    console.log("M1.3 live WebSocket lifecycle: VERIFIED");
    console.log("==========================================\n");

  } catch (error) {
    console.error("\n[FAIL] Live session test failed:");
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (a) await a.close();
    if (b) await b.close();
    if (c) await c.close();
  }
}

run();
