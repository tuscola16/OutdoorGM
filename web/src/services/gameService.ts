import {
  doc,
  collection,
  collectionGroup,
  query,
  where,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  deleteField,
  arrayUnion,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, Collections } from './firebase';
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
} from '@shared/types';

/** Ration eat-window math (Rules 6–9). Ported from the mobile gameService: given
 * a started game and "now", which 0-based interval we're in, how many total, the
 * interval deadline, and when/whether the eat-window is open (#21 — the last
 * `rationWindowMinutes` of each interval). */
export function rationInterval(
  game: Game | null | undefined,
  now: number = Date.now()
): {
  index: number;
  total: number;
  windowStartsAt: number;
  windowEndsAt: number;
  isPlaying: boolean;
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
  const openMs = Math.min(Math.max(cfg.rationWindowMinutes, 0), cfg.rationIntervalMinutes) * 60_000;
  const windowStartsAt = windowEndsAt - openMs;
  const isPlaying = index >= 0 && index < total;
  const isOpen = isPlaying && now >= windowStartsAt && now < windowEndsAt;
  return { index, total, windowStartsAt, windowEndsAt, isPlaying, isOpen };
}

/** GM marks a submitted ration valid or rejected (web mirror of the mobile
 * reviewRation). Players have no access; only GMs review. */
export async function reviewRation(
  gameId: string,
  rationId: string,
  status: 'valid' | 'rejected'
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.RATIONS, rationId), {
    status,
    reviewedAt: serverTimestamp(),
  });
}

/** Resolve a game's phase, defaulting legacy games (created before the `phase`
 * field existed) to `play` while active and `results` once ended. Ported from
 * the mobile app's gameService.ts. */
export function gamePhase(game: { phase?: GamePhase; status?: GameStatus } | null | undefined): GamePhase {
  if (!game) return 'setup';
  if (game.phase) return game.phase;
  return game.status === 'ended' ? 'results' : 'play';
}

/** Resolve a game's full config by layering its overrides over the base rules. */
export function gameConfig(game: { config?: Partial<GameConfig> } | null | undefined): GameConfig {
  return { ...BASE_GAME_CONFIG, ...(game?.config ?? {}) };
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

/** Update the play-area boundary, rules text, and/or per-GM config during setup. */
export async function updateGameConfig(
  gameId: string,
  updates: { boundary?: MapBoundary; rules?: string; config?: Partial<GameConfig> }
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), updates);
}

/** Eliminate a player (sets out/outAt + cause). The death broadcast + winner
 * detection run server-side in onMemberWrite, so they fire regardless of who
 * eliminated whom. Mirrors the mobile app's gameService.eliminatePlayer. */
export async function eliminatePlayer(
  gameId: string,
  userId: string,
  cause: EliminationCause = 'gm-other'
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
    out: true,
    outAt: serverTimestamp(),
    cause,
  });
}

/** Back-compat alias. */
export async function markPlayerOut(gameId: string, userId: string): Promise<void> {
  await eliminatePlayer(gameId, userId, 'self');
}

/** GM acknowledges a safety alert (#5): stamps `sosAckAt` so it stops being the live,
 * escalating state but the SOS stays open until cleared. GM-write-only (firestore.rules). */
export async function ackSos(gameId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
    sosAckAt: serverTimestamp(),
  });
}

/** GM stands down a resolved safety alert (Rules 22, 27, 28); clears the flag and the
 * acknowledgement so the next SOS starts clean (#5). */
export async function clearSos(gameId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
    sos: false,
    sosAckAt: null,
  });
}

/** GM sends a one-way message to players. Omit `targetPlayerId` to broadcast to
 * everyone, or set it to target a single player (Rule 32). Players have no write
 * access to this collection (Rule 23: no player↔player comms). */
