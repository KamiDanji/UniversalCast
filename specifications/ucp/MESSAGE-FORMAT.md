
# UCP Message Format

## Envelope

```json
{
  "protocol": "UCP",
  "version": "1.0",
  "type": "request",
  "id": "req-123",
  "sessionId": "sess-123",
  "seq": 1,
  "sentAt": "2026-11-08T20:00:00Z",
  "action": "playback.seek",
  "payload": {
    "positionMs": 125000
  }
}
```

## Request

A request is initiated by a sender or receiver and expects a response.

## Response

A response MUST include `replyTo` with the original request ID. A response reports acceptance, rejection, or completion as defined by the action.

## Event

An event reports a receiver-side state change or lifecycle event. Events do not require a response.

## Error

An error identifies a failed request or protocol condition. It should include `replyTo` when associated with a request.

## Ordering and duplicate handling

- `id` is unique per message.
- `seq` is monotonic per connection direction, not globally comparable.
- `revision` on state snapshots/events is the authoritative state ordering mechanism.
- Receivers deduplicate state-changing request IDs for a bounded window.
- Commands with expired sessions or stale preconditions are rejected rather than applied blindly.
