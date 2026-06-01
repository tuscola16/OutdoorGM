import {
  doc,
  collection,
  collectionGroup,
  query,
  where,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, Collections } from './firebase';
import type { Game, Checkpoint, GamePhase, GameStatus, MapBoundary } from '@shared/types';

/** Resolve a game's phase, defaulting legacy games (created before the `phase`
 * field existed) to `play` while active and `results` once ended. Ported from
 * the mobile app's gameService.ts. */
export function gamePhase(game: { phase?: GamePhase; status?: GameStatus } | null | undefined): GamePhase {
  if (!game) return 'setup';
  if (game.phase) return game.phase;
  return game.status === 'ended' ? 'results' : 'play';
}

/**
 * Create a game via the createGame Cloud Function. Join codes are generated
 * server-side (CSPRNG) and the creator's GM membership is created atomically.
 */
export async function createGame(name: string, displayName: string): Promise<{ id: string }> {
  const callable = httpsCallable(functions, 'createGame');
  const res = await callable({ name, displayName, fcmToken: null });
  return { id: (res.data as { gameId: string }).gameId };
}

/**
 * Join a game by code via the joinGameByCode Cloud Function. The code is resolved
 * server-side and the role is derived from which code matched. A GM joins a web
 * dashboard with the GM code.
 */
export async function joinGameByCode(
  code: string,
  displayName: string
): Promise<{ gameId: string; role: 'player' | 'gm' }> {
  const callable = httpsCallable(functions, 'joinGameByCode');
  const res = await callable({ code, displayName, fcmToken: null });
  return res.data as { gameId: string; role: 'player' | 'gm' };
}

// --- Phase transitions ---

/** Open a game to players (phase: setup → lobby). */
export async function openLobby(gameId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'lobby' });
}

/** Send a game back to setup (phase: lobby → setup). */
export async function reopenSetup(gameId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'setup' });
}

/** Start play and stamp the start time (phase: lobby → play). */
export async function startGame(gameId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    phase: 'play',
    startedAt: serverTimestamp(),
  });
}

/** Stop play and move to results (phase: play → results). Keeps `status: 'ended'`
 * so existing "is this game over?" checks (and the joinGameByCode active filter)
 * keep working. */
export async function endGame(gameId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    status: 'ended',
    phase: 'results',
    endedAt: serverTimestamp(),
  });
}

/** Update the play-area boundary and/or rules text during setup. */
export async function updateGameConfig(
  gameId: string,
  config: { boundary?: MapBoundary; rules?: string }
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), config);
}

/** Mark a player as out of the game. */
export async function markPlayerOut(gameId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
    out: true,
    outAt: serverTimestamp(),
  });
}

export interface MyGameEntry {
  game: Game;
  role: 'player' | 'gm';
  /** Whether this user has archived the game from their own list. */
  archived: boolean;
}

export async function getMyGames(userId: string): Promise<MyGameEntry[]> {
  // Query all member subcollections where the userId field matches (mirrors the
  // mobile collection-group query; relies on the collection-group index on userId).
  const snap = await getDocs(
    query(collectionGroup(db, Collections.MEMBERS), where('userId', '==', userId))
  );

  const results: MyGameEntry[] = [];
  for (const memberDoc of snap.docs) {
    // Parent path: games/{gameId}/members/{userId}
    const gameId = memberDoc.ref.parent.parent?.id;
    if (!gameId) continue;
    const gameSnap = await getDoc(doc(db, Collections.GAMES, gameId));
    if (gameSnap.exists()) {
      results.push({
        game: { id: gameSnap.id, ...gameSnap.data() } as Game,
        role: memberDoc.data().role as 'player' | 'gm',
        archived: memberDoc.data().archived === true,
      });
    }
  }
  return results;
}

/** Delete a game that hasn't started yet (GM-only). Runs server-side so the game
 * doc and all its subcollections are removed atomically — see the deleteGame
 * Cloud Function. */
export async function deleteGame(gameId: string): Promise<void> {
  const callable = httpsCallable(functions, 'deleteGame');
  await callable({ gameId });
}

/** Archive/unarchive a finished game from this user's own "My Games" list. Sets
 * `archived` on the caller's member doc (the rules allow self-updates that don't
 * change role/userId), so it only affects this user's view. */
export async function setGameArchived(
  gameId: string,
  userId: string,
  archived: boolean
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { archived });
}

// --- Checkpoints ---

export async function addCheckpoint(
  gameId: string,
  checkpoint: Omit<Checkpoint, 'id'>
): Promise<Checkpoint> {
  const ref = await addDoc(
    collection(db, Collections.GAMES, gameId, Collections.CHECKPOINTS),
    checkpoint
  );
  return { id: ref.id, ...checkpoint };
}

export async function updateCheckpoint(
  gameId: string,
  checkpointId: string,
  updates: Partial<Omit<Checkpoint, 'id'>>
): Promise<void> {
  await updateDoc(
    doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, checkpointId),
    updates
  );
}

export async function deleteCheckpoint(gameId: string, checkpointId: string): Promise<void> {
  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, checkpointId));
}

// --- Members ---

export async function updateMemberRole(
  gameId: string,
  userId: string,
  role: 'player' | 'gm'
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { role });
}

export async function removePlayer(gameId: string, userId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId));
  batch.delete(doc(db, Collections.GAMES, gameId, Collections.LOCATIONS, userId));
  await batch.commit();
}
