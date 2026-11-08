
# UCP Discovery

## DNS-SD service

Service type: `_universalcast._tcp.local.`

The receiver advertises a host and TCP port for its control endpoint.

Suggested TXT keys:
- `ucp=1.0`
- `id=<stable-random-device-id>`
- `name=<display-name>`
- `path=/ucp`
- `tls=1`

TXT records are hints only. They are not authentication.

## Discovery flow

1. Receiver starts its local service.
2. Receiver advertises `_universalcast._tcp.local.`.
3. Sender browses for the service.
4. Sender resolves host and port.
5. Sender connects to the advertised endpoint.
6. Sender validates receiver identity during the authenticated handshake.
7. Sender performs version and capability negotiation.

## Fallbacks

- Manual IP/hostname entry.
- QR code containing a receiver identity and short-lived pairing challenge.
- A user-visible retry and network troubleshooting path.

## Network constraints

Discovery may fail across VLANs, guest Wi-Fi, client isolation, VPNs, or access points that block multicast. Implementations should provide clear diagnostics and manual connection as a fallback.
