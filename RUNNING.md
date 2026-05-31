# Running Outdoor GM (local dev)

The app uses native modules (`@react-native-firebase`, `react-native-maps`,
background location), so it **cannot run in Expo Go**. You run it against a
*custom dev client* — either the prebuilt `outdoor-gm.apk` in this repo or one
you build yourself.

## One-time checklist

These should already be in place — confirm before your first run:

- [ ] **Dependencies installed**: `npm install` (root) and `cd functions && npm install && cd ..`
- [ ] **`.env` exists** at the repo root (copy from `.env.example`, fill in real values).
      Expo auto-loads it; any `EXPO_PUBLIC_*` var is baked into the JS bundle at start.
- [ ] **Firebase native config present**: `google-services.json` (Android) and
      `GoogleService-Info.plist` (iOS) — both are committed and already wired up in `app.json`.
- [ ] **Android SDK + env vars** set up per [SETUP_ANDROID.md](SETUP_ANDROID.md)
      (`JAVA_HOME`, `ANDROID_HOME`, platform-tools on `PATH`).

> Maps API keys are configured directly in `app.json` (`ios.config.googleMapsApiKey`
> and `android.config.googleMaps.apiKey`) — not via `.env`.

## Fast path — use the prebuilt dev client (Android)

Best for day-to-day JS/TS work when native dependencies haven't changed.

```powershell
# 1. Install the dev client on a connected device / running emulator (once)
adb install -r outdoor-gm.apk

# 2. Start the Metro dev server (loads .env automatically)
npx expo start --dev-client
```

Then launch **Outdoor GM** on the device and it will connect to Metro and download
the JS bundle. Reload with `r` in the terminal; press `m` to toggle the dev menu.

If a connected device isn't picked up, confirm `adb devices` lists it and that
USB debugging is enabled.

## Full path — build & run the native app yourself

Use this the first time, after changing anything native (a new native dependency,
`app.json` plugins/permissions, or the Firebase config files).

```powershell
# Generate the native projects from app.json (regenerates android/ and ios/)
npx expo prebuild --clean

# Android — builds, installs, and starts Metro
npx expo run:android

# iOS (macOS only) — simulator or device
npx expo run:ios
```

`run:android` / `run:ios` start the dev server for you, so you don't also need
`expo start`. After the native build is installed once, you can switch back to the
fast path above for subsequent JS-only changes.

## Running against the Firebase emulators (optional)

To develop without touching the live Firebase project, set the emulator flag and
start the emulators in a separate terminal:

```powershell
# In .env
EXPO_PUBLIC_USE_EMULATOR=true
```

```powershell
firebase emulators:start --config firebase.emulator.json
npx expo start --dev-client -c   # -c clears the Metro cache so the new env value is picked up
```

Auth connects to `localhost:9099` and Firestore to `localhost:8080`
(see `services/firebase.ts`). Set the flag back to `false` to use the real backend.

## Troubleshooting

- **Env var change not taking effect** — `.env` is read when Metro starts and
  cached in the bundle. Restart with cache cleared: `npx expo start --dev-client -c`.
- **"No development build installed" / app won't connect** — the dev client APK
  isn't installed, or its native version is stale. Reinstall `outdoor-gm.apk`, or
  rebuild via the full path above.
- **Maps are blank** — verify the API keys in `app.json` are valid and the Maps SDK
  is enabled for this project in the Google Cloud console.
- **Auth/Firestore "app not configured"** — the `google-services.json` /
  `GoogleService-Info.plist` must match the Firebase project; re-run
  `npx expo prebuild --clean` after replacing them.
