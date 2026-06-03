import * as admin from 'firebase-admin';
admin.initializeApp();

export { onLocationUpdate } from './geofence';
export { onMemberWrite } from './members';
export { createGame, joinGameByCode, deleteGame } from './games';
export { cleanupRationPhotosOnGameEnd } from './cleanup';
export { runScheduledEvents } from './runsheet';
