# UniversalCast Android TV Receiver

Native Kotlin receiver application for Android TV / Google TV.

## M2.0–M2.2 scope

This milestone creates the native Android application foundation and integrates AndroidX Media3:

- Android TV Leanback launcher declaration and TV banner.
- Kotlin application module with a TV-oriented development screen.
- Media3 ExoPlayer and HLS modules.
- Manual HTTP(S) URL playback smoke-test screen.
- Basic player lifecycle and playback status reporting.
- Unit tests for development URL validation.
- M2.1 platform-neutral `PlaybackEngine` contract, Media3 implementation, UCP playback-state mapping and capability reporting.
- M2.2 development-only UCP 1.0 WebSocket endpoint on port `8765`, protocol handshake, one active receiver session, media loading and playback commands.
- M2.3 Android `NsdManager` DNS-SD advertisement for `_universalcast._tcp.local.`, including the UCP version, stable device ID, control path, and explicit development-mode metadata. Registration follows Activity lifecycle and refreshes after network changes.
- M2.4.1b debug-only WSS transport on port `8766`, backed by the receiver's Android Keystore identity. It does not authenticate senders; release builds expose no remote control until pairing and authorization are implemented.

M2.2/M2.3 implement a deliberately limited development control surface. The debug build offers unauthenticated `ws://` on port 8765 and an unauthenticated WSS transport prototype on port 8766; both bind to all interfaces and are suitable only for controlled trusted-LAN testing. TLS encrypts the connection but does not authenticate or authorize senders. Release builds expose no remote-control listener or receiver discovery until pairing and authorization are implemented. Discovery TXT records are not authentication. Pairing and production media-origin protections are not implemented.

## Toolchain

- Android Gradle Plugin: 8.11.1
- Gradle: 8.13
- Kotlin: 2.2.21
- JDK: 17
- Compile SDK: 36
- Target SDK: 35
- Minimum SDK: 23
- AndroidX Media3: 1.11.1
- Java-WebSocket: 1.5.7 (development control endpoint)

Open this directory (`apps/android-receiver`) directly in Android Studio and allow Gradle sync. Install Android SDK Platform 36 if prompted.

If your Android Studio setup does not have a Gradle wrapper yet, generate it from this directory using a local Gradle 8.13 installation:

```powershell
gradle wrapper --gradle-version 8.13
```

Then build and test:

```powershell
gradle :app:testDebugUnitTest
gradle :app:assembleDebug
```

After generating the wrapper, prefer `./gradlew` (macOS/Linux) or `.\gradlew` (Windows) for subsequent builds.

## First device smoke test

1. Enable Developer Options and USB/network debugging on the Android TV device.
2. Connect the TV to the same trusted LAN as the sender PC.
3. Run the `app` configuration from Android Studio.
4. On the receiver screen, enter the temporary media URL printed by `tools/media-host`.
5. Select **Play URL**. Confirm playback, pause, resume, stop, and seeking through Media3's controls.

The sender-hosted media URL is a bearer credential. Do not publish it or share it beyond the intended receiver.

## Development-only cleartext HTTP

`AndroidManifest.xml` currently enables cleartext traffic so the receiver can test the existing M1.5 sender media host (`http://<LAN-IP>:8766/...`). This is strictly for trusted-LAN development. Before production, replace this with authenticated HTTPS and a deliberate network security policy; do not expose the receiver to untrusted networks.

## M2.2 live UCP test (Android emulator)

The app starts a development WebSocket server at `ws://0.0.0.0:8765/ucp` while its Activity is running. For an Android emulator, forward the host's local port to the emulator:

```powershell
adb reverse tcp:8765 tcp:8765
```

Start the sender-side M1.5 media host in another terminal and keep its temporary media URL private. From the repository root, run:

```powershell
node tools/receiver-simulator/tests/android-receiver-live.mjs --media-url "http://<PC-LAN-IP>:8766/media/<temporary-token>/<file-id>"
```

The script performs the UCP 1.0 handshake, creates a session, loads the MP4 URL, plays, pauses, resumes, seeks and stops, while checking receiver snapshots and `state.changed` events. The emulator must be able to reach the PC media-host LAN address; that path was separately verified in M2.0.

For a physical Android TV on the same trusted LAN, use `ws://<TV-LAN-IP>:8765/ucp` instead of the emulator's `127.0.0.1` bridge. Do not expose port 8765 to the internet or untrusted networks.

## Next milestones

- **M2.1:** reusable playback adapter, UCP playback-state mapping and conservative capability reporting (implemented).
- **M2.2:** development UCP WebSocket control endpoint, handshake, single active session and playback command dispatch (implemented; validate with the live test script).
- **M2.3:** Android mDNS/DNS-SD receiver discovery (implementation added; verify on a physical same-LAN sender).
- **M2.4:** pairing, authenticated TLS control and hardened media-origin validation.
- **M2.5:** end-to-end casting from a UniversalCast sender.

## Architecture boundaries

Keep Android-native implementation in this project. The shared UCP specification remains authoritative for wire behavior. Do not copy the TypeScript simulator as a second source of truth; implement the same contract in Kotlin and add cross-platform conformance tests.

## M2.3 discovery notes

See [`docs/M2.3-ANDROID-MDNS-DISCOVERY.md`](../../docs/M2.3-ANDROID-MDNS-DISCOVERY.md) for the DNS-SD record contract, lifecycle behavior, validation, and security boundary.

## M2.4.1b TLS transport

See [`docs/M2.4.1B-TLS.md`](../../docs/M2.4.1B-TLS.md) for the debug WSS endpoint, certificate checks, and device-validation steps.

## References

- [Android TV app setup](https://developer.android.com/training/tv/get-started/create)
- [AndroidX Media3 release notes](https://developer.android.com/jetpack/androidx/releases/media3)
