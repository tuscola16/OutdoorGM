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
