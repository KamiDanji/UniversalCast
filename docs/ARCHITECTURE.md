
# UniversalCast Architecture

## 1. System roles

- **Sender:** discovers receivers, pairs, creates/joins sessions, issues commands, and renders playback state.
- **Receiver:** advertises capabilities, authenticates senders, owns the playback session, executes media operations, and publishes state.
- **Media origin:** HTTP(S) server that supplies media bytes, playlists, segments, subtitles, and keys where applicable. It may be remote or hosted locally by a sender.
- **Optional services:** update distribution, opt-in diagnostics, remote relay, and user-managed library services. None are required for local casting.

## 2. Planes

### Discovery plane
mDNS/DNS-SD advertises `_universalcast._tcp.local.`. Discovery is a hint, not proof of identity.

### Control plane
An authenticated WebSocket connection carries UCP JSON messages. WebSocket is for control and state only; do not tunnel media bytes through it.

### Session plane
The receiver is authoritative for playback state. A session may continue after the sender disconnects. A reconnecting sender requests a fresh snapshot.

### Media plane
The receiver fetches media using HTTP(S). Support byte-range requests where the media format and origin permit seeking. For local media, a sender may expose a temporary HTTP server reachable by the receiver.

## 3. Platform adapters

Each receiver implements a shared conceptual interface:

- `load(mediaDescriptor)`
- `play()`
- `pause()`
- `seek(positionMs)`
- `stop()`
- `getSnapshot()`
- `getCapabilities()`

Platform-specific implementations:
- Android TV / Google TV: Kotlin + AndroidX Media3.
- Samsung Tizen: TypeScript/web application + supported Tizen media APIs.
- LG webOS: TypeScript/web application + supported webOS APIs.

Do not assume identical codec, subtitle, DRM, or background-execution support across TV models.

## 4. Sender implementations

- Android: Kotlin, Android NSD, WebSocket client, Keystore.
- Windows: Tauri + TypeScript; native Rust facilities only where needed.
- iOS/iPadOS: Swift, Bonjour/Network framework, URLSession WebSocket, Keychain.

Shared TypeScript packages define protocol types, schemas, validation, and fixtures. Platform-native applications may generate or consume equivalent types.

## 5. Reliability

- Commands have unique IDs and are idempotent where practical.
- Receiver state has a monotonically increasing revision per session.
- Sender reconnects by requesting a full state snapshot.
- A lost sender connection does not automatically stop playback.
- Receiver restart ends the old in-memory session unless a later persistence design explicitly supports recovery.
- Network and media errors are distinct.

## 6. Security boundaries

- Discovery responses are untrusted.
- Pairing requires explicit user approval.
- Control connections require authenticated encryption.
- Media URLs are validated and redirects are restricted.
- Local media endpoints use short-lived, scoped credentials.
- Receiver fetchers must defend against SSRF and access to sensitive local-network services.

Documentation license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/.
