# UniversalCast

**UniversalCast Protocol (UCP)** is an open, local-first media-casting protocol and cross-platform receiver ecosystem.

The project aims to let sender applications discover, pair with, and control compatible receivers without requiring a vendor cloud account or a proprietary casting service.

## Project status

- Project phase: M2 — Android TV receiver (M2.1 emulator playback verified; M2.2 development UCP WebSocket control implementation prepared for live verification)
- Protocol: UCP 1.0 Draft
- Repository status: Protocol simulator, session/playback state, local media host, and M1.6 media-delivery hardening implemented and tested
- Current receiver target: Native Kotlin + AndroidX Media3 on Android TV / Google TV
- License: Apache-2.0 for code; CC BY 4.0 for specifications and documentation

> UCP 1.0 is an initial project specification, not an established industry standard. Wire-level details may change before a stable release.

## Design principles

1. Local-network-first; no mandatory cloud service.
2. Separate discovery, control, session, and media transport.
3. Receiver-authoritative playback state.
4. Capability negotiation before exposing optional controls.
5. Explicit pairing and authenticated control connections.
6. Platform-specific media adapters behind a shared receiver interface.
7. Versioned, testable protocol with conformance fixtures.

## Repository layout

- `apps/` — sender and receiver applications.
- `packages/` — shared TypeScript protocol packages.
- `specifications/ucp/` — normative protocol documents.
- `tools/` — development and debugging utilities.
- `tests/` — fixtures, conformance, and integration tests.
- `docs/` — architecture, roadmap, and contribution guidance.

## Development status

1. UCP 1.0 draft envelope, validation, playback-state model, and conformance fixtures are implemented.
2. Development receiver simulator supports handshake, sessions, playback commands, and state events.
3. Sender-side local media host supports temporary grants, HTTP byte ranges, and concurrent clients.
4. M1.6 automated hardening and live VLC tests have passed on PC and phone.
5. M2.0/M2.1 Android TV foundation and Media3 playback have passed emulator playback testing.
6. M2.2 adds a development-only UCP WebSocket control endpoint; live cross-platform verification is pending.
7. Pairing/authenticated control, mDNS discovery and sender applications remain future work; the Android M2.2 endpoint is also development-only.

## Licensing

- Source code and SDKs: Apache License 2.0.
- Protocol specifications and documentation: Creative Commons Attribution 4.0 International.
- See `LICENSE` and `NOTICE`.

## Security

Do not expose an unauthenticated receiver control port to untrusted networks. Do not treat LAN membership as authentication. See `specifications/ucp/SECURITY.md`.

## Contributing

See `docs/CONTRIBUTING.md`. During Milestone 0, protocol changes should be discussed before implementation so sender and receiver behavior remains interoperable.


## Media delivery development tool

M1.5 adds `tools/media-host`, a temporary sender-side HTTP server for explicitly granted local media files, including byte-range requests. See `docs/M1.5-MEDIA-DELIVERY.md`. It is development-only and uses plain HTTP; do not expose it to untrusted networks.
