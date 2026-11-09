import { createHash } from "node:crypto";

export function uuidBytes(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Receiver and sender identities must be canonical lowercase UUIDs.");
  }
  return Buffer.from(value.replaceAll("-", ""), "hex");
}

function fixedBytes(value, expectedLength, fieldName) {
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedLength || decoded.toString("base64url") !== value) {
    throw new Error(`Invalid ${fieldName} encoding.`);
  }
  return decoded;
}

export function pairingTranscript(challengeText, receiver, sender, publicKeyDer, senderNonceText) {
  const challenge = fixedBytes(challengeText, 32, "pairing challenge");
  const senderNonce = fixedBytes(senderNonceText, 32, "sender nonce");
  const fingerprint = createHash("sha256").update(publicKeyDer).digest();
  return Buffer.concat([
    Buffer.from("UCP-PAIR-1", "ascii"), uuidBytes(receiver), uuidBytes(sender),
    fingerprint, challenge, senderNonce,
  ]);
}

export function authenticationTranscript(receiver, sender, nonceText) {
  const nonce = fixedBytes(nonceText, 32, "authentication nonce");
  return Buffer.concat([
    Buffer.from("UCP-AUTH-1", "ascii"), uuidBytes(receiver), uuidBytes(sender),
    Buffer.from([1, 0]), nonce,
  ]);
}

export function shortAuthenticationString(transcript) {
  return (createHash("sha256").update(transcript).digest().readUInt32BE(0) % 1_000_000)
    .toString().padStart(6, "0");
}
