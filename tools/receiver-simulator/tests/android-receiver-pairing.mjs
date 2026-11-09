import https from "node:https";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { isIP } from "node:net";
import tls from "node:tls";
import WebSocket from "ws";
import { authenticationTranscript, pairingTranscript, shortAuthenticationString } from "./android-pairing-protocol.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1];
  if (value && !value.startsWith("--")) {
    args.set(key.slice(2), value);
    index += 1;
  } else args.set(key.slice(2), true);
}

const urlText = args.get("url");
const fingerprintText = args.get("fingerprint");
const receiverId = args.get("receiver-id");
const pairingChallenge = args.get("challenge");
const expiresAt = args.get("expires-at");
const displayName = args.get("display-name") ?? "UniversalCast Node test";
const expectedRole = args.get("expect-role");
if (!urlText || !fingerprintText || !receiverId || !pairingChallenge) {
  console.error("Usage: node tests/android-receiver-pairing.mjs --url wss://<receiver-ip>:8766/ucp --fingerprint <SHA256> --receiver-id <UUID> --challenge <base64url> [--expires-at <ISO timestamp>] [--display-name <name>] [--expect-role controller|observer]");
  process.exit(2);
}

const url = new URL(urlText);
if (url.protocol !== "wss:" || url.username || url.password || url.hash || url.search || url.pathname !== "/ucp") {
  throw new Error("Only a credential-free wss:// URL without query or fragment and with the /ucp path is accepted.");
}
const expectedFingerprint = fingerprintText.replace(/^sha-?256:/i, "").replaceAll(":", "").replaceAll("-", "").replaceAll(/\s/g, "").toLowerCase();
if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) throw new Error("--fingerprint must be a SHA-256 fingerprint.");
if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error("The QR pairing challenge has expired.");

class CertificatePinAgent extends https.Agent {
  constructor(expected) {
    super({ keepAlive: false, maxCachedSessions: 0 });
    this.expectedFingerprint = expected;
    this.protocol = null;
  }
  createConnection(options, callback) {
    const host = (options.hostname ?? options.host)?.replace(/^\[|\]$/g, "");
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
    const onError = error => finish(error);
    socket.once("error", onError);
    socket.setTimeout(10_000, () => socket.destroy(new Error("Timed out establishing pinned TLS.")));
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      if (!certificate?.raw) {
        const error = new Error("Receiver did not present a TLS certificate.");
        finish(error);
        socket.destroy();
        return;
      }
      const actual = createHash("sha256").update(certificate.raw).digest("hex");
      if (actual !== this.expectedFingerprint) {
        const error = new Error("Receiver certificate pin mismatch.");
        error.code = "ERR_UCP_CERT_PIN_MISMATCH";
        finish(error);
        socket.destroy();
        return;
      }
      const now = Date.now();
      if (now < Date.parse(certificate.valid_from) || now > Date.parse(certificate.valid_to)) {
        finish(new Error("Pinned receiver certificate is outside its validity period."));
        socket.destroy();
        return;
      }
      if (socket.getProtocol() !== "TLSv1.2") {
        finish(new Error("Expected TLSv1.2, negotiated " + (socket.getProtocol() ?? "unknown") + "."));
        socket.destroy();
        return;
      }
      this.protocol = socket.getProtocol();
      socket.setTimeout(0);
      socket.removeListener("error", onError);
      finish(null, socket);
    });
    return undefined;
  }
}

function openSocket() {
  const agent = new CertificatePinAgent(expectedFingerprint);
  const socket = new WebSocket(url, { agent, perMessageDeflate: false, handshakeTimeout: 10_000 });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return { agent, socket, opened };
}

function waitForMessage(socket, predicate, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Timed out waiting for the expected UCP response.")), timeoutMs);
    const onError = error => finish(error);
    const onClose = () => finish(new Error("Receiver closed the connection before replying."));
    const onMessage = raw => {
      let message;
      try { message = JSON.parse(raw.toString()); }
      catch { return finish(new Error("Receiver sent invalid JSON.")); }
      if (!predicate(message)) return;
      finish(null, message);
    };
    const finish = (error, message) => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) reject(error);
      else resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function makeRequest(seq, action, payload = {}, sessionId = null) {
  return {
    protocol: "UCP", version: "1.0", type: "request", id: randomUUID(), sessionId,
    seq, sentAt: new Date().toISOString(), action, payload,
  };
}
function send(socket, envelope) {
  return new Promise((resolve, reject) => socket.send(JSON.stringify(envelope), error => error ? reject(error) : resolve()));
}
function verifyPinProof(result, action, requestId) {
  if (result.type !== "response" || result.replyTo !== requestId || result.action !== action) {
    throw new Error("Unexpected UCP response: " + (result.payload?.code ?? result.action));
  }
}

