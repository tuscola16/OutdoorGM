import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections, functions } from './firebase';
import {
  BASE_GAME_CONFIG,
  type Game,
  type GameConfig,
  type Checkpoint,
  type GamePhase,
  type GameStatus,
  type MapBoundary,
  type EliminationCause,
  type FsTimestamp,
  type ScheduledEvent,
  type ScheduledActionType,
} from '@/types';

/** Resolve a game's phase, defaulting legacy games (created before the `phase`
 * field existed) to `play` while active and `results` once ended. */
export function gamePhase(game: { phase?: GamePhase; status?: GameStatus } | null | undefined): GamePhase {
  if (!game) return 'setup';
  if (game.phase) return game.phase;
  return game.status === 'ended' ? 'results' : 'play';
}

/** Resolve a game's full config by layering its overrides over the base rules.
 * Mirrors `gamePhase` — legacy games (no `config`) get the base game rules. */
export function gameConfig(game: { config?: Partial<GameConfig> } | null | undefined): GameConfig {
  return { ...BASE_GAME_CONFIG, ...(game?.config ?? {}) };
}

/** Ration eat-window math (Rules 6–9). Given a started game and "now", which
 * 0-based interval are we in, how many total intervals, the interval deadline, and
 * when/whether the *eat-window* is open (#21). The eat-window is the last
 * `rationWindowMinutes` of each interval, ending at the interval boundary
 * (`windowEndsAt`) — the panel is hidden and no card is expected before it opens. */
export function rationInterval(
  game: Game | null | undefined,
  now: number = Date.now()
): {
  index: number;
  total: number;
  /** When the eat-window opens (card capture becomes available). */
  windowStartsAt: number;
  /** The interval deadline — eat by now or risk starvation. */
  windowEndsAt: number;
  /** In a valid interval of the game. */
  isPlaying: boolean;
  /** The eat-window is currently open (capture allowed / expected). */
  isOpen: boolean;
} | null {
  const cfg = gameConfig(game);
  const startedMs = game?.startedAt?.toMillis?.();
  if (!startedMs) return null;
  const windowMs = cfg.rationIntervalMinutes * 60_000;
  const total = Math.ceil(cfg.durationMinutes / cfg.rationIntervalMinutes);
  const elapsed = now - startedMs;
  const index = Math.floor(elapsed / windowMs);
  const windowEndsAt = startedMs + (index + 1) * windowMs;
  // Open window = last `rationWindowMinutes` of the interval (clamped to the interval).
  const openMs = Math.min(Math.max(cfg.rationWindowMinutes, 0), cfg.rationIntervalMinutes) * 60_000;
  const windowStartsAt = windowEndsAt - openMs;
  const isPlaying = index >= 0 && index < total;
  const isOpen = isPlaying && now >= windowStartsAt && now < windowEndsAt;
  return { index, total, windowStartsAt, windowEndsAt, isPlaying, isOpen };
}

/**
 * Create a game via the createGame Cloud Function. Join codes are generated
 * server-side (CSPRNG) and the creator's GM membership is created atomically —
 * clients can no longer write game docs or self-assign the GM role.
 */
export async function createGame(
  name: string,
  displayName: string,
  fcmToken?: string,
  isTest = false
): Promise<{ id: string }> {
  const callable = functions().httpsCallable('createGame');
  const res = await callable({ name, displayName, fcmToken: fcmToken ?? null, isTest });
  return { id: (res.data as { gameId: string }).gameId };
}

/** Persist the GM's position in the Test Runner walkthrough (a resumable cursor). */
export async function setTestStep(gameId: string, index: number): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({ testStepIndex: index });
}

/** Re-arm a Test Event checkpoint so the GM can walk its arrival-order queue with a
 * small group: rewrites the player's arrival doc to a consumed marker (server-side) so
 * the queue ordinal advances while the player can cross again. See functions/src/rearm.ts. */
