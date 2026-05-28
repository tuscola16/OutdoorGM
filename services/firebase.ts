// Firebase is initialized automatically by @react-native-firebase via google-services.json / GoogleService-Info.plist
// This file exports typed references for convenience
import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import messaging from '@react-native-firebase/messaging';

export { auth, firestore, messaging };

export const Collections = {
  USERS: 'users',
  GAMES: 'games',
  CHECKPOINTS: 'checkpoints',
  MEMBERS: 'members',
  LOCATIONS: 'locations',
  ARRIVALS: 'arrivals',
} as const;
