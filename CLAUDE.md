# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Outdoor GM** is a real-time GPS location-sharing game app for iOS and Android built with React Native + Expo. Game Masters watch all players on a live map and receive instant alerts when players reach checkpoints. Players share their location but see only themselves on a mini-map.

- **Platform**: React Native (Expo managed workflow with custom dev client)
- **Language**: TypeScript (strict mode)
- **Backend**: Firebase (Auth, Firestore, Cloud Functions, Cloud Messaging)
- **Maps**: Google Maps (via react-native-maps)
- **Location**: Background GPS tracking (expo-location + expo-task-manager)
- **Notifications**: Push (FCM) and SMS (Twilio, optional)

## Quick Commands

> **Starting the app:** see [RUNNING.md](RUNNING.md) for the full local-dev guide
> (env vars, the prebuilt dev client, prebuild + native run, and the Firebase
> emulators). The app uses native modules and **cannot run in Expo Go**.

```bash
# Install dependencies (includes functions/)
npm install
cd functions && npm install && cd ..

# Development (requires a custom dev client — see RUNNING.md)
npx expo start --dev-client   # Start Metro against an installed dev client (loads .env)
npm run android               # Build & run the native Android app locally
npm run ios                   # Build & run on the iOS simulator (macOS only)
npm run lint                  # Run ESLint

# Firebase & Cloud Functions
firebase deploy --only firestore        # Deploy Firestore rules & indexes
firebase deploy --only functions        # Deploy Cloud Functions

# EAS Build (build a custom dev client / release artifact in the cloud)
eas login
eas build --profile development --platform android   # or ios
```

## Architecture

### Routing & Navigation

Uses **Expo Router** (file-based) with group-based layout structure:

```
app/
├── _layout.tsx                # Root layout: AuthProvider + GameProvider + notifications setup
├── index.tsx                  # Auth routing: redirects to /(auth) or /(app)
├── (auth)/
│   ├── _layout.tsx           # Auth Stack layout
│   └── login.tsx             # Email/password auth
└── (app)/
    ├── _layout.tsx           # App Stack layout: FCM token setup
    ├── games.tsx             # List user's games (player or GM)
    ├── join.tsx              # Join game by code
    ├── profile.tsx           # User profile & settings
    ├── player/
    │   └── game.tsx          # Player view: mini-map of own location
    └── gm/
        ├── create.tsx        # Create game
        └── [gameId]/
            ├── index.tsx     # GM main map view
            ├── players.tsx   # List game members
            └── checkpoints.tsx # Manage checkpoints
```

**Key routing pattern**: On successful sign-in or account creation, `login.tsx` navigates directly to `/(app)/games` via `router.replace`. The root `index.tsx` serves as an initial gate on cold launch — it redirects based on `user` and `loading` state from `AuthContext`. The `(app)/_layout.tsx` guards against unauthenticated access by redirecting to `/(auth)/login` if the user is null.

**Important**: `getMyGames()` uses a `collectionGroup` query on the `userId` **field** (not `FieldPath.documentId()`) in the `members` subcollection. The `userId` field must be written to every member document and a collection-group-scoped index must exist for it (see `firestore.indexes.json`).

### State Management

Two React Context providers in root layout:

1. **AuthContext** (`context/AuthContext.tsx`)
   - Manages: `user` (Firebase Auth), `profile` (Firestore UserProfile doc), `loading`, `signOut`, `updateProfile`
   - Subscribes to `auth().onAuthStateChanged()` and ensures user profile document exists in Firestore
   - Used by: `useAuth()` hook (required in all authenticated screens)

2. **GameContext** (`context/GameContext.tsx`)
   - Manages: `game`, `myRole` ('player'|'gm'), `checkpoints`, `members`, `playerLocations`, `arrivals`, `loadGame()`, `clearGame()`
   - Subscribes to multiple Firestore collections when a game is loaded
   - Used by: `useGame()` hook (call `loadGame(gameId, role)` to switch games)
   - **Note**: GMs see `members` and `playerLocations`; players see neither

### Firebase Integration

**Collections** (defined in `services/firebase.ts`):

```
users/{userId}
  email, displayName, fcmToken, createdAt

games/{gameId}
  name, playerCode, gmCode, creatorId, status ('active'|'ended'),
  phase ('setup'|'lobby'|'play'|'results'), rules?, boundary? ({minLat,maxLat,minLng,maxLng}),
  startedAt?, endedAt?, createdAt

games/{gameId}/checkpoints/{checkpointId}
  name, latitude, longitude, radius (meters), order (optional)

games/{gameId}/members/{userId}
  userId, role ('player'|'gm'), displayName, email, fcmToken, out?, outAt?, archived?, joinedAt
  // `archived` is a per-member flag the user sets to hide a *finished* game from
  // their own "My Games" list; it does not affect other members' views.

games/{gameId}/locations/{userId}
  userId, displayName, latitude, longitude, accuracy, heading, updatedAt

games/{gameId}/arrivals/{arrivalId}
  playerId, playerName, checkpointId, checkpointName, timestamp, latitude, longitude
```

