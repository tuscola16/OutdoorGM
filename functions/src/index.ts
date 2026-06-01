import * as admin from 'firebase-admin';
admin.initializeApp();

export { onLocationUpdate } from './geofence';
export { createGame, joinGameByCode } from './games';
