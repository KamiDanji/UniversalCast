
# Contributing

Thanks for your interest in UniversalCast.

## Before implementation
- Read `README.md` and `specifications/ucp/`.
- For protocol changes, open an issue describing compatibility impact.
- Do not silently change message names, required fields, state semantics, or discovery TXT keys.

## Pull requests
- Keep changes focused.
- Include tests or conformance fixtures for protocol behavior.
- Document platform-specific limitations.
- Never commit secrets, private keys, pairing credentials, or real media URLs containing tokens.

## Protocol compatibility
- Additive optional fields are preferred.
- Unknown optional fields should be ignored.
- Unknown required capabilities or message actions must fail safely with a structured error.
- Breaking changes require a new protocol version or an explicitly negotiated extension.

## Security reports
Do not publish exploitable vulnerabilities in public issues. Use the repository's private vulnerability reporting process once enabled.

Documentation license: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/.
