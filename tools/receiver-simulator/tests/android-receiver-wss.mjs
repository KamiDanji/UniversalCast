import https from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import tls from "node:tls";
import WebSocket from "ws";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) {
    args.set(key.slice(2), next);
    index += 1;
  } else {
    args.set(key.slice(2), true);
  }
}

const urlText = args.get("url");
const fingerprintText = args.get("fingerprint");
const expectPinFailure = args.get("expect-pin-failure") === true;
if (!urlText || !fingerprintText) {
  console.error(
    "Usage: node tests/android-receiver-wss.mjs --url wss://<receiver-ip>:8766/ucp --fingerprint <SHA256-fingerprint> [--expect-pin-failure]"
  );
  process.exit(2);
}

const url = new URL(urlText);
if (url.protocol !== "wss:" || url.username || url.password || url.hash || url.search) {
  throw new Error("Only a credential-free wss:// URL without a query or fragment is accepted.");
}
if (url.pathname !== "/ucp") {
  throw new Error("The Android receiver control path must be /ucp.");
}

function normalizeFingerprint(value) {
  const normalized = value
    .replace(/^sha-?256:/i, "")
    .replaceAll(":", "")
    .replaceAll("-", "")
    .replaceAll(/\s/g, "")
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("--fingerprint must be a SHA-256 fingerprint (64 hex digits, optionally colon-separated).");
  }
  return normalized;
}

const expectedFingerprint = normalizeFingerprint(fingerprintText);

class CertificatePinAgent extends https.Agent {
  constructor(expected) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.expectedFingerprint = expected;
    this.peerFingerprint = null;
    this.protocol = null;
  }

  createConnection(options, callback) {
    const hostname = options.hostname ?? options.host;
    const host = hostname?.replace(/^\[|\]$/g, "");
    const port = Number(options.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) {
      callback(new Error("HTTPS agent did not provide a valid host and port."));
      return undefined;
    }

    const socket = tls.connect({
      host,
      port,
      ...(isIP(host) ? {} : { servername: host }),
      rejectUnauthorized: false,
      ALPNProtocols: ["http/1.1"],
    });
    let completed = false;
    const finish = (error, stream) => {
      if (completed) return;
      completed = true;
      callback(error, stream);
    };
    const onSocketError = error => finish(error);
    socket.once("error", onSocketError);
    socket.setTimeout(10_000, () => {
      const error = new Error("Timed out establishing the pinned TLS connection.");
      error.code = "ERR_UCP_TLS_TIMEOUT";
      socket.destroy(error);
    });
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      if (!certificate?.raw) {
        const error = new Error("The receiver did not present a TLS certificate.");
        error.code = "ERR_UCP_NO_CERTIFICATE";
        finish(error);
        socket.destroy();
        return;
      }

      const actual = createHash("sha256").update(certificate.raw).digest("hex");
      if (actual !== this.expectedFingerprint) {
        const error = new Error(
          "Receiver certificate pin mismatch (expected " +
          this.expectedFingerprint + ", received " + actual + ")."
        );
        error.code = "ERR_UCP_CERT_PIN_MISMATCH";
        finish(error);
        socket.destroy();
        return;
      }

      const now = Date.now();
      const validFrom = Date.parse(certificate.valid_from);
      const validTo = Date.parse(certificate.valid_to);
      if (!Number.isFinite(validFrom) || !Number.isFinite(validTo) || now < validFrom || now > validTo) {
        const error = new Error("The pinned receiver certificate is outside its validity period.");
        error.code = "ERR_UCP_CERT_NOT_VALID";
        finish(error);
        socket.destroy();
        return;
      }
      if (socket.getProtocol() !== "TLSv1.2") {
        const error = new Error("Expected TLSv1.2, negotiated " + (socket.getProtocol() ?? "unknown") + ".");
        error.code = "ERR_UCP_TLS_VERSION";
        finish(error);
        socket.destroy();
        return;
      }

      this.peerFingerprint = actual;
      this.protocol = socket.getProtocol();
      socket.setTimeout(0);
      socket.removeListener("error", onSocketError);
      // The HTTPS request receives this socket only after TLS and pin checks finish.
      finish(null, socket);
    });
    return undefined;
  }
}

const agent = new CertificatePinAgent(expectedFingerprint);
const socket = new WebSocket(url, {
  agent,
  perMessageDeflate: false,
  handshakeTimeout: 10_000,
});

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function sendHello(ws) {
  const id = randomUUID();
  const request = {
    protocol: "UCP",
    version: "1.0",
    type: "request",
    id,
    sessionId: null,
    seq: 1,
    sentAt: new Date().toISOString(),
    action: "connection.hello",
    payload: { supportedVersions: ["1.0"] },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for connection.auth.challenge.")), 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onMessage = raw => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        cleanup();
        reject(new Error("Receiver returned invalid JSON during the UCP handshake."));
        return;
      }
      if (message.action !== "connection.auth.challenge") return;
      cleanup();
      if (message.type === "error") {
        reject(new Error(message.payload?.code + ": " + message.payload?.message));
      } else {
        resolve(message);
      }
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.send(JSON.stringify(request), error => {
      if (error) onError(error);
    });
  });
}

try {
  await waitForOpen(socket);
  console.log("PASS  TLS " + agent.protocol + " certificate fingerprint matched before the WebSocket request.");
  if (expectPinFailure) {
    throw new Error("A wrong fingerprint unexpectedly opened the WebSocket connection.");
  }

  const challenge = await sendHello(socket);
  if (challenge.type !== "event" || challenge.action !== "connection.auth.challenge") {
    throw new Error("Receiver did not issue the expected per-connection authentication challenge.");
  }
  if (challenge.payload?.protocolVersion !== "1.0" || !/^[A-Za-z0-9_-]{43}$/.test(challenge.payload?.nonce ?? "")) {
    throw new Error("Receiver returned an invalid UCP 1.0 authentication challenge.");
  }
  if (!challenge.payload?.receiverId || challenge.payload?.expiresInMs !== 30_000) {
    throw new Error("Authentication challenge is missing its receiver binding or expiry.");
  }
  console.log("PASS  UCP 1.0 connection.hello received a fresh authentication challenge over pinned WSS.");
  console.log("INFO  This validates receiver pinning and challenge issuance; sender authentication requires pairing.");
} catch (error) {
  if (expectPinFailure && error?.code === "ERR_UCP_CERT_PIN_MISMATCH") {
    console.log("PASS  Wrong fingerprint rejected before any WebSocket or UCP request was sent.");
  } else {
    console.error("Android receiver WSS verification failed:", error.message);
    process.exitCode = 1;
  }
} finally {
  agent.destroy();
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.terminate();
  }
}
