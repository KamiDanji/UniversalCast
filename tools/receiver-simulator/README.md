# UCP Receiver Simulator (development only)

A minimal Windows-friendly HTTP health endpoint and UCP WebSocket receiver with mDNS advertisement.

## Run

From the repository root:

```powershell
pnpm install
pnpm --filter @universalcast/receiver-simulator dev
```

Optional environment variables:

```powershell
$env:UCP_DEVICE_NAME = "My Windows PC"
$env:UCP_HOST = "0.0.0.0"
$env:UCP_PORT = "8765"
pnpm --filter @universalcast/receiver-simulator dev
```

Health check: `http://127.0.0.1:8765/health`  
WebSocket: `ws://<PC-LAN-IP>:8765/ucp`

## Security warning

This simulator intentionally has **no pairing or authentication** and advertises `tls=0`. It is for isolated development/testing only. Do not port-forward it, expose it to public networks, or use it as a production receiver. Windows Firewall may prompt for Node.js network access. Permit access only on trusted Private networks. Discovery cannot cross VLANs or Wi-Fi client-isolation boundaries.

## M1.4 playback-state simulation

The simulator implements `media.load`, `playback.play`, `playback.pause`, `playback.seek`, and `playback.stop`. Successful state changes increment the receiver-authoritative snapshot revision and emit `state.changed` to the session's attached controller. The simulator validates HTTP(S) media source descriptors, local grant expiry, technical metadata, and audio/subtitle track descriptors, but does not fetch or play media. Use `tools/media-host` for temporary sender-hosted files; see `docs/M1.5-MEDIA-DELIVERY.md`.

Run the live two-sender playback test while the receiver is running in another terminal:

```powershell
pnpm --filter @universalcast/receiver-simulator exec node tests/playback-live.mjs
```
