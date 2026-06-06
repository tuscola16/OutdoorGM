import * as admin from 'firebase-admin';
admin.initializeApp();

export { onLocationUpdate } from './geofence';
export { onMemberWrite } from './members';
export { createGame, joinGameByCode, deleteGame } from './games';
export { cleanupRationPhotosOnGameEnd } from './cleanup';
export { runScheduledEvents } from './runsheet';
export { rearmCheckpoint } from './rearm';
export { onGameStartProjectMarkers } from './markers';
export { sweepOrphanedGames } from './orphans';
