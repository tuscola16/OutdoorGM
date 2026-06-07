import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Re-arm a Test Event checkpoint so the GM can walk a fixed-order runbook entry's
 * arrival queue with a small group (fewer than one player per queued slot).
 *
 * The geofence (functions/src/geofence.ts) assigns the Nth queue slot to the Nth
 * *distinct* arriver, where N = the count of existing arrival docs for the checkpoint,
 * and dedups by `playerId`. So to advance the queue with a single re-walking player we
 * must NOT delete their arrival (that would shrink the count and re-fire the first
 * slot). Instead we rewrite the crossing player's arrival doc's `playerId` to a synthetic
 * "consumed" marker: the count keeps growing (the ordinal advances) while the real player
 * no longer matches the dedup check, so their next crossing fires the next queue slot.
 *
 * GM-only, and only on games flagged `isTest` — this is a testing affordance, never a
 * way to manipulate a real game's traps.
 */
export const rearmCheckpoint = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = context.auth.uid;
  const gameId = String(data?.gameId ?? '').trim();
  const playerId = String(data?.playerId ?? '').trim();
  const checkpointId = String(data?.checkpointId ?? '').trim();
  if (!gameId || !playerId || !checkpointId) {
    throw new functions.https.HttpsError('invalid-argument', 'gameId, playerId and checkpointId are required.');
  }

  const db = admin.firestore();
  const gameRef = db.collection('games').doc(gameId);
  const [gameSnap, memberSnap] = await Promise.all([
    gameRef.get(),
    gameRef.collection('members').doc(uid).get(),
  ]);

  if (!memberSnap.exists || memberSnap.data()?.role !== 'gm') {
    throw new functions.https.HttpsError('permission-denied', 'Only a Game Master can re-arm a checkpoint.');
  }
  if (gameSnap.data()?.isTest !== true) {
    throw new functions.https.HttpsError('failed-precondition', 'Re-arming is only allowed in a Test Event.');
  }

  const arrivalsCol = gameRef.collection('arrivals');
  const existing = await arrivalsCol.where('checkpointId', '==', checkpointId).get();
  const mine = existing.docs.filter((d) => d.data().playerId === playerId);
  if (mine.length === 0) {
    // Nothing to re-arm — the player hasn't arrived yet (or was already re-armed).
    return { rearmed: 0 };
  }

  // Rewrite each of this player's arrival docs to a consumed marker so the count
  // (the queue ordinal) is preserved but the player can cross again.
  const batch = db.batch();
  let n = existing.size - mine.length;
  for (const doc of mine) {
    batch.update(doc.ref, {
      playerId: `__consumed_${n}`,
      district: admin.firestore.FieldValue.delete(),
    });
    n += 1;
  }
  await batch.commit();

  return { rearmed: mine.length };
});
