# UCP Security Requirements

## Threat model

Assume local networks may contain untrusted devices. LAN presence is not authentication. mDNS/DNS-SD records may be spoofed or modified by an attacker.

Threats include unauthorized control, receiver spoofing, replay, pairing-window abuse, credential theft, malicious media URLs, local-network request forgery, DNS rebinding, and abuse of sender-hosted media endpoints.

## Control-channel requirements

1. Production control connections use authenticated encryption via WebSocket over TLS (`wss://`), TLS 1.2 or newer.
2. Senders pin the receiver's certificate SHA-256 fingerprint obtained through the receiver's local pairing flow. Do not accept arbitrary self-signed certificates or silently downgrade to plaintext.
3. Pairing requires explicit approval on the receiver.
4. Pairing challenges are cryptographically random, short-lived, receiver-bound, and single-use.
5. Every sender has a persistent signing identity and proves possession on every new connection.
6. Sender private keys remain in platform secure storage where available.
7. Paired sender credentials are revocable; revocation terminates active connections.
8. Receiver authorizes each command according to controller/observer role.
9. State-changing commands remain protected against replay and duplicate execution by per-connection sequence numbers, request IDs, and authentication nonces.
10. Discovery metadata is never treated as proof of identity.
11. Secrets, private keys, pairing challenges, media tokens, and authentication transcripts must not be written to logs.

## Pairing bootstrap

The receiver opens a short pairing window only after local user action. Its QR payload contains public endpoint metadata, receiver ID, pinned-certificate fingerprint, expiry, and a one-time random challenge. It must not contain a private key, long-lived credential, or reusable bearer token. The sender signs a canonical, versioned pairing transcript using its persistent identity key. The receiver displays the sender identity and short authentication string for explicit approval.

## Media-delivery requirements

1. Media URLs are restricted to supported schemes (initially HTTP and HTTPS).
2. Redirects are validated at every hop.
3. Receiver media fetchers defend against SSRF, loopback access, link-local metadata endpoints, and sensitive private-network targets unless a narrowly scoped local-media exception is explicitly authorized.
4. Sender-hosted media endpoints use unpredictable short-lived tokens and expose only the selected media resource.
5. Media credentials must not be written to logs.

## Local media exception

A sender may intentionally host a media endpoint on its LAN interface. The receiver must only access the exact endpoint and resource authorized by the active session. Do not allow arbitrary URL parameters to turn this endpoint into a general-purpose proxy.

## Future review

Before public beta, perform a threat-model review, dependency audit, and tests for URL parsing, redirects, DNS rebinding, command replay, pairing expiry, credential revocation, TLS fingerprint mismatch, certificate rotation, and downgrade attempts.