export async function sendBroadcast(
  gameId: string,
  message: string,
  targetPlayerId?: string
): Promise<void> {
  await addDoc(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), {
    kind: 'gm-message',
    message,
    targetPlayerId: targetPlayerId ?? null,
    createdAt: serverTimestamp(),
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
  // Drop any paired game-time reveal row (#48) so a deleted checkpoint can't be revealed.
  await deleteDoc(
    doc(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS, `reveal_${checkpointId}`)
  ).catch(() => {});
}

/** Resolve a reveal's player audience into a marker's `audiencePlayerIds` (#48):
 * null = visible to all; an array = only those uids. Mirrors the server helper. */
function revealAudienceIds(cp: Checkpoint): string[] | null {
  const aud = cp.reveal?.audience ?? 'all';
  if (aud === 'specific-players') return cp.reveal?.recipientPlayerIds ?? [];
  return null; // 'triggerer' is meaningless for a manual reveal → treat as all
}

/**
 * GM manually reveals a checkpoint marker to players now (#48 `gm-manual` trigger).
 * Projects the marker (label + location only — never the secret payload) into the
 * player-readable `markers` collection and latches `revealedAt`. GMs may write markers
 * (firestore.rules); the run-sheet/geofence do the timed/crossing reveals server-side.
 */
export async function revealCheckpointNow(gameId: string, cp: Checkpoint): Promise<void> {
  const audience = revealAudienceIds(cp);
  await setDoc(
    doc(db, Collections.GAMES, gameId, Collections.MARKERS, cp.id),
    {
      checkpointId: cp.id,
      name: cp.name,
      latitude: cp.latitude,
      longitude: cp.longitude,
      audiencePlayerIds: audience === null ? null : audience.length === 0 ? [] : arrayUnion(...audience),
      revealedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, cp.id), {
    revealedAt: serverTimestamp(),
    ...(audience && audience.length > 0 ? { revealedTo: arrayUnion(...audience) } : {}),
  });
}

/**
 * Sync a checkpoint's game-time reveal (#48) into the run-sheet as a deterministic
 * `reveal-checkpoint` row so the per-minute sweep fires it. Pass `offsetMinutes` to
 * schedule, or `null` to clear. Mirrors the mobile setRevealSchedule.
 */
export async function setRevealSchedule(
  gameId: string,
  checkpointId: string,
  offsetMinutes: number | null
): Promise<void> {
  const ref = doc(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS, `reveal_${checkpointId}`);
  if (offsetMinutes == null) {
    await deleteDoc(ref).catch(() => {});
    return;
  }
  await setDoc(ref, {
    type: 'reveal-checkpoint',
    checkpointId,
    offsetMinutes,
    firedAt: null,
    createdAt: serverTimestamp(),
  });
}

// --- Timed site windows (#12) ---

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

const cpDoc = (gameId: string, checkpointId: string) =>
  doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, checkpointId);

/** GM opens a timed site now: live from this moment, no scheduled close (#12). */
export async function openCheckpointNow(gameId: string, checkpointId: string): Promise<void> {
  await updateDoc(cpDoc(gameId, checkpointId), {
    opensAt: serverTimestamp(),
    closesAt: deleteField(),
  });
}

/** GM closes a timed site now (#12). */
export async function closeCheckpointNow(gameId: string, checkpointId: string): Promise<void> {
  await updateDoc(cpDoc(gameId, checkpointId), { closesAt: serverTimestamp() });
}

/** GM removes the window so the site is always live again (#12). */
export async function clearCheckpointWindow(gameId: string, checkpointId: string): Promise<void> {
  await updateDoc(cpDoc(gameId, checkpointId), {
    opensAt: deleteField(),
    closesAt: deleteField(),
  });
}

// --- Run-sheet / scheduled events (#11) ---

const scheduledEventsCol = (gameId: string) =>
  collection(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS);

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
  await addDoc(scheduledEventsCol(gameId), {
    ...data,
    firedAt: null,
    createdAt: serverTimestamp(),
  });
}

export async function updateScheduledEvent(
  gameId: string,
  eventId: string,
  updates: Partial<Omit<ScheduledEvent, 'id' | 'createdAt'>>
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS, eventId), updates);
}

export async function deleteScheduledEvent(gameId: string, eventId: string): Promise<void> {
  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS, eventId));
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

/** GM sets (or clears, when null/empty) a member's district/tribute pairing (ROADMAP
 * #10). Players can't change their own district (firestore.rules). */
export async function setMemberDistrict(
  gameId: string,
  userId: string,
  district: string | null
): Promise<void> {
  const trimmed = district?.trim() ?? '';
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
    district: trimmed === '' ? deleteField() : trimmed,
  });
}