export async function rearmCheckpoint(
  gameId: string,
  playerId: string,
  checkpointId: string
): Promise<void> {
  const callable = functions().httpsCallable('rearmCheckpoint');
  await callable({ gameId, playerId, checkpointId });
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

/** Update the play-area boundary, rules text, and/or per-GM config during setup. */
export async function updateGameConfig(
  gameId: string,
  updates: { boundary?: MapBoundary; rules?: string; config?: Partial<GameConfig> }
): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update(updates);
}

/**
 * Eliminate a player (set `out`/`outAt` + `cause`). A player self-reports their
 * own death (honor system, Rule 16); a GM may eliminate anyone (starvation, bad
 * sport, etc.). The death broadcast + winner detection happen server-side in the
 * onMemberWrite Cloud Function, so they fire no matter who eliminated whom.
 */
export async function eliminatePlayer(
  gameId: string,
  userId: string,
  cause: EliminationCause = 'self'
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ out: true, outAt: firestore.FieldValue.serverTimestamp(), cause });
}

/** Back-compat alias — the "I'm Out" button now reports an honor-system death. */
export async function markPlayerOut(gameId: string, userId: string): Promise<void> {
  await eliminatePlayer(gameId, userId, 'self');
}

/** Record where a dead player dropped their pack/weapons (Rules 19, 20). */
export async function setDeathLocation(
  gameId: string,
  userId: string,
  coords: { latitude: number; longitude: number }
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ deathLocation: coords });
}

/** Raise a safety alert to the GM (Rules 22, 27, 28). The onMemberWrite function
 * pushes the alert + the player's location to all GMs. */
export async function raiseSos(
  gameId: string,
  userId: string,
  coords?: { latitude: number; longitude: number }
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({
      sos: true,
      sosAt: firestore.FieldValue.serverTimestamp(),
      sosLocation: coords ?? null,
    });
}

/** GM clears a resolved safety alert. */
export async function clearSos(gameId: string, userId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ sos: false });
}

/** GM sends a one-way message to players. Omit `targetPlayerId` to broadcast to
 * everyone, or set it to target a single player (e.g. a marked gear drop, Rule 32).
 * Players have no write access to this collection (Rule 23: no player↔player comms). */
export async function sendBroadcast(
  gameId: string,
  message: string,
  targetPlayerId?: string
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.BROADCASTS)
    .add({
      kind: 'gm-message',
      message,
      // Always written (null = global) so players can query `targetPlayerId == null`;
      // Firestore can't match on an absent field.
      targetPlayerId: targetPlayerId ?? null,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
}

/**
 * Submit a ration-card photo for the current eat window (Rules 6–9). The photo
 * must already be uploaded (returns a download URL); this writes the submission
 * record. The doc id is deterministic (`${playerId}_${intervalIndex}`) so a
 * re-submit within the same window overwrites rather than duplicates.
 */
export async function submitRation(
  gameId: string,
  player: { userId: string; displayName: string },
  intervalIndex: number,
  photoUrl: string,
  cardNumber?: string
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.RATIONS)
    .doc(`${player.userId}_${intervalIndex}`)
    .set({
      playerId: player.userId,
      playerName: player.displayName,
      intervalIndex,
      photoUrl,
      cardNumber: cardNumber ?? null,
      status: 'pending',
      submittedAt: firestore.FieldValue.serverTimestamp(),
    });
}

/** GM marks a submitted ration valid or rejected. */
export async function reviewRation(
  gameId: string,
  rationId: string,
  status: 'valid' | 'rejected'
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.RATIONS)
    .doc(rationId)
    .update({ status, reviewedAt: firestore.FieldValue.serverTimestamp() });
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

export interface MyGameEntry {
  game: Game;
  role: 'player' | 'gm';
  /** Whether this user has archived the game from their own list. */
  archived: boolean;
}

