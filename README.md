# UniversalCast

**UniversalCast Protocol (UCP)** is an open, local-first media-casting protocol and cross-platform receiver ecosystem.

The project aims to let sender applications discover, pair with, and control compatible receivers without requiring a vendor cloud account or a proprietary casting service.

## Project status

- Project phase: Milestone 0 — Foundation
- Protocol: UCP 1.0 Draft
- Repository status: Initial scaffold
- First implementation target: Android sender ↔ Android TV receiver
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

## Initial development order

1. Freeze the UCP 1.0 message envelope and state model.
2. Implement schema validation and test fixtures.
3. Build a receiver simulator.
4. Implement Android TV discovery, pairing, and receiver.
5. Implement Android sender.
6. Add direct URL and local HTTP media delivery.
7. Expand to Windows, iOS, Samsung Tizen, and LG webOS.

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
