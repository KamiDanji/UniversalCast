# Conformance Tests

Cross-implementation protocol behavior tests will live here.


## M1.2 receiver protocol tests

The receiver simulator currently has automated tests for envelope validation, handshake/version negotiation, duplicate request IDs, and per-connection sequence ordering. Run them with `pnpm --filter @universalcast/receiver-simulator test`. See `docs/M1.2-PROTOCOL-RELIABILITY.md`.