**Real-time subscriptions**: GameContext sets up Firestore listeners that auto-update state. To avoid stale data, call `loadGame(gameId, role)` when entering a game and `clearGame()` when leaving.

### Background Location & Geofencing

**Location tracking** (`services/locationTask.ts`):
- Uses Expo's `expo-task-manager` to define a background task (`hgl-background-location`) that runs even when app is backgrounded
- Task fires every 10 seconds or 20 meters of movement, uploads to `games/{gameId}/locations/{userId}`
- Started by player when they join a game; stopped when they leave
- Requires foreground + background location permissions (iOS: "Always"; Android: handled by app.json plugin)

**Geofence detection** (`functions/src/geofence.ts`):
- **Server-authoritative**: Cloud Function triggers on every location update and runs Haversine formula against all checkpoints
- On entry (distance < radius), creates an arrival record and triggers notifications
- Deduplication: prevents duplicate arrivals for the same player-checkpoint pair within a time window
- GMs only: non-players (GMs) don't trigger checkpoint arrivals even if their location is updated

### Game Phases

A game's lifecycle is driven by the `phase` field on the game doc, advanced by the GM:

1. **`setup`** — GM defines the play boundary (`gm/[gameId]/boundary.tsx`, a rectangle
   captured from the current map view), checkpoints, and free-text rules. The game is
   not yet open to players. GM action: **Open to Players** → `lobby`.
