import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { randomInt } from 'crypto';

// Code alphabet excludes 0/O/1/I/L to avoid confusion when read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// Flip to `true` only AFTER App Check is registered for both platforms in the
// Firebase console and verified working on real builds — otherwise every call
// from a legitimate client is rejected. See SECURITY notes.
const ENFORCE_APP_CHECK = false;

/** Cryptographically-secure random join code. */
function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

/** Strip control characters, trim, and cap length so user-supplied names can't
 *  smuggle newlines/control chars into push/SMS bodies or the UI. Implemented by
 *  char-code filtering (no control-char regex literal in source). */
function cleanName(input: unknown): string {
  let out = '';
  for (const ch of String(input ?? '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // drop C0 controls + DEL
    out += ch;
  }
  return out.trim().slice(0, 32);
}

function requireAuth(context: functions.https.CallableContext): string {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  if (ENFORCE_APP_CHECK && !context.app) {
    throw new functions.https.HttpsError('failed-precondition', 'App Check verification failed.');
  }
  return context.auth.uid;
}

/** Generate a playerCode/gmCode pair that isn't currently in use by an active game. */
async function generateUniqueCodes(
  db: admin.firestore.Firestore
): Promise<{ playerCode: string; gmCode: string }> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const playerCode = generateCode();
    const gmCode = generateCode();
    if (playerCode === gmCode) continue;

    const [playerHit, gmHit] = await Promise.all([
      db.collection('games').where('status', '==', 'active')
        .where('playerCode', 'in', [playerCode, gmCode]).limit(1).get(),
      db.collection('games').where('status', '==', 'active')
        .where('gmCode', 'in', [playerCode, gmCode]).limit(1).get(),
    ]);
    if (playerHit.empty && gmHit.empty) {
      return { playerCode, gmCode };
    }
  }
  throw new functions.https.HttpsError('internal', 'Could not allocate a unique game code. Try again.');
}

/**
 * Create a game and the creator's GM membership atomically. Codes are generated
 * server-side (CSPRNG) and never accepted from the client.
 */
export const createGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const name = cleanName(data?.name);
  const displayName = cleanName(data?.displayName);
  const fcmToken = typeof data?.fcmToken === 'string' && data.fcmToken ? data.fcmToken : undefined;

  if (!name) {
    throw new functions.https.HttpsError('invalid-argument', 'A game name is required.');
  }
  if (!displayName) {
    throw new functions.https.HttpsError('invalid-argument', 'A display name is required.');
  }

  const db = admin.firestore();
  const { playerCode, gmCode } = await generateUniqueCodes(db);

  const gameRef = db.collection('games').doc();
  const memberRef = gameRef.collection('members').doc(uid);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const member: Record<string, unknown> = {
    userId: uid,
    role: 'gm',
    displayName,
    email: context.auth?.token.email ?? '',
    joinedAt: now,
  };
  if (fcmToken) member.fcmToken = fcmToken;

  const batch = db.batch();
  batch.set(gameRef, {
    name,
    playerCode,
    gmCode,
    creatorId: uid,
    status: 'active',
    phase: 'setup',
    startedAt: null,
    endedAt: null,
    createdAt: now,
  });
  batch.set(memberRef, member);
  await batch.commit();

  return { gameId: gameRef.id };
});

/**
 * Join a game by code. The code is resolved server-side (clients can no longer
 * read game docs to discover codes), the role is derived from which code matched,
 * and email is taken from the verified auth token — not from client input.
 */
export const joinGameByCode = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const code = String(data?.code ?? '').trim().toUpperCase();
  const displayName = cleanName(data?.displayName);
  const fcmToken = typeof data?.fcmToken === 'string' && data.fcmToken ? data.fcmToken : undefined;

  if (code.length !== CODE_LENGTH) {
    throw new functions.https.HttpsError('invalid-argument', 'Enter the 6-character game code.');
  }
  if (!displayName) {
    throw new functions.https.HttpsError('invalid-argument', 'A display name is required.');
  }

  const db = admin.firestore();

  // Resolve the code to a game + role.
  let role: 'player' | 'gm' | null = null;
  let gameId: string | null = null;

  const playerSnap = await db.collection('games')
    .where('playerCode', '==', code).where('status', '==', 'active').limit(1).get();
  if (!playerSnap.empty) {
    role = 'player';
    gameId = playerSnap.docs[0].id;
  } else {
    const gmSnap = await db.collection('games')
      .where('gmCode', '==', code).where('status', '==', 'active').limit(1).get();
    if (!gmSnap.empty) {
      role = 'gm';
      gameId = gmSnap.docs[0].id;
    }
  }

  if (!role || !gameId) {
    throw new functions.https.HttpsError('not-found', 'No active game found with that code.');
  }

  const memberRef = db.collection('games').doc(gameId).collection('members').doc(uid);
  const existing = await memberRef.get();

  const member: Record<string, unknown> = {
    userId: uid,
    // Don't silently downgrade an existing GM who re-enters with the player code.
    role: existing.exists ? existing.data()?.role ?? role : role,
    displayName,
    email: context.auth?.token.email ?? '',
  };
  if (fcmToken) member.fcmToken = fcmToken;
  if (!existing.exists) {
    member.joinedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await memberRef.set(member, { merge: true });

  return { gameId, role: member.role };
});

/**
 * Delete a game that hasn't started yet (phase `setup` or `lobby`). GM-only.
 * Game docs are not client-deletable (`allow delete: if false`) and Firestore
 * doesn't cascade subcollections, so this runs server-side and recursively
 * removes the game plus its members/checkpoints/locations/arrivals.
 */
export const deleteGame = functions.https.onCall(async (data, context) => {
  const uid = requireAuth(context);
  const gameId = String(data?.gameId ?? '').trim();
  if (!gameId) {
    throw new functions.https.HttpsError('invalid-argument', 'A game id is required.');
  }

  const db = admin.firestore();
  const gameRef = db.collection('games').doc(gameId);
  const [gameSnap, memberSnap] = await Promise.all([
    gameRef.get(),
    gameRef.collection('members').doc(uid).get(),
  ]);

  if (!gameSnap.exists) {
    // Already gone — treat as success so a double-tap doesn't error.
    return { deleted: true };
  }
  if (!memberSnap.exists || memberSnap.data()?.role !== 'gm') {
    throw new functions.https.HttpsError('permission-denied', 'Only a Game Master can delete this game.');
  }

  const game = gameSnap.data() ?? {};
  // Resolve phase the same way gameService.gamePhase() does, then refuse to
  // delete anything that has started: only `setup`/`lobby` games are removable.
  const phase = game.phase ?? (game.status === 'ended' ? 'results' : 'play');
  if (game.startedAt || phase === 'play' || phase === 'results') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Only games that haven\'t started can be deleted. Archive a finished game instead.'
    );
  }

  await db.recursiveDelete(gameRef);
  return { deleted: true };
});
