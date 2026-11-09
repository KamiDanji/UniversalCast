# UniversalCast temporary local media host (M1.5)

A sender-side development utility that exposes explicitly approved files over HTTP with short-lived, per-file bearer URLs. It supports `GET`, `HEAD`, single byte ranges (`206 Partial Content`), suffix/open-ended ranges, correct `416` responses, MIME detection, and explicit revocation.

## Run on Windows

From the repository root:

```powershell
pnpm install
pnpm --filter @universalcast/media-host dev -- --root "D:\Media" --file "D:\Media\sample.mp4" --host 0.0.0.0 --port 8766 --ttl-minutes 15
```

The CLI selects a non-loopback IPv4 address for the URL automatically. If your PC has multiple network adapters, specify `--advertise-host "192.168.x.x"`. The CLI prints a temporary URL. Put that URL into the UCP `media.load` source descriptor. The receiver must be able to reach the sender's LAN IP and TCP port 8766. Do not use `127.0.0.1` in the URL sent to another device; use the sender's LAN address. Add a Windows Firewall inbound rule for TCP 8766 on Private networks only if needed.

## Security model and limitations

- Only files whose resolved real path is inside a configured root can be granted; symlinks resolving outside the root are rejected.
- No directory listing or arbitrary path endpoint exists. The random 256-bit token is bound to one file and one expiry; it is stored as a SHA-256 digest and can be revoked.
- `GET` and `HEAD` only. No multi-range requests. Access URLs are bearer secrets: anyone who obtains one can read that one file until expiry/revocation.
- This development host uses plain HTTP. Use only trusted LANs; bearer URLs can be observed by anyone able to sniff that network. Production requires authenticated pairing, TLS or an equivalent protected transport, and lifecycle-managed grants.
- `assertPublicRemoteUrl()` performs DNS A/AAAA checks and rejects non-public destinations for genuinely remote fetching. A production fetcher must call it immediately before each request, revalidate every redirect, pin/validate the actual connected address to prevent DNS rebinding, limit redirects/timeouts/response size, and never forward credentials across origins. This helper alone is not a complete production SSRF defence.
- HLS manifests may reference additional segment/variant URLs. A production HLS pipeline must apply the same URL policy to every playlist, segment, key and redirect; this simulator only describes HLS sources and does not fetch/decode them.
