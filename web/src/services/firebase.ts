import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// `ignoreUndefinedProperties` mirrors the mobile app (services/firebase.ts): it
// drops undefined fields instead of throwing on writes, so an absent optional
// field (e.g. fcmToken) never aborts a whole document write.
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

export const functions = getFunctions(app);

if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  // Web runs in the browser on the dev machine, so 'localhost' reaches the
  // emulators directly (no Android 10.0.2.2 indirection needed).
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
}

export const Collections = {
  USERS: 'users',
  GAMES: 'games',
  CHECKPOINTS: 'checkpoints',
  RUNBOOK: 'runbook',
  MEMBERS: 'members',
  LOCATIONS: 'locations',
  ARRIVALS: 'arrivals',
  BROADCASTS: 'broadcasts',
  RATIONS: 'rations',
  SCHEDULED_EVENTS: 'scheduledEvents',
  MARKERS: 'markers',
  ENTRY_TRIPS: 'entryTrips',
} as const;
