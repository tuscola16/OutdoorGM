# 🎯 Outdoor GM

A real-time GPS survival game for iOS and Android. A Game Master runs a timed, last-one-alive
outdoor event from a live map of every player; players share their location, survive a ration
loop, and can reach the GM in an emergency — but never see each other.

![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
![Expo](https://img.shields.io/badge/Expo-51-blue)
![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%7C%20Auth%20%7C%20FCM%20%7C%20Storage-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

---

## How It Works

| Role | What they see | How they join |
|------|--------------|---------------|
| **Player** | Their own dot on a mini-map, a countdown, the ration loop, and a one-way feed from the GM. Never other players. | Enter the **Player Code** |
| **Game Master** | Every player live on a map + checkpoint geofences, an alert feed, a roster with elimination/SOS controls, and a ration-review feed. | Create a game or enter the **GM Code** |

A game runs through four GM-driven phases — **setup → lobby → play → results** — and the GM
is the only channel to players (there is no player-to-player chat by design). When a player's
GPS enters a checkpoint radius, a server-authoritative Cloud Function records the arrival,
optionally fires a GM-authored event, and pushes/SMSes the GMs.

---

## Features

### Accounts & games
- **Email/password auth** (Firebase Auth) with password reset; profile screen with display
  name and account deletion.
- **Create or join a game** with secret 6-character codes (separate **Player** and **GM**
  codes), generated server-side with a CSPRNG and checked for uniqueness. Codes are readable
  only by members — clients can't query games by code.
- **My Games** list across all games you're in (player or GM), with the ability to **archive**
  a finished game from your own list.

### Game lifecycle (phases)
- **Setup** — GM defines the play **boundary** (a rectangle captured from the map), adds
  **checkpoints** (name, location, radius), writes free-text **rules**, and tunes a structured
  **game config** in a settings modal.
- **Lobby** — players join with the player code, name themselves, and see a one-time swipeable
  **tutorial** (which shows the GM's rules). They wait on a lobby screen; tracking hasn't
  started yet.
- **Play** — background tracking starts; the survival loop runs (below).
- **Results** — per-player play times (start → their death/`outAt` or the game's end).

### Player experience (Play)
- **Background GPS tracking** (expo-location + expo-task-manager), ~10s / 20m cadence, with an
  **Android 14 foreground-service-location fallback**.
- **Mini-map** of the player's own position only.
- **Game clock** — a live "TIME LEFT" countdown of the configured duration plus elapsed time.
- **Ration loop** — a per-window countdown, **live camera-only** capture (no library picks,
  anti-cheat) of a numbered ration card, upload to Firebase Storage, optional card-number
  entry, and submission status.
- **"I've been killed"** honor-system self-report and a prominent **SOS / safety** button that
  alerts the GM with the player's live location.
- **Broadcast feed** — a read-only stream of GM announcements and targeted messages.

### Game Master experience
- **Live map** of all players + checkpoint geofences, with a **stats bar** (Time remaining /
  Alive / Active / Arrivals) and an **arrival alert feed**.
- **Roster** with per-player **eliminate** (skull), live **SOS** highlight + clear, dead/alive
  badges, and an **"N alive"** count.
- **District / tribute pairing** — the GM assigns each player a district (two tributes share
  one); the roster groups by district so the pairing is visible at a glance. GM-only — players
  can't reassign their own (it feeds the planned same-district trap-suppression rule).
- **Winner detection** — when one living player remains, the game surfaces a winner and moves
  to results (server-authoritative via the `onMemberWrite` function).
- **Death-drop pins** — a player's last position is stamped on death and shown as a skull
  marker on the GM map.
- **Ration review feed** — incoming photos per player per window with thumbnails + lightbox,
  **valid/reject**, a "who hasn't eaten this window" glance, and a reused-card-number flag when
  unique-card enforcement is on.
- **Checkpoint events & traps** — a crossing can fire a GM-authored event (hazard, boon,
  player-notify, or GM-only) routed by audience (the crossing player, all players, or GM-only),
  not just a plain alert. A checkpoint can also hold an **arrival-order trap queue** — the Nth
  tribute to arrive gets the Nth trap — with **same-district suppression**: if two tributes
  from the same district arrive together (within ~90 s), the trap is withheld and the GM is told
  why. Authored in the Play Area map editor ("same for everyone" vs. "by arrival order").
- **Timed site windows** — any checkpoint can be opened/closed so it only fires while live
  (Open now / Close now / Always live), shown as OPEN/CLOSED/SCHEDULED badges. Powers voucher
  turn-in sites and time-gated traps.
- **Run-sheet (timed actions)** — a GM-authored schedule of actions that fire automatically at
  set offsets from game start: announcements, the living-player count, opening/closing sites,
  gear-drop reveals, and GM-only reminders. A per-minute Cloud Function sweeps and fires them
  exactly once (the in-app replacement for last year's paper schedule).
- **Game settings** modal — duration, rations on/off + window length + unique-card
  enforcement, auto player-count, winner detection, and battery-saver tracking, all persisted
  to `game.config`.

### Reliability & safety
- **Battery-aware tracking** — a low-power mode uses balanced accuracy and a coarser
  15s / 30m cadence.
- **Stale-fix indicator** — per-player "last fix Xm ago" with a color dot in the roster, and a
  "N players not reporting" warning chip on the GM map that deep-links to the roster, so the GM
  can tell "stopped moving" from "stopped reporting."

### Notifications
- **Push (FCM)** to all GMs on checkpoint arrivals, SOS, and deaths.
- **SMS (Twilio, optional)** alongside push when configured; the app works push-only without
  it.

### Backend
- **Server-authoritative geofencing** — the `onLocationUpdate` Cloud Function runs the
  Haversine check against all checkpoints, writes arrivals (deduplicated), and triggers
  notifications. GMs don't trigger arrivals.
- **Storage** — ration photos live in member-scoped Firebase Storage paths
  (`storage.rules`); the `cleanupRationPhotosOnGameEnd` function deletes a game's photos when
  it ends, so a season of meal photos doesn't accumulate.

### Desktop web GM dashboard
- A standalone **GM-only web app** (`web/` — Vite + React + Firebase JS SDK + Mapbox GL) on the
  *same* Firebase backend, at parity with the mobile GM tools: live map, roster (with district
  assignment), checkpoint/trap editor with **timed-window controls**, the **run-sheet** authoring,
  broadcasts, config, and the ration-review modal. See [web/README.md](web/README.md).

---

## Tech Stack

- **React Native** via Expo (managed workflow + custom dev client)
- **Expo Router** — file-based navigation
- **Firebase Auth** — email/password (+ password reset)
- **Cloud Firestore** — real-time location and game data
- **Firebase Storage** — ration-card photo uploads
- **Firebase Cloud Messaging** — push notifications to GMs
- **Firebase Cloud Functions** — geofence detection (Haversine), elimination/winner/SOS
  routing, ration-photo cleanup — all server-authoritative
- **expo-location + expo-task-manager** — background GPS on iOS and Android
- **expo-image-picker** — live camera capture for ration photos
- **react-native-maps** — Google Maps with player markers and checkpoint circles
- **Twilio** — optional SMS alerts to GM phone numbers

---

## Quick Start

### 1. Clone & install
```bash
git clone <repo-url>
cd Outdoor GM
npm install
cd functions && npm install && cd ..
```

### 2. Firebase setup
1. Create a project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Email/Password Auth**, **Firestore**, **Storage**, **Cloud Messaging**, and
   **Cloud Functions** (Blaze plan)
3. Add iOS + Android apps, download `GoogleService-Info.plist` and `google-services.json` to the project root
4. Update `.firebaserc` with your project ID

### 3. Add API keys
- Google Maps keys → `app.json` under `ios.config.googleMapsApiKey` and `android.config.googleMaps.apiKey`
- Copy `.env.example` → `.env` (not needed at runtime — Firebase uses native config files)

### 4. Deploy backend
```bash
firebase deploy --only firestore        # rules + indexes
firebase deploy --only storage          # ration-photo access rules
firebase deploy --only functions        # geofence + notification + cleanup logic
```

### 5. Build the app
```bash
eas login
eas build --profile development --platform ios      # or android
# Install the resulting .ipa / .apk on your device, then:
npm start
```

> The app requires a **custom dev client** (EAS build) because `@react-native-firebase` uses native modules — it cannot run in Expo Go.

---

## Optional: SMS alerts via Twilio
```bash
firebase functions:config:set \
  twilio.sid="ACXXXXXXXX" \
  twilio.token="your_token" \
  twilio.from="+15551234567"
firebase deploy --only functions
```

---

## Local development with Firebase Emulators
```bash
firebase emulators:start --config firebase.emulator.json
# Then set EXPO_PUBLIC_USE_EMULATOR=true in .env
```

---

For the local-dev startup guide see [RUNNING.md](./RUNNING.md), full setup in
[SETUP.md](./SETUP.md), and one-time Android environment setup in
[SETUP_ANDROID.md](./SETUP_ANDROID.md). Planned (not-yet-built) work lives in
[ROADMAP.md](./ROADMAP.md).
