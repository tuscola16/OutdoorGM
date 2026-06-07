import { Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import messaging from '@react-native-firebase/messaging';
import { initAppCheck } from './appCheck';

// Attest this app to the Firebase backend as early as possible (fire-and-forget;
// initAppCheck never throws). Must happen before callable functions / Firestore
// requests so a token is attached once App Check enforcement is enabled.
initAppCheck();

// Drop `undefined` fields instead of throwing on writes. Without this, calling
// .set()/.update() with any undefined value (e.g. an absent fcmToken when FCM is
// unavailable) throws and aborts the whole write — which silently dropped member
// docs and made games disappear from "My Games". Must run before any other
// Firestore use (this module is the first to touch firestore()).
//
// `persistence: true` is the RN-Firebase default, set explicitly here for #4
// (offline / poor-signal resilience): location, ration-doc, and SOS writes are
// applied to the on-device cache immediately and the SDK flushes them to the
// server when connectivity returns — so a dead zone never silently drops a fix or
// a safety alert. The one write the SDK can't queue is the ration *photo* upload
// (Firebase Storage), which has its own durable retry in services/rationQueue.ts.
firestore().settings({ ignoreUndefinedProperties: true, persistence: true });

if (__DEV__ && process.env.EXPO_PUBLIC_USE_EMULATOR === 'true') {
  // The emulators run on the dev machine. How the app reaches that machine depends
  // on where the app runs:
  //   - iOS simulator  → shares the host network, so 'localhost' works
  //   - Android emulator → host loopback is exposed as 10.0.2.2 (NOT localhost,
  //     which would point at the emulated device itself)
  //   - Physical device → must use the dev machine's LAN IP; set
  //     EXPO_PUBLIC_EMULATOR_HOST=192.168.x.x when starting Metro
  const host =
    process.env.EXPO_PUBLIC_EMULATOR_HOST ||
    (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');
  auth().useEmulator(`http://${host}:9099`);
  firestore().useEmulator(host, 8080);
  functions().useEmulator(host, 5001);
}

export { auth, firestore, functions, messaging };

export const Collections = {
  USERS: 'users',
  GAMES: 'games',
  CHECKPOINTS: 'checkpoints',
  MEMBERS: 'members',
  LOCATIONS: 'locations',
  ARRIVALS: 'arrivals',
  BROADCASTS: 'broadcasts',
  RATIONS: 'rations',
  SCHEDULED_EVENTS: 'scheduledEvents',
  MARKERS: 'markers',
} as const;
