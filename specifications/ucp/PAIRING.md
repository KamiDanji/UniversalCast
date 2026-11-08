
# UCP Pairing

## Goals

- Explicit user approval.
- No cloud account required.
- Persistent device identity.
- Revocation of paired senders.
- No permanent secret embedded in a QR code.

## Initial flow

1. Receiver enters a short pairing window after user action.
2. Receiver displays a QR code containing receiver ID, endpoint hint, protocol version, expiry, and a random one-time challenge.
3. Sender scans the QR code and connects.
4. Receiver displays or confirms a short authentication code / user approval prompt.
5. Sender and receiver establish authenticated key material using a reviewed standard protocol and platform cryptographic libraries.
6. Receiver records the sender public identity and assigned role.
7. Future connections authenticate using the stored identity; pairing can be revoked from receiver settings.

## Security requirements

- QR challenges expire quickly and are single-use.
- Do not place a long-lived private key or bearer credential in the QR code.
- Use established cryptographic protocols and libraries; do not design a custom key exchange.
- Store private keys in platform secure storage where available.
- Pairing and control must be protected against replay.
- Provide a visible paired-device list and revoke action.

## Implementation note

The exact cryptographic handshake is intentionally not frozen in this draft. Select a well-reviewed approach (for example, TLS 1.3 with certificate/public-key pinning and an out-of-band pairing confirmation) and document certificate rotation, recovery, and revocation before implementation.
