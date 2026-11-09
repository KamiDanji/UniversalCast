import assert from "node:assert/strict";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import test from "node:test";
import { authenticationTranscript, pairingTranscript, shortAuthenticationString } from "./android-pairing-protocol.mjs";

const receiverId = "12345678-1234-5678-9abc-def012345678";
const senderId = "87654321-4321-8765-cba9-876543210fed";
const publicKeyDer = Buffer.from("MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmct7tLzqSWyePF3X2vsTtZ3vhWDzNq8E5lIZk3HEtD7jsHxOxTXHiNHSv3h9Qt987B3AMLRqF/FahQfDiRj7wA==", "base64");
const pairingExpectedHex = "5543502d504149522d3112345678123456789abcdef0123456788765432143218765cba9876543210fedf61252489b17b647cf5840a5a1abd25688cd1b8a4bea2ec433d6124055c6865011111111111111111111111111111111111111111111111111111111111111112222222222222222222222222222222222222222222222222222222222222222";
const authExpectedHex = "5543502d415554482d3112345678123456789abcdef0123456788765432143218765cba9876543210fed01003333333333333333333333333333333333333333333333333333333333333333";

test("pairing transcript matches the UCP-PAIR-1 byte vector", () => {
  const challenge = Buffer.alloc(32, 0x11).toString("base64url");
  const senderNonce = Buffer.alloc(32, 0x22).toString("base64url");
  const transcript = pairingTranscript(challenge, receiverId, senderId, publicKeyDer, senderNonce);
  assert.equal(transcript.length, 138);
  assert.equal(transcript.toString("hex"), pairingExpectedHex);
  assert.match(shortAuthenticationString(transcript), /^\d{6}$/);
});

test("authentication transcript matches UCP-AUTH-1 and its proof verifies", () => {
  const nonce = Buffer.alloc(32, 0x33).toString("base64url");
  const transcript = authenticationTranscript(receiverId, senderId, nonce);
  assert.equal(transcript.length, 76);
  assert.equal(transcript.toString("hex"), authExpectedHex);

  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signature = sign("sha256", transcript, pair.privateKey);
  assert.equal(verify("sha256", transcript, pair.publicKey, signature), true);
  assert.equal(verify("sha256", authenticationTranscript(receiverId, senderId, Buffer.alloc(32, 0x34).toString("base64url")), pair.publicKey, signature), false);
});
