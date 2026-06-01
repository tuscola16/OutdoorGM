import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections, functions } from './firebase';
import type { Game, Checkpoint, GamePhase, GameStatus, MapBoundary } from '@/types';

/** Resolve a game's phase, defaulting legacy games (created before the `phase`
 * field existed) to `play` while active and `results` once ended. */
export function gamePhase(game: { phase?: GamePhase; status?: GameStatus } | null | undefined): GamePhase {
  if (!game) return 'setup';
  if (game.phase) return game.phase;
  return game.status === 'ended' ? 'results' : 'play';
}

/**
 * Create a game via the createGame Cloud Function. Join codes are generated
 * server-side (CSPRNG) and the creator's GM membership is created atomically —
 * clients can no longer write game docs or self-assign the GM role.
 */
export async function createGame(
  name: string,
  displayName: string,
  fcmToken?: string
): Promise<{ id: string }> {
  const callable = functions().httpsCallable('createGame');
  const res = await callable({ name, displayName, fcmToken: fcmToken ?? null });
  return { id: (res.data as { gameId: string }).gameId };
}

// --- Phase transitions ---

/** Open a game to players (phase: setup → lobby). */
export async function openLobby(gameId: string): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({ phase: 'lobby' });
}

/** Send a game back to setup (phase: lobby → setup). */
export async function reopenSetup(gameId: string): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({ phase: 'setup' });
}

/** Start play and stamp the start time (phase: lobby → play). */
export async function startGame(gameId: string): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({
    phase: 'play',
    startedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/** Update the play-area boundary and/or rules text during setup. */
export async function updateGameConfig(
  gameId: string,
  config: { boundary?: MapBoundary; rules?: string }
): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update(config);
}

/** Mark a player as out of the game (they tap "I'm Out"). */
export async function markPlayerOut(gameId: string, userId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ out: true, outAt: firestore.FieldValue.serverTimestamp() });
}

/**
 * Join a game by code via the joinGameByCode Cloud Function. The code is matched
 * server-side (game docs — and the codes they hold — are no longer client-readable),
 * the role is derived from which code matched, and the member doc is written by the
 * function so the role can't be forged. Returns the resolved game id + role.
 */
export async function joinGameByCode(
  code: string,
  displayName: string,
  fcmToken?: string
): Promise<{ gameId: string; role: 'player' | 'gm' }> {
  const callable = functions().httpsCallable('joinGameByCode');
  const res = await callable({ code, displayName, fcmToken: fcmToken ?? null });
  return res.data as { gameId: string; role: 'player' | 'gm' };
}

export async function updateFcmToken(gameId: string, userId: string, fcmToken: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ fcmToken });
}

export async function getMyGames(userId: string): Promise<{ game: Game; role: 'player' | 'gm' }[]> {
  // Query all member subcollections where the userId field matches
  const snap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where('userId', '==', userId)
    .get();

  const results: { game: Game; role: 'player' | 'gm' }[] = [];
  for (const memberDoc of snap.docs) {
    // Parent path: games/{gameId}/members/{userId}
    const gameId = memberDoc.ref.parent.parent?.id;
    if (!gameId) continue;
    const gameSnap = await firestore().collection(Collections.GAMES).doc(gameId).get();
    if (gameSnap.exists) {
      results.push({
        game: { id: gameSnap.id, ...gameSnap.data() } as Game,
        role: memberDoc.data().role as 'player' | 'gm',
      });
    }
  }
  return results;
}

/** Stop play and move to results (phase: play → results). Keeps `status: 'ended'`
 * so existing "is this game over?" checks (and old clients) keep working. */
export async function endGame(gameId: string): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({
    status: 'ended',
    phase: 'results',
    endedAt: firestore.FieldValue.serverTimestamp(),
  });
}

// Checkpoints
export async function addCheckpoint(
  gameId: string,
  checkpoint: Omit<Checkpoint, 'id'>
): Promise<Checkpoint> {
  const ref = firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc();
  await ref.set(checkpoint);
  return { id: ref.id, ...checkpoint };
}

export async function updateCheckpoint(
  gameId: string,
  checkpointId: string,
  updates: Partial<Omit<Checkpoint, 'id'>>
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc(checkpointId)
    .update(updates);
}

export async function deleteCheckpoint(gameId: string, checkpointId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc(checkpointId)
    .delete();
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const current = auth().currentUser;
  if (!current || !current.email) {
    throw new Error('You must be signed in to delete your account.');
  }

  // Re-authenticate first. Firestore rules require an authenticated user, so the
  // data cleanup below must run *before* the auth account is deleted. If we let
  // currentUser.delete() fail with `auth/requires-recent-login` at the end, the
  // user's data would already be gone but their account would remain — a broken,
  // unrecoverable state. Reauthenticating up front guarantees delete() will succeed.
  const credential = auth.EmailAuthProvider.credential(current.email, password);
  await current.reauthenticateWithCredential(credential);

  // Remove user from all game member + location subcollections
  const memberSnap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where('userId', '==', userId)
    .get();

  const batch = firestore().batch();
  for (const memberDoc of memberSnap.docs) {
    const gameId = memberDoc.ref.parent.parent?.id;
    batch.delete(memberDoc.ref);
    if (gameId) {
      batch.delete(
        firestore()
          .collection(Collections.GAMES)
          .doc(gameId)
          .collection(Collections.LOCATIONS)
          .doc(userId)
      );
    }
  }
  batch.delete(firestore().collection(Collections.USERS).doc(userId));
  await batch.commit();

  // Delete the Firebase Auth account last — once deleted we lose Firestore write
  // access. Reauthentication above ensures this cannot fail with requires-recent-login.
  await current.delete();
}

export async function updateMemberRole(
  gameId: string,
  userId: string,
  role: 'player' | 'gm'
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ role });
}

export async function removePlayer(gameId: string, userId: string): Promise<void> {
  const batch = firestore().batch();
  batch.delete(
    firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .doc(userId)
  );
  batch.delete(
    firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.LOCATIONS)
      .doc(userId)
  );
  await batch.commit();
}

export async function updatePlayerLocation(
  gameId: string,
  userId: string,
  displayName: string,
  coords: { latitude: number; longitude: number; accuracy?: number; heading?: number }
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.LOCATIONS)
    .doc(userId)
    .set({
      userId,
      displayName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      heading: coords.heading ?? null,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
}
