
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
