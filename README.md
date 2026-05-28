# 🎯 Outdoor GM

A real-time GPS location-sharing game for iOS and Android. Game Masters watch all players on a live map and get instant alerts when players reach checkpoints. Players share their location but can't see anyone else.

![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
![Expo](https://img.shields.io/badge/Expo-51-blue)
![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%7C%20Auth%20%7C%20FCM-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)

---

## How It Works

| Role | What they see | How they join |
|------|--------------|---------------|
| **Player** | Their own dot on a mini-map. Nothing else. | Enter the **Player Code** |
| **Game Master** | All players live on a map + checkpoint geofences. Push + SMS alerts on arrival. | Create a game or enter the **GM Code** |

When a player's GPS enters a checkpoint's radius, a Firebase Cloud Function fires — recording the arrival, sending a push notification to all GMs, and optionally sending an SMS via Twilio.

---

## Screenshots

| Auth | Player View | GM Map |
|------|------------|--------|
| *(phone OTP login)* | *(mini-map, tracking status)* | *(live map + alert feed)* |

---

## Tech Stack

- **React Native** via Expo (managed workflow + custom dev client)
- **Expo Router** — file-based navigation
- **Firebase Auth** — phone number / SMS OTP
- **Cloud Firestore** — real-time location and game data
- **Firebase Cloud Messaging** — push notifications to GMs
- **Firebase Cloud Functions** — geofence detection (Haversine formula), server-authoritative
- **expo-location + expo-task-manager** — background GPS on iOS and Android
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
2. Enable **Phone Auth**, **Firestore**, **Cloud Messaging**, and **Cloud Functions** (Blaze plan)
3. Add iOS + Android apps, download `GoogleService-Info.plist` and `google-services.json` to the project root
4. Update `.firebaserc` with your project ID

### 3. Add API keys
- Google Maps keys → `app.json` under `ios.config.googleMapsApiKey` and `android.config.googleMaps.apiKey`
- Copy `.env.example` → `.env` (not needed at runtime — Firebase uses native config files)

### 4. Deploy backend
```bash
firebase deploy --only firestore        # rules + indexes
firebase deploy --only functions        # geofence + notification logic
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

For full setup details see [SETUP.md](./SETUP.md).
