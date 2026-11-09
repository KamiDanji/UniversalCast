
# UniversalCast Roadmap

## M0 — Protocol foundation
- [ ] Approve UCP 1.0 draft envelope and terminology.
- [ ] Define message schemas and validation.
- [ ] Define playback states and transition rules.
- [ ] Define discovery and pairing flows.
- [ ] Add conformance fixtures.
- [ ] Add receiver simulator.

## M1 — Discovery and pairing
- [ ] mDNS/DNS-SD receiver advertisement.
- [ ] Sender discovery and manual-IP fallback.
- [ ] QR pairing challenge.
- [ ] Authenticated control channel.
- [ ] Credential storage and revocation.

## M2 — Android TV receiver
- [ ] Receiver application shell.
- [ ] WebSocket server and protocol dispatcher.
- [ ] Media3 adapter.
- [ ] Capability advertisement.
- [ ] State snapshots and events.

## M3 — Android sender
- [ ] Receiver picker.
- [ ] Pairing UI.
- [ ] Remote playback controls.
- [ ] Reconnection and snapshot reconciliation.

## M4 — Media delivery
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


## M1.3 — Session management

The development receiver implements in-memory session create/join/snapshot/leave, controller lease release on disconnect, and receiver-authoritative idle snapshots. See `docs/M1.3-SESSION-MANAGEMENT.md` for limitations and test commands.

## M1.4 — Playback state management
- [x] Media descriptor validation and load-state snapshot.
- [x] Play, pause, seek and stop state transitions.
- [x] Monotonic snapshot revisions and `state.changed` events.
- [x] Controller authorization and invalid-transition rejection.
- [x] Automated and live WebSocket playback tests.
- [ ] Real media-engine integration (future receiver milestone).


## M1.5 — Media delivery foundations

- Sender-side temporary HTTP host for explicitly approved local files.
- Single byte-range support (`206`), `HEAD`, MIME detection and short-lived per-file bearer grants.
- `media.load` descriptors for local/remote delivery, expiry, HLS/DASH/progressive source types, technical metadata, audio tracks and subtitle tracks.
- Remote URL DNS policy primitive; production fetching still requires DNS pinning and redirect revalidation.
- No actual media decoding or HLS segment proxying in the simulator.

See `docs/M1.5-MEDIA-DELIVERY.md`.