export async function getMyGames(userId: string): Promise<MyGameEntry[]> {
  // Query all member subcollections where the userId field matches
  const snap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where('userId', '==', userId)
    .get();

  const results: MyGameEntry[] = [];
  for (const memberDoc of snap.docs) {
    // Parent path: games/{gameId}/members/{userId}
    const gameId = memberDoc.ref.parent.parent?.id;
    if (!gameId) continue;
    const gameSnap = await firestore().collection(Collections.GAMES).doc(gameId).get();
    if (gameSnap.exists) {
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
  const callable = functions().httpsCallable('deleteGame');
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
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ archived });
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

// --- Timed site windows (#12) ---

/** A checkpoint's live state given its window. `always` = no window (default);
 * `pending` = window set but not open yet; `open` = live now; `closed` = window passed. */
export type CheckpointWindowState = 'always' | 'pending' | 'open' | 'closed';

export function checkpointWindowState(
  cp: { opensAt?: FsTimestamp | null; closesAt?: FsTimestamp | null },
  nowMs: number = Date.now()
): CheckpointWindowState {
  const opens = cp.opensAt?.toMillis?.() ?? null;
  const closes = cp.closesAt?.toMillis?.() ?? null;
  if (opens == null && closes == null) return 'always';
  if (opens != null && nowMs < opens) return 'pending';
  if (closes != null && nowMs > closes) return 'closed';
  return 'open';
}

const checkpointDoc = (gameId: string, checkpointId: string) =>
  firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc(checkpointId);

/** GM opens a timed site now: live from this moment, no scheduled close (#12). */
export async function openCheckpointNow(gameId: string, checkpointId: string): Promise<void> {
  await checkpointDoc(gameId, checkpointId).update({
    opensAt: firestore.FieldValue.serverTimestamp(),
    closesAt: firestore.FieldValue.delete(),
  });
}

/** GM closes a timed site now: stops firing from this moment on (#12). */
export async function closeCheckpointNow(gameId: string, checkpointId: string): Promise<void> {
  await checkpointDoc(gameId, checkpointId).update({
    closesAt: firestore.FieldValue.serverTimestamp(),
  });
}

/** GM removes the window so the site is always live again (#12). */
export async function clearCheckpointWindow(gameId: string, checkpointId: string): Promise<void> {
  await checkpointDoc(gameId, checkpointId).update({
    opensAt: firestore.FieldValue.delete(),
    closesAt: firestore.FieldValue.delete(),
  });
}

// --- Run-sheet / scheduled events (#11) ---

const scheduledEventsCol = (gameId: string) =>
  firestore().collection(Collections.GAMES).doc(gameId).collection(Collections.SCHEDULED_EVENTS);

/** GM adds a timed action to the run-sheet. `firedAt` starts null so the sweep
 * (collectionGroup where firedAt == null) can find it. */
export async function addScheduledEvent(
  gameId: string,
  data: {
    type: ScheduledActionType;
    offsetMinutes?: number | null;
    checkpointId?: string;
    message?: string;
    template?: 'player-count' | null;
  }
): Promise<void> {
  await scheduledEventsCol(gameId).add({
    ...data,
    firedAt: null,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });
}

export async function updateScheduledEvent(
  gameId: string,
  eventId: string,
  updates: Partial<Omit<ScheduledEvent, 'id' | 'createdAt'>>
): Promise<void> {
  await scheduledEventsCol(gameId).doc(eventId).update(updates);
}

export async function deleteScheduledEvent(gameId: string, eventId: string): Promise<void> {
  await scheduledEventsCol(gameId).doc(eventId).delete();
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

/** GM sets (or clears, when `district` is null/empty) a member's district/tribute
 * pairing. Players cannot change their own district (enforced in firestore.rules) so a
 * tribute can't reassign their pairing. Read by the geofence function for the
 * same-district trap-suppression rule (ROADMAP #5). */
export async function setMemberDistrict(
  gameId: string,
  userId: string,
  district: string | null
): Promise<void> {
  const trimmed = district?.trim() ?? '';
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({
      district: trimmed === '' ? firestore.FieldValue.delete() : trimmed,
    });
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
