# HungerGamesLocator — Tasks for Claude Desktop

This project is a React Native Expo app (iOS + Android) for a real-time location-sharing game.
Read `SETUP.md` for full context. The codebase is in this repo. Work on branch `claude/location-sharing-game-app-93jfu`.

All source files use TypeScript. The UI theme is dark (`Colors.background = '#0D0D0D'`).
Import alias `@/` maps to the project root.

---

## 1. Fix: Add missing `babel-plugin-module-resolver` dev dependency

`babel.config.js` uses `module-resolver` for the `@/` alias but it's not listed in `package.json`.

In `package.json` devDependencies, add:
```
"babel-plugin-module-resolver": "^5.0.0"
```

---

## 2. Add `metro.config.js`

Create `/metro.config.js` so Metro can resolve the `@react-native-firebase` packages correctly:

```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
module.exports = config;
```

---

## 3. Create placeholder image assets

Expo requires these files to exist (even as 1×1 pixel PNGs) for the build to succeed.
Create them in `/assets/` using any method:
- `icon.png` (1024×1024)
- `splash.png` (1284×2778)
- `adaptive-icon.png` (1024×1024)
- `favicon.png` (48×48)
- `notification-icon.png` (96×96, white-on-transparent)

If you can generate simple PNG files programmatically, do so. Otherwise create a script
`scripts/generate-placeholder-assets.js` that uses the `sharp` or `canvas` npm package to
produce solid-color placeholder PNGs, and document how to run it.

---

## 4. Add Google Maps API key to `app.json`

The `GameMap` and player map screens use `react-native-maps` with `PROVIDER_GOOGLE`.
Add placeholder keys to `app.json` under:

```json
"ios": {
  "config": {
    "googleMapsApiKey": "YOUR_GOOGLE_MAPS_IOS_API_KEY"
  }
},
"android": {
  "config": {
    "googleMaps": {
      "apiKey": "YOUR_GOOGLE_MAPS_ANDROID_API_KEY"
    }
  }
}
```

---

## 5. Add Profile screen — let user set their display name

New file: `app/(app)/profile.tsx`

The screen should:
- Show the user's current phone number (read-only)
- Let them edit their display name (saved to Firestore `users/{uid}.displayName` via `updateProfile` from `AuthContext`)
- Have a back button
- Be reachable from the games list screen header (add a person icon next to the sign-out icon in `app/(app)/games.tsx`)

---

## 6. Add GM Player Management screen

New file: `app/(app)/gm/[gameId]/players.tsx`

The screen should:
- List all members of the game (from Firestore `games/{gameId}/members`)
- Show each member's name, role badge (PLAYER / GM), and phone number
- Let the GM promote a player to GM or demote a GM to player (update `role` field in their member doc)
- Let the GM remove a player (delete their member doc and their location doc)
- Be reachable from the GM game screen header (add a people icon button)

Also add the `removePlayer` and `updateMemberRole` functions to `services/gameService.ts`.

---

## 7. Add "Copy to clipboard" for game codes

In `app/(app)/gm/[gameId]/index.tsx`, the codes modal shows `playerCode` and `gmCode`.

- Import `* as Clipboard from 'expo-clipboard'` (add `expo-clipboard` to `package.json` dependencies)
- Add a copy icon button next to each code value
- Show a brief "Copied!" toast using a simple `useState` + `setTimeout` approach (no external toast library)
- Add `expo-clipboard` to the `plugins` array in `app.json` if required

---

## 8. Add haptic feedback on new arrival alerts

In `app/(app)/gm/[gameId]/index.tsx`, the `arrivals` array comes from `GameContext`.
When `arrivals.length` increases (new arrival detected in the `useEffect` that tracks unseen alerts),
trigger a haptic impact:

```ts
import * as Haptics from 'expo-haptics';
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
```

`expo-haptics` is already in `package.json`.

---

## 9. Add Android notification channel setup

FCM on Android requires a notification channel to be registered before notifications can display.
In `app/_layout.tsx`, after the component mounts, add:

```ts
import * as Notifications from 'expo-notifications';

await Notifications.setNotificationChannelAsync('arrivals', {
  name: 'Checkpoint Arrivals',
  importance: Notifications.AndroidImportance.MAX,
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#E8402A',
  sound: 'default',
});
```

