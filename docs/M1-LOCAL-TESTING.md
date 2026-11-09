# M1 Local Testing

## Purpose
Validate that a Windows host can advertise a UCP receiver and that a sender can discover it and perform the initial hello exchange.

## Prerequisites
- Node.js 22 or compatible current LTS
- pnpm 10
- Both devices on the same trusted LAN
- Multicast DNS allowed by the router and OS firewall

## Start the receiver on Windows

```powershell
pnpm install
pnpm --filter @universalcast/receiver-simulator dev
```

Check `http://127.0.0.1:8765/health`.

## Discover from another machine

```powershell
pnpm --filter @universalcast/protocol-debugger dev
```

## Connect manually

```powershell
pnpm --filter @universalcast/protocol-debugger dev -- --host=<WINDOWS-LAN-IP> --port=8765
```

## Important limitation
The current simulator uses plain WebSocket and has no pairing/authentication. It is a development-only smoke-test harness, not a secure or production receiver. Keep it on a trusted LAN and stop it after testing.