2. **`lobby`** — Players join with the player code, name themselves, and see a one-time
   swipeable tutorial (`components/Tutorial.tsx`, which also shows the GM's rules). Players
   wait on a "waiting for the GM" screen; location tracking does **not** start yet.
   GM action: **Start Game** (`startGame()` stamps `startedAt`) → `play`.
3. **`play`** — Tracking starts; players see a live timer (`hooks/useElapsed.ts`) of how
   long they've been playing and an **I'm Out** button (`markPlayerOut()` sets
   `member.out`/`outAt` and stops their tracking). GM sees the live map, alerts, and an
   elapsed timer. GM action: **End Game** (`endGame()` stamps `endedAt`, sets
   `status: 'ended'`) → `results`.
4. **`results`** — Players see how long they played (start → their `outAt` or the game's
   `endedAt`). GM sees per-player times.

Phase transition helpers live in `services/gameService.ts`
(`openLobby`, `reopenSetup`, `startGame`, `endGame`, `updateGameConfig`, `markPlayerOut`).
`gamePhase(game)` resolves the phase, defaulting legacy games (no `phase` field) to
`play` while active and `results` once ended, so older games keep working. `endGame()`
still sets `status: 'ended'`; the `joinGameByCode` Cloud Function only matches active
games, so a finished game can't be joined.

### Game Codes & Joining

- **Player Code** & **GM Code**: 6-character codes (no 0/O/1/I/L to avoid confusion),
  generated **server-side with a CSPRNG** by the `createGame` Cloud Function and checked
  for uniqueness against active games.
- **Codes are secret**: game docs (which hold the codes) are readable only by members —
  see `firestore.rules`. Clients can no longer query games by code.
- **Create flow**: `createGame(name, displayName, fcmToken?)` in `services/gameService.ts`
  calls the `createGame` callable, which writes the game doc + the creator's GM member doc
  atomically (the GM role is never self-assigned by a client).
- **Join flow**: `joinGameByCode(code, displayName, fcmToken?)` calls the `joinGameByCode`
  callable, which resolves the code → game + role server-side, takes `email` from the
  verified auth token, and writes the member doc. Players then wait in the lobby; location
  tracking starts only once the GM moves the game to the `play` phase (see Game Phases).
- **App Check**: `services/appCheck.ts` attests the app to the Firebase backend. Enforcement
  is off until registered in the console (see the `ENFORCE_APP_CHECK` flag in
  `functions/src/games.ts` and the SECURITY notes).

### Notifications

**Push (FCM)**:
- Android: Uses Firebase Cloud Messaging directly
- iOS: Requests permission via `messaging().requestPermission()`, then FCM
- FCM tokens saved to user profile and member records when joining a game
- Cloud Function sends push to all GM FCM tokens in `members` on checkpoint arrival

**SMS (Twilio, optional)**:
- Configured via Firebase Functions config: `twilio.sid`, `twilio.token`, `twilio.from`
- Triggered by same Cloud Function as push notifications
- If Twilio config is missing, app works without SMS (push only)

**Notification handlers**: Set up in `app/_layout.tsx` (Android channel) and `services/notificationService.ts` (foreground handling)

## File Organization

- `app/` — Expo Router screens and layouts
- `context/` — React Context providers (Auth, Game)
- `services/` — Firebase, location, notifications, game logic, error utilities
- `components/ui/` — Reusable UI (Button, Input)
- `types/` — TypeScript type definitions
- `constants/` — Colors, URLs
- `functions/src/` — Firebase Cloud Functions (geofence detection, notifications, SMS)
- `assets/` — Icons, splash images
- `plugins/` — Custom Expo plugins (e.g., Gradle version override for Android)
- `scripts/` — Build-time scripts (e.g., postinstall)
- `web/` — **Desktop web GM dashboard** (Vite + React + Firebase JS SDK + Mapbox GL).
  A standalone app for Game Masters that uses the *same* Firebase backend (project,
  Firestore schema, rules, Cloud Functions) as the mobile app. The data layer mirrors
  `services/` + `context/` but uses the Firebase JS SDK (the RN native modules don't
  run on web). Shares root `types/` via the `@shared` alias. GM-only — no GPS/push.
  See [web/README.md](web/README.md).

## Development Notes

### Testing Firebase Locally

Use Firebase Emulators (enabled via `EXPO_PUBLIC_USE_EMULATOR=true`):
```bash
firebase emulators:start --config firebase.emulator.json
npm start
```

Emulator config auto-connects auth and Firestore to localhost:9099 and localhost:8080 respectively.

### Custom Dev Client Required

Because of native modules (`@react-native-firebase`), the app **cannot run in Expo Go**. You must:
1. Build once with EAS: `eas build --profile development --platform ios` (or android)
2. Install the resulting `.ipa` or `.apk` on your device
3. Run `npm start` to connect to the dev server

### TypeScript Path Aliases

Configured in `tsconfig.json` and `babel.config.js`:
- `@/*` → root directory
- Use `import { X } from '@/services/firebase'` instead of relative paths

### Key Type Definitions

See `types/index.ts` for:
- `UserProfile`, `Game`, `Checkpoint`, `GameMember`, `PlayerLocation`, `Arrival`
- `UserRole` = 'player' | 'gm'
- `GameStatus` = 'active' | 'ended'

### Color Palette

Defined in `constants/colors.ts`. Use `Colors.primary` (#D4893F), `Colors.background` (#0D0D0D), etc. for consistency.

### Error Handling

Use `friendlyError()` from `services/errorUtils.ts` to convert Firebase error codes into user-facing messages.

## Deployment

### Prerequisites

1. Firebase project with Blaze plan (required for Cloud Functions)
2. Google Maps API keys (Android & iOS)
3. `.firebaserc` pointing to your Firebase project ID
4. Twilio credentials (optional, for SMS)

### Deployment Steps

```bash
# 1. Deploy Firestore rules & indexes
firebase deploy --only firestore

# 2. Deploy Cloud Functions
cd functions && npm run build && cd ..
firebase deploy --only functions

# 3. Build app (creates EAS-hosted artifact)
eas build --profile production --platform ios     # or android

# 4. Submit to app stores (optional)
eas submit --platform ios     # or android
```

See [RUNNING.md](RUNNING.md) for local-dev startup and [SETUP_ANDROID.md](SETUP_ANDROID.md) for one-time Android SDK/environment setup.

## Common Patterns

### Adding a New Screen

1. Create file in `app/(app)/newscreen.tsx` or `app/(auth)/newscreen.tsx`
2. Use `useAuth()` to access user/profile; use `useGame()` for game data
3. Import `Colors` for consistent styling
4. For navigation, use `useRouter()` from `expo-router`

### Adding a New Game Feature

1. Add data to Firestore schema (update `services/firebase.ts` Collections if needed)
2. Add Firestore listener in `GameContext` if GMs need to see it
3. Create service function in `services/gameService.ts`
4. Call from screens; state updates automatically via context

### Triggering Notifications

- Push: Cloud Function triggers on arrival (automatic)
- Custom push: Call `messaging().sendToTopic()` or similar in a Cloud Function
- Local (foreground): Use `Notifications.scheduleNotificationAsync()`

## Debugging

- **Firestore**: Check Firebase Console → Firestore → Data for real-time updates
- **Cloud Functions**: Check Firebase Console → Functions → Logs
- **Location**: Turn on GPS and open app; check `games/{gameId}/locations/{userId}` doc
- **Emulator**: Run `firebase emulators:start --config firebase.emulator.json` and set `EXPO_PUBLIC_USE_EMULATOR=true`
- **Crashlytics**: Disabled in dev (`__DEV__`), enabled in production (auto-reports uncaught errors)

## Key Dependencies

- `expo-router@~3.5`: File-based routing
- `@react-native-firebase/*@^20.3`: Firebase integration
- `react-native-maps@1.14`: Google Maps
- `expo-location@~17.0`: GPS
- `expo-task-manager@~11.8`: Background tasks
- `expo-notifications@~0.28`: Local & push notifications
- `react-native-safe-area-context@4.10`: Safe area handling
