# Meera — Android APK

A real, signed Android app around the Meera HUD. Built with Gradle on a machine
that has a JDK and the Android SDK — here, via GitHub Actions, because the
development box has neither.

```
Meera-AI-Assistant.apk   600 KB   com.meera.assistant   Android 7.0+
```

## Why a build workflow

The sandbox that produced this project has no `java`, no `gradle` and no
`ANDROID_HOME`, and its network is restricted to package registries — so a
local `assembleRelease` was impossible. GitHub's `ubuntu-latest` runners ship
with JDK 17 and the Android SDK, so
`.github/workflows/build-meera-apk.yml` does the compile and commits the result
back onto the branch at `meera-apk/ci-out/` (the sandbox cannot reach GitHub's
artifact CDN, hence the commit-back).

## Layout

```
meera-apk/
├── app/
│   ├── build.gradle                  # AGP 8.5.2, compileSdk 34, minSdk 24
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/meera/assistant/MainActivity.java
│       ├── res/mipmap-*/ic_launcher.png
│       └── assets/www/               # the HUD (synced, not hand-edited)
├── sync-assets.sh                    # copies ../meera-assistant → assets/www
├── ci-out/                           # build output committed by CI
└── build.gradle, settings.gradle, gradle.properties
```

## The shell

`MainActivity` is deliberately small and uses **only platform APIs** — no
AndroidX, no support libraries, so the APK is 600 KB and the build needs zero
third-party downloads.

| Piece | Role |
|---|---|
| `WebView` | full-screen HUD, `file:///android_asset/www/index.html` |
| `window.AndroidBridge` | `@JavascriptInterface` surface: `speak`, `stopSpeaking`, `listen`, `toast`, `vibrate`, `platform`, `sdkInt` |
| `TextToSpeech` | drives the bridge's `speak`; `UtteranceProgressListener` calls back into JS |
| `RecognizerIntent` | one-shot speech input, result returned via `evaluateJavascript` |
| `native-bridge.js` | shims `speechSynthesis` / `SpeechRecognition` onto the bridge |

Why the shim: Android WebView implements **neither** the Web Speech synthesis
API nor `webkitSpeechRecognition`. Rather than fork the HUD, `native-bridge.js`
defines them on top of `AndroidBridge`, so `meera.js` runs byte-for-byte
unchanged across browser and APK.

## Known limits

* **Wake word is disabled in the APK.** The platform recogniser is a one-shot
  system dialog, not a continuous stream, so a "Meera" listener would reopen
  the dialog in a loop. `native-bridge.js` refuses continuous mode with a toast
  and points at the mic button.
* **Engine switching is cosmetic on mobile.** Leon, JARVIS and Open Interpreter
  are desktop engines; they will always read `offline` here. Meera Core — the
  built-in rule-based router — is always ready.

## Rebuilding

Push any change under `meera-apk/app/**`, `meera-apk/*.gradle` or
`meera-apk/sync-assets.sh`, or run the workflow manually:

```bash
gh workflow run build-meera-apk.yml --ref arena/391502e4-dramaclaw
```

The signing key is generated inside the workflow (`keytool`) and never
committed, so each build is self-signed. To ship updates that install over an
existing copy, keep one keystore instead:

```bash
keytool -genkeypair -keystore app/meera-release.jks -alias meera \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass meera123 -keypass meera123 -dname "CN=Meera, O=Personal, C=NP"
```

## Signatures

The APK carries an **APK Signature Scheme v2/v3** block, which is what Android
7.0+ validates. There is deliberately no v1 (JAR) signature — minSdk is 24, and
v2 covers every supported device.