Only call this on Android (`Platform.OS === 'android'`).

---

## 10. Add Firebase emulator support for local development

Create `firebase.emulator.json` at the project root:

```json
{
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true, "port": 4000 }
  }
}
```

In `services/firebase.ts`, add a dev-mode block that connects to the emulators when
`__DEV__` is true and a `USE_EMULATOR=true` env var is set:

```ts
if (__DEV__ && process.env.EXPO_PUBLIC_USE_EMULATOR === 'true') {
  auth().useEmulator('http://localhost:9099');
  firestore().useEmulator('localhost', 8080);
}
```

Add `EXPO_PUBLIC_USE_EMULATOR=false` to `.env.example`.

---

## 11. Fix `getMyGames` — add Firestore collectionGroup index

The `getMyGames` function in `services/gameService.ts` queries `collectionGroup('members')`
filtered by document ID. This requires a single-field exemption in Firestore, not a composite index.

Update `firestore.indexes.json` to add a collectionGroup exemption for `members` on `__name__`:

```json
"fieldOverrides": [
  {
    "collectionGroup": "members",
    "fieldPath": "__name__",
    "indexes": [
      { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
    ]
  }
]
```

---

## 12. Add "Game ended" handling in the Player screen

In `app/(app)/player/game.tsx`, subscribe to the game document via Firestore.
If `game.status` becomes `'ended'`, automatically:
1. Stop location tracking (`stopLocationTracking()`)
2. Show an Alert: "The game has ended. Thanks for playing!"
3. Navigate to `/(app)/games` after the user dismisses it

---

## 13. TypeScript: audit and fix any type errors

Run a type-check pass across the whole project:
```bash
npx tsc --noEmit
```

Fix all reported errors. Common issues to watch for:
- `firestore.FieldValue.serverTimestamp()` typed as `any` — cast properly using `FirebaseFirestoreTypes.FieldValue`
- Missing `null` checks on `useLocalSearchParams` results
- `react-native-maps` `Region` type import

---

## 14. Write a `README.md` at the project root

Replace / supplement `SETUP.md` with a polished `README.md` that includes:
- App name + one-liner description
- Screenshot placeholder section (3 screens: phone auth, player view, GM map)
- Tech stack badges (Expo, Firebase, TypeScript, React Native)
- Quick-start section (5 steps: clone → Firebase setup → `npm install` → EAS build → deploy functions)
- Links to `SETUP.md` for detailed config

Keep it concise — under 120 lines.

---

---

# App Store Submission Checklist

Everything required to submit to the Apple App Store and Google Play Store.
Items marked **[CODE]** can be done by Claude. Items marked **[MANUAL]** require human action (accounts, payments, legal).

---

## A. Trademark & App Name  ⚠️ Do this first

**[MANUAL]** "Hunger Games" is a registered trademark of Lionsgate Entertainment Corp.
Using it in an app name will likely cause App Store rejection or a cease-and-desist.
Rename the app before submission. Options:
- "Arena Tracker" / "The Arena" / "HunterTracker" / "GameMaster Live"
- Anything that doesn't reference the IP

