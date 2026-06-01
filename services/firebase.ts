import { Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';

// Drop `undefined` fields instead of throwing on writes. Without this, calling
// .set()/.update() with any undefined value (e.g. an absent fcmToken when FCM is
// unavailable) throws and aborts the whole write — which silently dropped member
// docs and made games disappear from "My Games". Must run before any other
// Firestore use (this module is the first to touch firestore()).
firestore().settings({ ignoreUndefinedProperties: true });

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
}

export { auth, firestore, messaging };

export const Collections = {
  USERS: 'users',
  GAMES: 'games',
  CHECKPOINTS: 'checkpoints',
  MEMBERS: 'members',
  LOCATIONS: 'locations',
  ARRIVALS: 'arrivals',
} as const;
