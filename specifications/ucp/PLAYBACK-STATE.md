
# UCP Playback State

## States

- `idle`: no media loaded.
- `loading`: receiver is preparing media.
- `ready`: media loaded and ready but not playing.
- `playing`: media actively playing.
- `paused`: playback paused.
- `buffering`: media engine is waiting for data.
- `ended`: media reached its end.
- `error`: media engine failed.

## Typical transitions

- idle → loading
- loading → ready
- loading → error
- ready → playing
- ready → paused
- playing → paused
- paused → playing
- playing → buffering
- buffering → playing
- buffering → paused
- playing → ended
- any loaded state → idle via unload/stop
- error → loading for a new load attempt

The media engine may report additional platform-specific detail, but the protocol status must map to one of these values.

## State snapshot

```json
{
  "revision": 42,
  "status": "playing",
  "mediaId": "episode-001",
  "positionMs": 125500,
  "durationMs": 1420000,
  "bufferedMs": 160000,
  "playbackRate": 1.0,
  "updatedAt": "2026-11-08T20:00:00Z"
}
```

## Authority and synchronization

- Receiver is authoritative.
- Receiver increments revision for externally visible state changes.
- Sender may interpolate position for smooth UI but must reconcile against receiver snapshots.
- On reconnect, sender requests a full snapshot.
- Lower revisions must not overwrite higher revisions.
- Seeking is requested in milliseconds; receiver reports actual resulting position.
- Position and duration may be null when unknown or unavailable.