**[CODE]** Once a new name is decided:
- Update `"name"` in `app.json` (currently "HunterGamesLocator" — note it's already misspelled)
- Update `"slug"` in `app.json` (affects EAS project URL)
- Update `package.json` `"name"` field
- Update the app scheme (`"scheme"`) in `app.json`
- Do a global find/replace across all files for display-facing strings

---

## B. Developer Accounts  **[MANUAL]**

| Account | Cost | Link |
|---------|------|------|
| Apple Developer Program | $99/year | [developer.apple.com/enroll](https://developer.apple.com/enroll) |
| Google Play Developer | $25 one-time | [play.google.com/console](https://play.google.com/console) |
| Expo EAS account | Free tier available | [expo.dev](https://expo.dev) — run `eas login` |

---

## C. Real Credentials & Keys  **[MANUAL]**

All of the following need to be obtained and placed in the project before building for release.

### Firebase
- [ ] Create a production Firebase project (separate from any dev project)
- [ ] Download `GoogleService-Info.plist` (iOS) → place in project root
- [ ] Download `google-services.json` (Android) → place in project root
- [ ] Enable **Phone Authentication** in Firebase Console → Authentication → Sign-in method
- [ ] Add SHA-1 and SHA-256 fingerprints of your Android release keystore to the Firebase Android app (Firebase Console → Project Settings → Your apps → Android app → Add fingerprint). EAS manages the keystore — run `eas credentials` to get the fingerprints.
- [ ] Upload an **APNs Auth Key** (.p8 file) to Firebase Console → Project Settings → Cloud Messaging → iOS app configuration. Required for FCM push notifications on iOS. Get it from Apple Developer → Certificates, Identifiers & Profiles → Keys.

### Google Maps
- [ ] Create an API key in Google Cloud Console → APIs & Services → Credentials
- [ ] Enable **Maps SDK for iOS** and **Maps SDK for Android** on that key
- [ ] Restrict the iOS key to: Maps SDK for iOS + your iOS bundle ID
- [ ] Restrict the Android key to: Maps SDK for Android + your Android package name + your release SHA-1
- [ ] Replace `YOUR_GOOGLE_MAPS_IOS_API_KEY` and `YOUR_GOOGLE_MAPS_ANDROID_API_KEY` in `app.json`

### Twilio (SMS alerts)
- [ ] Sign up at twilio.com, purchase a phone number
- [ ] For US SMS: complete **A2P 10DLC registration** (required by US carriers for app-to-person messaging — takes 1–2 weeks and costs ~$20/month for the campaign). Without this, SMS will be filtered as spam.
- [ ] Set Firebase Functions config (see SETUP.md)

---

## D. Legal Documents  **[MANUAL — must be publicly hosted URLs]**

Both stores require a Privacy Policy URL before review. Host these on a real domain (GitHub Pages, Notion, your own site — anything with a stable HTTPS URL).

### Privacy Policy must cover:
- **Data collected**: precise GPS location (continuous, background), phone number, display name, device push token
- **Why**: game functionality — location shared with GM in real time; phone number used for authentication only
- **Third parties**: Google Firebase (auth, database, push notifications), Google Maps (map rendering), Twilio (SMS delivery)
- **Retention**: location data retained while game is active; users can delete account to purge all data
- **User rights**: how to request data deletion (required for GDPR/CCPA)
- **Children**: app is not directed at children under 13 (COPPA)
- **Contact**: your email address for privacy inquiries

### Terms of Service must cover:
- Acceptable use (no stalking, no use without consent of all parties)
- Disclaimer that location accuracy depends on device GPS
- Your liability limitations

**[CODE]** Once you have the hosted URLs, add them to the app:
- Add a "Privacy Policy" link on the phone auth screen (`app/(auth)/phone.tsx`) and the profile screen
- Update `app.json` with the URLs under `expo.ios.privacyManifest` and any relevant metadata fields

---

## E. Apple App Store — Specific Requirements  **[MANUAL unless noted]**

### App Store Connect setup
- [ ] Create the app record in App Store Connect (appstoreconnect.apple.com)
- [ ] Set the bundle ID to match `app.json` → `expo.ios.bundleIdentifier`
- [ ] Register the bundle ID in the Apple Developer portal (Certificates, Identifiers & Profiles → Identifiers) with **Push Notifications** capability enabled

### Store listing content
- [ ] **App name** (30 chars max) — must match the trademark-safe name chosen in Section A
- [ ] **Subtitle** (30 chars max) — e.g. "Real-time game location tracker"
- [ ] **Description** (4000 chars max)
- [ ] **Keywords** (100 chars, comma-separated) — used for search ranking
- [ ] **Support URL** — a working URL where users can get help
- [ ] **Privacy Policy URL** — from Section D
- [ ] **Screenshots** — required sizes:
  - 6.7" (iPhone 15 Pro Max): 1290×2796 px — minimum 3, up to 10
  - 6.5" (iPhone 11 Pro Max): 1242×2688 px
  - 5.5" (iPhone 8 Plus): 1242×2208 px
  - iPad Pro 12.9" (if tablet support added): 2048×2732 px

### App Review considerations
- [ ] **Background location justification**: In the App Review Notes field, explain clearly: *"This app is a real-time location game. Players must share their location continuously in the background so that Game Masters can see their position and receive alerts when they reach checkpoints. Without background location the core game mechanic does not function."* Apple rejects apps that use "always on" location without a compelling reason.
- [ ] **Test account for reviewers**: Apple reviewers need to test the app. Create a pre-configured demo account — add its phone number to Firebase Auth → Phone → Test phone numbers so it receives a fixed OTP without a real SMS.
  - Test player phone: e.g. `+1 650-555-1234`, OTP: `123456`
  - Provide a pre-joined game code in the Review Notes so reviewers can see the GM and player flows
- [ ] **Export compliance**: The app uses standard HTTPS/TLS (Firebase SDK). Select "Yes, it qualifies for exemption" under Encryption — uses only standard encryption.
- [ ] **Age rating**: Complete the questionnaire. Set minimum age to 17+ (simulated competition, location tracking of others) to be safe and avoid COPPA.

### EAS build & submit
**[CODE]** Update `eas.json` to add a proper production profile:
```json
"production": {
  "autoIncrement": true,
  "ios": { "image": "latest" },
  "android": { "buildType": "apk" }
}
```

**[MANUAL]**
```bash
eas build --platform ios --profile production
eas submit --platform ios
```

---

## F. Google Play Store — Specific Requirements  **[MANUAL unless noted]**

### Play Console setup
- [ ] Create the app in Google Play Console
- [ ] Set the package name to match `app.json` → `expo.android.package`

### Store listing content
- [ ] **App name** (30 chars max)
- [ ] **Short description** (80 chars)
- [ ] **Full description** (4000 chars)
- [ ] **Screenshots**: at least 2 phone screenshots (minimum 320px, maximum 3840px on any side)
- [ ] **Feature graphic**: 1024×500 px (shown at top of store listing)
- [ ] **App icon**: 512×512 px (separate from the one in `app.json`)
- [ ] **Privacy Policy URL** — from Section D

### Data Safety form (Play Console → Policy → App content → Data safety)
This is mandatory. Declare all data the app collects and why:

| Data type | Collected | Shared | Purpose |
|-----------|-----------|--------|---------|
| Precise location | Yes — continuously in background | Yes — with other users (GMs) in the same game session | App functionality |
| Phone number | Yes | No | Authentication |
| Name | Yes (display name) | Yes — with GMs | App functionality |
| Device/app IDs (FCM token) | Yes | No (sent to Firebase only) | Push notifications |

- [ ] Confirm data is encrypted in transit (Firebase uses TLS — yes)
- [ ] Confirm users can request data deletion (add account deletion flow — see Section G)

### Background location declaration
Google Play requires a separate declaration for apps using background location:
- [ ] In Play Console → Policy → App content → Background location access permission
- [ ] Submit a short video demonstrating the background location use case
- [ ] Written justification: same wording as Apple review notes above

### Content rating
- [ ] Complete the IARC questionnaire in Play Console → Policy → App content → Content rating
- [ ] Expected result: Everyone / Teen (no violence, no mature content — just location sharing)

### EAS build & submit
**[MANUAL]**
```bash
eas build --platform android --profile production
eas submit --platform android
```

---

## G. Code Changes Required Before Submission  **[CODE]**

These are changes to the codebase that both stores effectively require.

### G1. Account deletion / data erasure
Both Apple (required since 2023) and Google Play require that apps with accounts provide a way to delete the account and all associated data.

Add a "Delete Account" button to `app/(app)/profile.tsx` that:
1. Shows a confirmation alert
2. Calls a new `deleteAccount(userId)` function in `services/gameService.ts` that:
   - Deletes `users/{userId}` from Firestore
   - Deletes all `games/*/members/{userId}` documents (collectionGroup delete)
   - Deletes all `games/*/locations/{userId}` documents
   - Calls `auth().currentUser.delete()`
3. Navigates to `/(auth)/phone` on completion

Also create a publicly-accessible data deletion request URL (can be a simple Google Form) and add it to both store listings.

### G2. Privacy Policy link in-app
Add a "Privacy Policy" `TouchableOpacity` link at the bottom of `app/(auth)/phone.tsx` that opens the hosted URL using `Linking.openURL(PRIVACY_POLICY_URL)`. Store the URL in `constants/index.ts`.

### G3. Graceful permission-denied handling
Currently if the user denies location permission, the player screen shows a generic error string. Improve it:
- Detect `Location.PermissionStatus.DENIED` specifically
- Show a message: *"Location access is required to play. Please enable it in Settings."*
- Add a button that calls `Linking.openSettings()` to take the user directly to the iOS/Android settings page for the app

### G4. Graceful network error handling
Wrap all Firestore calls in `gameService.ts` in try/catch that distinguishes network errors (no connection) from permission errors. Surface a "No internet connection" message in the UI instead of a silent failure.

### G5. Real artwork
Replace the placeholder PNGs in `/assets/` with real designed assets:
- `icon.png` — 1024×1024, no alpha channel (Apple rejects icons with transparency), no rounded corners (the OS applies them)
- `splash.png` — centered logo on `#0D0D0D` background, safe zone: keep main content within the center 1080×1920 area
- `adaptive-icon.png` — foreground layer only (will be composited over `backgroundColor: "#0D0D0D"`)
- `notification-icon.png` — white silhouette on transparent background (Android requirement)

### G6. Firebase Crashlytics
Add crash reporting before shipping so you can diagnose issues post-launch:
```bash
# Add to package.json dependencies
"@react-native-firebase/crashlytics": "^20.3.0"
```
In `app/_layout.tsx`, import and initialize Crashlytics. It works automatically after that.
Enable Crashlytics in Firebase Console → Release & Monitor → Crashlytics.

### G7. Update `EXPO_PUBLIC_USE_EMULATOR` in `.env.example`
Add the missing line:
```
EXPO_PUBLIC_USE_EMULATOR=false
```

---

## H. Pre-Submission Testing Checklist  **[MANUAL]**

Run through all of these on a real physical device (not simulator) before submitting.

### Functional
- [ ] Phone auth: enter real number, receive SMS, verify OTP
- [ ] Create a game → both codes displayed correctly
- [ ] Join as player on a second device → appears on GM map within 30 seconds
- [ ] Walk to a checkpoint location → GM receives push notification within 30 seconds
- [ ] GM receives SMS alert (if Twilio configured)
- [ ] GM ends game → player screen shows "Game Over" and redirects
- [ ] Player leaves game → tracking stops, foreground service notification disappears
- [ ] Promote/demote player in Players screen → role badge updates in real time
- [ ] Remove player → they disappear from GM map
- [ ] Copy game code buttons → paste correctly in Messages
- [ ] Delete account → all data removed, user signed out

### Edge cases
- [ ] App killed by OS while player is tracking → location task resumes on relaunch
- [ ] Phone in airplane mode → app doesn't crash, shows appropriate error
- [ ] Location permission denied → app shows settings prompt (after G3 fix above)
- [ ] Notification permission denied → push silently not sent, no crash
- [ ] Two players reach same checkpoint simultaneously → both arrivals recorded, two notifications sent
- [ ] Player rejoins after being removed → joins cleanly as new member

### Platform-specific
- [ ] iOS: background location indicator (blue bar / arrow) appears while tracking
- [ ] iOS: app functions correctly after being backgrounded for 5+ minutes
- [ ] Android: foreground service notification appears in notification shade while tracking
- [ ] Android: app functions correctly after device restart mid-game (background task resumes)
- [ ] Test on iOS 16 and iOS 17
- [ ] Test on Android 12 and Android 14 (background location behavior differs)

---

## I. Production Firebase Configuration  **[MANUAL]**

Before the first real user touches the app, do these in the Firebase Console:

- [ ] Set Firestore to **production mode** (not test mode) — rules are already written, just ensure they're deployed: `firebase deploy --only firestore:rules`
- [ ] Set a **Firestore budget alert** in Google Cloud Console to avoid surprise bills from runaway location writes
- [ ] Enable **Firebase App Check** to prevent unauthorized API access (Console → App Check → Register your app with DeviceCheck on iOS and Play Integrity on Android)
- [ ] Review **Firebase Auth authorized domains** — remove `localhost` for production
- [ ] Set **Cloud Functions minimum instances** to 0 (default) to avoid cold-start billing; the geofence latency of a few extra seconds on first trigger is acceptable
- [ ] Enable **Firebase Performance Monitoring** (optional but useful for tracking location update latency)
