import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Server-authoritative ration submission (ROADMAP #68). Moving the submission behind a
// callable lets us enforce **unique ration card numbers** at write time — a rule the
// Firestore security rules can't express (they can't scan the collection for a duplicate).
// With `config.enforceUniqueRationCards` on, a card number already in use by *another*
// player (in a non-rejected submission) is rejected with `already-exists` so the dupe never
// lands; the GM "reused" flag stays as a backstop. The same player re-submitting the same
// card for the same window is idempotent (deterministic `${uid}_${interval}` doc id).

/** Resolve a game's phase, defaulting legacy games (no `phase`) to play/results by status. */
function resolvePhase(game: admin.firestore.DocumentData | undefined): string {
  if (!game) return 'setup';
  if (game.phase) return game.phase as string;
  return game.status === 'ended' ? 'results' : 'play';
}

export const submitRation = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = context.auth.uid;
  const gameId = String(data?.gameId ?? '').trim();
  const intervalIndex = Number(data?.intervalIndex);
  const photoUrl = String(data?.photoUrl ?? '').trim();
  const cardNumber = data?.cardNumber != null ? String(data.cardNumber).trim() : '';
  const displayName = String(data?.displayName ?? '').trim();

  if (!gameId || !Number.isInteger(intervalIndex) || intervalIndex < 0 || !photoUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'A game id, interval, and photo are required.');
  }

  const db = admin.firestore();
  const gameRef = db.collection('games').doc(gameId);

  // The caller must be a non-GM member of a game that's in play.
  const memberSnap = await gameRef.collection('members').doc(uid).get();
  if (!memberSnap.exists || memberSnap.data()?.role === 'gm') {
    throw new functions.https.HttpsError('permission-denied', 'Only a player in this game can submit a ration.');
  }
  const member = memberSnap.data() as admin.firestore.DocumentData;

  const gameSnap = await gameRef.get();
  if (!gameSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'That game no longer exists.');
  }
  const game = gameSnap.data() as admin.firestore.DocumentData;
  if (resolvePhase(game) !== 'play') {
    throw new functions.https.HttpsError('failed-precondition', 'The game is not in play.');
  }

  // Default true (matches BASE_GAME_CONFIG.enforceUniqueRationCards).
  const enforceUnique = game.config?.enforceUniqueRationCards ?? true;
  const playerName = (member.displayName as string) || displayName || 'Player';
  const rationsCol = gameRef.collection('rations');
  const rationRef = rationsCol.doc(`${uid}_${intervalIndex}`);

  await db.runTransaction(async (tx) => {
    // All reads before writes. Uniqueness check: any non-rejected submission for this game
    // with the same card number, by a *different* player, blocks the write (#68/Rule 6).
    if (enforceUnique && cardNumber) {
      const dupSnap = await tx.get(rationsCol.where('cardNumber', '==', cardNumber));
      const conflict = dupSnap.docs.some(
        (d) => d.data().playerId !== uid && d.data().status !== 'rejected'
      );
      if (conflict) {
        throw new functions.https.HttpsError(
          'already-exists',
          'That ration card number is already in use by another player. Use a different card.'
        );
      }
    }
    tx.set(rationRef, {
      playerId: uid,
      playerName,
      intervalIndex,
      photoUrl,
      cardNumber: cardNumber || null,
      status: 'pending',
      submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { ok: true };
});
