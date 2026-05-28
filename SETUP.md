# HungerGamesLocator — Setup Guide

A real-time location-sharing game app for iOS and Android.

## How It Works

| Role | What they see | How they join |
|------|--------------|---------------|
| **Player** | Their own location on a mini-map. Cannot see other players or checkpoints. | Enter the **Player Code** from their GM |
| **Game Master (GM)** | All players on a live map + all checkpoint locations. Gets push & SMS alerts when a player reaches a checkpoint. | Create a game (becomes GM) or enter the **GM Code** |

---

## Prerequisites

1. **Node.js** 20+ and npm
2. **Expo CLI**: `npm install -g expo-cli eas-cli`
3. **Firebase CLI**: `npm install -g firebase-tools`
4. A **Firebase project** (free Spark plan is fine for testing; Blaze plan required for Cloud Functions + SMS)
5. A **Twilio account** for SMS alerts (optional — push notifications work without it)
6. **Google Maps API key** (for react-native-maps on Android)

---

## Step 1 — Firebase Project Setup

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com) and create a new project.

2. Enable the following services:
   - **Authentication → Phone** (enable Phone sign-in method)
   - **Firestore Database** (start in production mode)
   - **Cloud Messaging** (enabled by default)
   - **Cloud Functions** (requires Blaze billing plan)

3. Add two apps to your Firebase project:
   - **iOS app** — bundle ID: `com.yourorg.hungergameslocator`
   - **Android app** — package name: `com.yourorg.hungergameslocator`

4. Download the config files:
   - `GoogleService-Info.plist` → place in `/` (project root)
   - `google-services.json` → place in `/` (project root)

5. Update `.firebaserc`:
   ```json
   { "projects": { "default": "YOUR_ACTUAL_PROJECT_ID" } }
   ```

---

## Step 2 — Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Create an API key, restrict it to **Maps SDK for Android** and **Maps SDK for iOS**.
3. Add to `app.json` under `expo.android.config.googleMaps.apiKey` and `expo.ios.config.googleMapsApiKey`.

---

## Step 3 — App Installation

```bash
cd HungerGamesLocator
npm install
```

---

## Step 4 — Build the App (Custom Dev Client Required)

Because this app uses `@react-native-firebase` (native modules), it **cannot run in Expo Go**. You must build a custom dev client:

```bash
# Log in to EAS
eas login

# Build for your device (first time takes ~10 minutes in the cloud)
eas build --profile development --platform ios     # or android
```

Then install the resulting `.ipa` / `.apk` on your device and launch it.

For local development:
```bash
npm start
# Press 'i' for iOS simulator, 'a' for Android emulator
# (after installing the custom dev client on the simulator)
```

---

## Step 5 — Deploy Firestore Rules & Indexes

```bash
firebase login
firebase deploy --only firestore
```

---

## Step 6 — Deploy Cloud Functions

```bash
cd functions
npm install
npm run build
cd ..
firebase deploy --only functions
```

---

## Step 7 — Configure Twilio SMS (Optional)

If you want SMS alerts when players reach checkpoints:

1. Sign up at [twilio.com](https://twilio.com) and get a phone number.
2. Set the config on your Firebase Functions:

```bash
firebase functions:config:set \
  twilio.sid="ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" \
  twilio.token="your_auth_token" \
  twilio.from="+15551234567"
```

3. Redeploy functions: `firebase deploy --only functions`

> Without Twilio config, the app still works — GMs receive push notifications only.

---

## Firestore Data Model

```
users/{userId}
  phoneNumber, displayName, fcmToken, createdAt

games/{gameId}
  name, playerCode, gmCode, creatorId, status, createdAt

games/{gameId}/checkpoints/{checkpointId}
  name, latitude, longitude, radius (meters)

games/{gameId}/members/{userId}
  role (player|gm), displayName, phoneNumber, fcmToken, joinedAt

games/{gameId}/locations/{userId}          ← players write here every ~10s
  userId, displayName, latitude, longitude, accuracy, heading, updatedAt

games/{gameId}/arrivals/{arrivalId}        ← Cloud Function writes on checkpoint entry
  playerId, playerName, checkpointId, checkpointName, timestamp, latitude, longitude
```

---

## How a Game Works

1. **GM creates a game** → gets a 6-char Player Code and GM Code.
2. **GM adds checkpoints** on the map (long-press to place, set name + detection radius).
3. **Players join** by entering the Player Code + their name.
4. **Players' phones** continuously upload GPS coordinates to Firestore (background task, every 10s or 20m movement).
5. **Cloud Function** checks every location update against all checkpoints.
6. On **geofence entry**, the function:
   - Creates an arrival record in Firestore (deduplicated — one per player per checkpoint)
   - Sends **push notifications** to all GMs
   - Sends **SMS** to all GMs (if Twilio configured)
7. **GMs** see arrivals in real-time on the Alerts tab and as push notifications.
8. GM ends the game when done.

---

## Development Notes

- Background location on iOS requires the app to be built with `UIBackgroundModes: ["location"]` (already configured in `app.json`).
- On Android, the foreground service notification is shown while tracking is active.
- The Cloud Function geofence check is the authoritative source of truth — client-side geofencing is not used to prevent spoofing.
- FCM tokens are saved to the `members` subcollection when players join, and refreshed in the app layout on each session.
