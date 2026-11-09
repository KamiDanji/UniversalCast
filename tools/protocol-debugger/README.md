# UCP Protocol Debugger

Browse for UCP receivers or connect manually and perform the initial UCP hello exchange.

## Discover receivers

```powershell
pnpm --filter @universalcast/protocol-debugger dev
```

## Connect manually

```powershell
pnpm --filter @universalcast/protocol-debugger dev -- --host=192.168.1.25 --port=8765
```

This tool currently tests discovery and the development-only hello/welcome handshake. It does not perform pairing.
