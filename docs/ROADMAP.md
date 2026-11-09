# UniversalCast Roadmap

## M0 — Protocol foundation <badge>Completed in implementation</badge>

- [x] UCP 1.0 draft envelope and terminology.
- [x] Message validation, version negotiation, sequence handling and duplicate request detection.
- [x] Playback states, transition rules and state revisions.
- [x] Conformance fixtures and receiver simulator.

## M1 — Development receiver and media delivery <badge>Verified</badge>

- [x] WebSocket development receiver and mDNS advertisement.
- [x] Session create/join/snapshot/leave and controller handover.
- [x] Playback load/play/pause/seek/stop state transitions.
- [x] Sender-side local HTTP media host with temporary bearer grants.
- [x] HTTP HEAD and byte-range delivery.
- [x] Concurrent byte-range requests and interrupted-transfer regression tests.
- [x] Live VLC playback from PC and phone, including two simultaneous clients.
- [ ] Production pairing and authenticated control channel — not implemented; remains a security prerequisite.

## M2 — Android TV receiver <badge>In progress</badge>

- [x] M2.0 native Kotlin project foundation.
- [x] Android TV launcher support and Media3 dependency integration.
- [x] Development URL playback screen.
- [x] M2.1 reusable Media3 playback adapter and UCP playback-state mapping (emulator playback verified).
- [x] M2.2 development UCP WebSocket control endpoint and protocol dispatcher (Android emulator live test passed).
- [x] M2.3 Android mDNS/DNS-SD receiver advertisement (Windows/Bonjour emulator discovery verified; physical Android TV LAN verification pending).
- [ ] M2.4 secure pairing and authenticated control (Android debug pairing UI, QR bootstrap, sender trust store, role gates, and WSS auth implemented; cross-platform device validation pending).
- [ ] M2.5 end-to-end casting from a UniversalCast sender.

## M3 — Android sender

- [ ] Receiver picker and manual IP fallback.
- [ ] Pairing UI.
- [ ] Remote playback controls.
- [ ] Reconnection and snapshot reconciliation.

## M4 — Media delivery expansion

- [ ] Direct HTTP(S) media.
- [ ] HLS where supported.
- [ ] Sender-hosted local HTTP media with Range support.
- [ ] External subtitle tracks.
- [ ] Audio/subtitle capability negotiation.
- [ ] Queue and next-episode behavior.

## M5 — Windows sender

- [ ] Tauri shell.
- [ ] Discovery, pairing, and control.
- [ ] Local file casting.
- [ ] Drag-and-drop and media metadata.

## M6 — iOS and additional receivers

- [ ] iOS sender.
- [ ] Samsung Tizen receiver.
- [ ] LG webOS receiver.
- [ ] Real-device compatibility matrix.

## M7 — Production readiness

- [ ] Security review.
- [ ] Long-session and network fault testing.
- [ ] TV model compatibility testing.
- [ ] Accessibility and localization.
- [ ] Release packaging and SDK documentation.

Milestone estimates are planning estimates only. TV manufacturer approval, hardware testing, and platform restrictions can materially affect schedule.

Documentation license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/.