let activeConnection = null;
try {
  const senderId = randomUUID();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  const pairNonce = randomBytes(32).toString("base64url");

  const first = openSocket();
  activeConnection = first;
  await first.opened;
  console.log("PASS  TLS " + first.agent.protocol + " receiver certificate pin matched before upgrade.");

  let seq = 1;
  const hello = makeRequest(seq++, "connection.hello", { supportedVersions: ["1.0"] });
  const authChallengePromise = waitForMessage(first.socket, message => message.action === "connection.auth.challenge");
  await send(first.socket, hello);
  const authChallenge = await authChallengePromise;
  if (authChallenge.type !== "event" || authChallenge.payload?.receiverId !== receiverId) throw new Error("Receiver identity in the QR payload does not match the connected receiver.");
  const denied = makeRequest(seq++, "connection.ping");
  const deniedPromise = waitForMessage(first.socket, message => message.replyTo === denied.id);
  await send(first.socket, denied);
  const deniedResponse = await deniedPromise;
  if (deniedResponse.type !== "error" || deniedResponse.payload?.code !== "NOT_PAIRED") throw new Error("Unauthenticated control request was not rejected.");
  console.log("PASS  Unpaired sender was denied UCP control.");

  const pairTranscript = pairingTranscript(pairingChallenge, receiverId, senderId, publicKeyDer, pairNonce);
  const sas = shortAuthenticationString(pairTranscript);
  console.log("Compare this six-digit SAS with the TV prompt: " + sas);
  const pairRequest = makeRequest(seq++, "pairing.request", {
    challenge: pairingChallenge,
    senderId,
    displayName,
    senderPublicKey: publicKeyDer.toString("base64url"),
    senderNonce: pairNonce,
    signature: sign("sha256", pairTranscript, privateKey).toString("base64url"),
  });
  const remainingMs = expiresAt ? Math.max(1_000, Date.parse(expiresAt) - Date.now()) : 120_000;
  const pairResultPromise = waitForMessage(first.socket, message => message.replyTo === pairRequest.id, remainingMs + 5_000);
  await send(first.socket, pairRequest);
  const pairResult = await pairResultPromise;
  verifyPinProof(pairResult, "pairing.approved", pairRequest.id);
  console.log("PASS  TV approved and persisted the sender identity as " + pairResult.payload.role + ".");
  first.socket.terminate();
  first.agent.destroy();
  activeConnection = null;

  const second = openSocket();
  activeConnection = second;
  await second.opened;
  let authSeq = 1;
  const secondHello = makeRequest(authSeq++, "connection.hello", { supportedVersions: ["1.0"] });
  const secondChallengePromise = waitForMessage(second.socket, message => message.action === "connection.auth.challenge");
  await send(second.socket, secondHello);
  const secondChallenge = await secondChallengePromise;
  if (secondChallenge.payload?.receiverId !== receiverId || secondChallenge.payload?.expiresInMs !== 30_000) {
    throw new Error("Reconnect authentication challenge did not match the pairing receiver.");
  }
  const proof = makeRequest(authSeq++, "connection.auth.prove", {
    senderId,
    signature: sign("sha256", authenticationTranscript(receiverId, senderId, secondChallenge.payload.nonce), privateKey).toString("base64url"),
  });
  const authenticatedPromise = waitForMessage(second.socket, message => message.replyTo === proof.id);
  const welcomePromise = waitForMessage(second.socket, message => message.replyTo === secondHello.id);
  await send(second.socket, proof);
  const [authenticated, welcome] = await Promise.all([authenticatedPromise, welcomePromise]);
  verifyPinProof(authenticated, "connection.authenticated", proof.id);
  verifyPinProof(welcome, "connection.welcome", secondHello.id);
  if (welcome.payload?.security?.authenticated !== true || welcome.payload?.security?.senderId !== senderId) {
    throw new Error("Receiver did not confirm the paired sender identity.");
  }
  if (expectedRole && welcome.payload?.security?.role !== expectedRole) throw new Error("Receiver assigned an unexpected role.");
  console.log("PASS  Paired sender authenticated after reconnect as " + welcome.payload.security.role + ".");

  const ping = makeRequest(authSeq++, "connection.ping", { test: "android-pairing" });
  const pongPromise = waitForMessage(second.socket, message => message.replyTo === ping.id);
  await send(second.socket, ping);
  const pong = await pongPromise;
  verifyPinProof(pong, "connection.pong", ping.id);
  console.log("PASS  Authenticated UCP ping succeeded.");
} catch (error) {
  console.error("Android receiver pairing verification failed:", error.message);
  process.exitCode = 1;
} finally {
  activeConnection?.agent.destroy();
  if (activeConnection?.socket.readyState === WebSocket.OPEN || activeConnection?.socket.readyState === WebSocket.CONNECTING) activeConnection.socket.terminate();
}
