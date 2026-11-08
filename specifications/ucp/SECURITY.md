
# UCP Security Requirements

## Threat model

Assume local networks may contain untrusted devices. LAN presence is not authentication.

Threats include unauthorized control, spoofed discovery, replayed commands, malicious media URLs, local-network request forgery, credential theft, and abuse of sender-hosted media endpoints.

## Requirements

1. Control connections use authenticated encryption.
2. Pairing requires explicit user approval.
3. Pairing challenges are short-lived and single-use.
4. Device credentials are revocable.
5. Receiver authorizes each command according to controller/observer role.
6. State-changing commands are protected against replay and duplicate execution.
7. Media URLs are restricted to supported schemes (initially HTTP and HTTPS).
8. Redirects are validated at every hop.
9. Receiver media fetchers defend against SSRF, loopback access, link-local metadata endpoints, and sensitive private-network targets unless a narrowly scoped local-media exception is explicitly authorized.
10. Sender-hosted media endpoints use unpredictable short-lived tokens and expose only the selected media resource.
11. Secrets and tokens must not be written to logs.
12. Discovery metadata is never treated as proof of identity.

## Local media exception

A sender may intentionally host a media endpoint on its LAN interface. The receiver must only access the exact endpoint and resource authorized by the active session. Do not allow arbitrary URL parameters to turn this endpoint into a general-purpose proxy.

## Future review

Before public beta, perform a threat-model review, dependency audit, and tests for URL parsing, redirects, DNS rebinding, command replay, pairing expiry, and credential revocation.
