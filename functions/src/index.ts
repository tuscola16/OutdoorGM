import * as admin from 'firebase-admin';
admin.initializeApp();

export { onLocationUpdate } from './geofence';
export { onMemberWrite } from './members';
export { createGame, cloneGame, joinGameByCode, deleteGame } from './games';
export { onBroadcastCreate } from './broadcasts';
export { cleanupRationPhotosOnGameEnd } from './cleanup';
export { runScheduledEvents } from './runsheet';
export { fireRunbookEntry } from './runbook';
export { rearmCheckpoint } from './rearm';
export { onGameStartProjectMarkers } from './markers';
export { sweepOrphanedGames } from './orphans';
