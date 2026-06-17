import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections, functions } from './firebase';
import {
  BASE_GAME_CONFIG,
  GM_BROADCAST_TARGET,
  type Game,
  type GameConfig,
  type Checkpoint,
  type RunbookEntry,
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

/**
 * Clone a game's setup into a fresh game (#65) via the cloneGame Cloud Function. Copies the
 * boundary, rules, config, checkpoints, and runbook entries; resets everything
 * runtime/participant. The caller becomes sole GM and the new game starts in `setup`.
 */
export async function cloneGame(
  sourceGameId: string,
  displayName: string,
  name?: string,
  fcmToken?: string
): Promise<{ id: string }> {
  const callable = functions().httpsCallable('cloneGame');
  const res = await callable({ sourceGameId, displayName, name: name ?? null, fcmToken: fcmToken ?? null });
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

/** Read a game's resolved phase (for the #22 monotonic-transition guards). */
async function readPhase(gameId: string): Promise<GamePhase> {
  const snap = await firestore().collection(Collections.GAMES).doc(gameId).get();
  return gamePhase(snap.data() as { phase?: GamePhase; status?: GameStatus } | undefined);
}

/**
 * Open a game to players (phase: setup → lobby). #22: guarded + monotonic — a no-op if
 * already in the lobby, and refused from any later phase (a stale tap can't rewind play).
 */
export async function openLobby(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'lobby') return; // already open — no-op
  if (phase !== 'setup') throw new Error('This game has already started.');
  await firestore().collection(Collections.GAMES).doc(gameId).update({ phase: 'lobby' });
}

/**
 * Send a game back to setup (phase: lobby → setup) — the one sanctioned backward move.
 * #22: only from the lobby; refused once play has begun.
 */
export async function reopenSetup(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'setup') return; // already there — no-op
  if (phase !== 'lobby') throw new Error('Only a game waiting in the lobby can return to setup.');
  await firestore().collection(Collections.GAMES).doc(gameId).update({ phase: 'setup' });
}

/**
 * Start play and stamp the start time (phase: lobby → play). #22: a no-op if already in
 * play (so a double-tap can't re-stamp `startedAt` and reset every timer), and refused
 * from setup/results.
 */
export async function startGame(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'play') return; // already started — don't re-stamp startedAt
  if (phase !== 'lobby') throw new Error('The game can only be started from the lobby.');
  await firestore().collection(Collections.GAMES).doc(gameId).update({
    phase: 'play',
    startedAt: firestore.FieldValue.serverTimestamp(),
  });
}

/** Parse a 'YYYY-MM-DD' event-date string into a Firestore Timestamp at that day's local
 * midnight, or null when blank/invalid — for the GM event-date field (#36). */
export function parseEventDate(ymd: string): FsTimestamp | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ymd.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(date.getTime())) return null;
  return firestore.Timestamp.fromDate(date) as unknown as FsTimestamp;
}

/** Format a stored event-date timestamp back to 'YYYY-MM-DD' for the editor ('' if unset). */
export function formatEventDate(ts: FsTimestamp | null | undefined): string {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Update the play-area boundary, rules text, event date, and/or per-GM config during setup. */
export async function updateGameConfig(
  gameId: string,
  updates: {
    boundary?: MapBoundary;
    rules?: string;
    config?: Partial<GameConfig>;
    /** GM-set event date (#36); pass null to clear it. */
    gameDate?: FsTimestamp | null;
  }
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

/**
 * Reverse an accidental elimination (#21). Clears `out`/`outAt`/`cause`, posts a
 * correcting broadcast, and — if that death had *ended the game* via winner detection —
 * reopens `results → play`. GM-only.
 *
 * Idempotency: clearing `out` (true→false) does NOT re-trigger `handleDeath` — that gate
 * fires only when `out` *rises* — so reviving never re-fires a death toll. We also delete
 * the deterministic death-toll doc (`${userId}_death`, #26) so a later re-elimination of
 * the same player can toll afresh.
 */
export async function revivePlayer(gameId: string, userId: string): Promise<void> {
  const gameRef = firestore().collection(Collections.GAMES).doc(gameId);
  const memberRef = gameRef.collection(Collections.MEMBERS).doc(userId);
  const [memberSnap, gameSnap] = await Promise.all([memberRef.get(), gameRef.get()]);
  const name = memberSnap.data()?.displayName ?? 'A tribute';
  const game = gameSnap.data() as Game | undefined;

  await memberRef.update({
    out: false,
    outAt: null,
    cause: firestore.FieldValue.delete(),
  });

  // Drop the deterministic death toll so a future re-elimination tolls again (#26).
  await gameRef.collection(Collections.BROADCASTS).doc(`${userId}_death`).delete().catch(() => {});

  // Correcting broadcast so players see the reversal (the original toll already went out).
  await gameRef.collection(Collections.BROADCASTS).add({
    kind: 'gm-message',
    message: `${name} is back in the game.`,
    targetPlayerId: null,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });

  // If this death had ended the game, reopen play. (The stale winner broadcast is left
  // as-is — the correcting broadcast covers it; don't try to retract it.)
  if (gamePhase(game) === 'results' && game?.status === 'ended') {
    await gameRef.update({ phase: 'play', status: 'active', endedAt: null });
  }
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
 * pushes the alert + the player's location to all GMs. Resets `sosAckAt` so a fresh
 * SOS starts as the live, unacknowledged state (#5) even if a prior one was acked. */
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
      sosAckAt: null,
    });
}

/** GM acknowledges a safety alert (#5): stamps `sosAckAt` so it stops being the live,
 * escalating state but the SOS record stays open (the GM still resolves it with
 * `clearSos`). GM-write-only — players can't forge an ack (firestore.rules). */
export async function ackSos(gameId: string, userId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ sosAckAt: firestore.FieldValue.serverTimestamp() });
}

/** GM stands down a resolved safety alert: clears the flag and the acknowledgement so
 * the next SOS starts clean (#5). */
export async function clearSos(gameId: string, userId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ sos: false, sosAckAt: null });
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
 * Dismiss a broadcast from the current player's in-app list (#71). Appends the player's
 * own uid to `dismissedBy` via `arrayUnion` (idempotent). firestore.rules lets a player
 * update only `dismissedBy`, adding only their own uid — never another field or another
 * player's uid. This governs the persistent {@link BroadcastFeed} list only; the heads-up
 * {@link AlertOverlay} pop has its own device-local ack (#70).
 */
export async function dismissBroadcast(gameId: string, broadcastId: string): Promise<void> {
  const uid = auth().currentUser?.uid;
  if (!uid) return;
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.BROADCASTS)
    .doc(broadcastId)
    .update({ dismissedBy: firestore.FieldValue.arrayUnion(uid) });
}

/**
 * Send a GM↔GM (co-GM) message (#40): a broadcast readable only by GMs. Uses the
 * `GM_BROADCAST_TARGET` sentinel so players' broadcast listeners never fetch it, plus
 * `audience: 'gm-only'` (enforced in firestore.rules). There is no player↔player channel
 * (Rule 23); this is GM↔GM only.
 */
export async function sendGmMessage(
  gameId: string,
  message: string,
  senderName: string
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.BROADCASTS)
    .add({
      kind: 'gm-message',
      message,
      targetPlayerId: GM_BROADCAST_TARGET,
      audience: 'gm-only',
      senderName,
      createdAt: firestore.FieldValue.serverTimestamp(),
    });
}

/** Subscribe to a game's co-GM messages (#40), newest first. GM-only (firestore.rules).
 * Single-field equality query (no composite index); sorted in memory. */
export function subscribeGmMessages(
  gameId: string,
  onChange: (messages: import('@/types').Broadcast[]) => void
): () => void {
  return firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.BROADCASTS)
    .where('audience', '==', 'gm-only')
    .onSnapshot(
      (snap) => {
        const msgs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as import('@/types').Broadcast)
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        onChange(msgs);
      },
      (err) => console.error('[GmMessages] subscription error', err)
    );
}

/**
 * Submit a ration-card photo for the current eat window (Rules 6–9). The photo must already
 * be uploaded (this takes its download URL). Goes through the `submitRation` Cloud Function
 * (#68) so the server can enforce unique card numbers at write time — a duplicate card (with
 * enforcement on) throws `already-exists` and never lands. The doc id is deterministic
 * (`${playerId}_${intervalIndex}`) so the same player re-submitting the same window is
 * idempotent.
 */
export async function submitRation(
  gameId: string,
  player: { userId: string; displayName: string },
  intervalIndex: number,
  photoUrl: string,
  cardNumber?: string
): Promise<void> {
  const callable = functions().httpsCallable('submitRation');
  await callable({
    gameId,
    displayName: player.displayName,
    intervalIndex,
    photoUrl,
    cardNumber: cardNumber ?? null,
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

  // Fetch each parent game doc in parallel rather than serially — this runs on every
  // focus of the Games screen, so a user in N games shouldn't pay N round-trips of latency.
  const entries = await Promise.all(
    snap.docs.map(async (memberDoc) => {
      // Parent path: games/{gameId}/members/{userId}
      const gameId = memberDoc.ref.parent.parent?.id;
      if (!gameId) return null;
      const gameSnap = await firestore().collection(Collections.GAMES).doc(gameId).get();
      if (!gameSnap.exists) return null;
      return {
        game: { id: gameSnap.id, ...gameSnap.data() } as Game,
        role: memberDoc.data().role as 'player' | 'gm',
        archived: memberDoc.data().archived === true,
      };
    })
  );
  return entries.filter((e): e is MyGameEntry => e !== null);
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

/**
 * Stop play and move to results (phase: play → results). Keeps `status: 'ended'`
 * so existing "is this game over?" checks (and old clients) keep working. #22: a no-op
 * if already in results (double-tap safe), and refused before play has started.
 */
export async function endGame(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'results') return; // already ended — no-op
  if (phase !== 'play') throw new Error('Only a game in play can be ended.');
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
  // Drop any paired timed reveal row (#60) so a deleted checkpoint can't be revealed.
  await scheduledEventsCol(gameId).doc(revealEventId(checkpointId)).delete().catch(() => {});
  // Cascade-delete the checkpoint's runbook entries so none are left dangling (#60).
  const entries = await runbookCol(gameId).where('checkpointId', '==', checkpointId).get();
  if (!entries.empty) {
    const batch = firestore().batch();
    entries.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// --- Runbook entries (#60) ---

const runbookCol = (gameId: string) =>
  firestore().collection(Collections.GAMES).doc(gameId).collection(Collections.RUNBOOK);

/** Create a runbook entry attached to a checkpoint. */
export async function addRunbookEntry(
  gameId: string,
  entry: Omit<RunbookEntry, 'id' | 'createdAt'>
): Promise<RunbookEntry> {
  const ref = runbookCol(gameId).doc();
  const data = { ...entry, createdAt: firestore.FieldValue.serverTimestamp() };
  await ref.set(data);
  return { id: ref.id, ...entry, createdAt: data.createdAt as unknown as FsTimestamp };
}

/** Update a runbook entry. Pass `firestore.FieldValue.delete()` to drop trigger-specific
 * fields (e.g. clearing `queueSlots` when switching away from fixed-order). */
export async function updateRunbookEntry(
  gameId: string,
  entryId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await runbookCol(gameId).doc(entryId).update(updates);
}

export async function deleteRunbookEntry(gameId: string, entryId: string): Promise<void> {
  await runbookCol(gameId).doc(entryId).delete();
}

/**
 * Fire a `gm-prompted` runbook entry now (#60): the GM taps it and picks the target
 * player(s). Runs server-side (the fireRunbookEntry callable) so it can push to players
 * and validate the caller is a GM. Pass an empty/omitted `targetPlayerIds` to deliver to
 * every living player.
 */
export async function fireRunbookEntry(
  gameId: string,
  entryId: string,
  targetPlayerIds?: string[]
): Promise<void> {
  const callable = functions().httpsCallable('fireRunbookEntry');
  await callable({ gameId, entryId, targetPlayerIds: targetPlayerIds ?? null });
}

/** Deterministic run-sheet doc id for a checkpoint's game-time reveal (#48), so the
 * editor can upsert/clear it without hunting for a random-id row. */
const revealEventId = (checkpointId: string) => `reveal_${checkpointId}`;

/**
 * Sync a checkpoint's game-time reveal (#48 case B/D `trigger: 'game-time'`) into the
 * run-sheet as a deterministic `reveal-checkpoint` row, so the existing per-minute sweep
 * fires it (no new index). Pass `offsetMinutes` to schedule the reveal at that many
 * minutes after Start Game, or `null` to clear it (e.g. the GM switched the trigger to
 * manual/on-crossing). Writing the row with `firedAt: null` (re)arms it.
 */
export async function setRevealSchedule(
  gameId: string,
  checkpointId: string,
  offsetMinutes: number | null
): Promise<void> {
  const ref = scheduledEventsCol(gameId).doc(revealEventId(checkpointId));
  if (offsetMinutes == null) {
    await ref.delete().catch(() => {});
    return;
  }
  await ref.set({
    type: 'reveal-checkpoint',
    checkpointId,
    offsetMinutes,
    firedAt: null,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });
}

/** Resolve a reveal's player audience into a marker's `audiencePlayerIds` (#48):
 * null = visible to all; an array = only those uids. Mirrors the server helper. */
function revealAudienceIds(cp: Checkpoint): string[] | null {
  const aud = cp.reveal?.audience ?? 'all';
  if (aud === 'specific-players') return cp.reveal?.recipientPlayerIds ?? [];
  // 'triggerer' has no meaning for a manual reveal (no crossing player) → treat as all.
  return null;
}

/**
 * GM manually reveals a checkpoint marker to players now (#48 `gm-manual` trigger).
 * Projects the marker (label + location only — never the secret event payload) into the
 * player-readable `markers` collection and latches `revealedAt` on the checkpoint. GMs are
 * allowed to write markers (firestore.rules); the run-sheet/geofence do the timed/crossing
 * reveals server-side.
 */
export async function revealCheckpointNow(gameId: string, cp: Checkpoint): Promise<void> {
  const audience = revealAudienceIds(cp);
  const gameRef = firestore().collection(Collections.GAMES).doc(gameId);
  await gameRef.collection(Collections.MARKERS).doc(cp.id).set(
    {
      checkpointId: cp.id,
      name: cp.name,
      latitude: cp.latitude,
      longitude: cp.longitude,
      audiencePlayerIds:
        audience === null
          ? null
          : audience.length === 0
            ? []
            : firestore.FieldValue.arrayUnion(...audience),
      revealedAt: firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  await gameRef.collection(Collections.CHECKPOINTS).doc(cp.id).update({
    revealedAt: firestore.FieldValue.serverTimestamp(),
    ...(audience && audience.length > 0
      ? { revealedTo: firestore.FieldValue.arrayUnion(...audience) }
      : {}),
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

  // #29 Sole-GM rescue — run *before* we strip the caller's memberships (the callable
  // resolves them via the still-present member docs). For any active game this user solely
  // GMs, it promotes the longest-tenured active player to GM or ends an empty game, so the
  // membership cleanup below can't orphan a game. Best-effort: a failure here must not block
  // the rest of account deletion (the hourly orphan sweep is the backstop).
  try {
    await functions().httpsCallable('transferGmOrEndGame')({});
  } catch (err) {
    console.error('[deleteAccount] sole-GM transfer failed (orphan sweep will backstop):', err);
  }

  // Remove user from all game member + location subcollections
  const memberSnap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where('userId', '==', userId)
    .get();

  // Resolve each game's phase first so we know which member docs we may hard-delete.
  // Member docs are delete-locked during `play` (#20) to preserve elimination history —
  // so for a live game we *scrub-and-eliminate* the member instead of deleting it.
  const gameIds = Array.from(
    new Set(memberSnap.docs.map((d) => d.ref.parent.parent?.id).filter((id): id is string => !!id))
  );
  const gameSnaps = await Promise.all(
    gameIds.map((id) => firestore().collection(Collections.GAMES).doc(id).get())
  );
  const phaseByGame = new Map<string, GamePhase>();
  gameSnaps.forEach((snap) => {
    if (snap.exists) phaseByGame.set(snap.id, gamePhase(snap.data() as Game));
  });

  // A scrub op preserves the eliminated-member record while erasing the departing
  // user's identity (no name/email/token retained), so live games keep accurate
  // timing + death history without orphaning their roster.
  type Op =
    | { kind: 'delete'; ref: FirebaseFirestoreTypes.DocumentReference }
    | { kind: 'scrub'; ref: FirebaseFirestoreTypes.DocumentReference };
  const ops: Op[] = [];
  for (const memberDoc of memberSnap.docs) {
    const gameId = memberDoc.ref.parent.parent?.id;
    const phase = gameId ? phaseByGame.get(gameId) : undefined;
    if (phase === 'play') {
      // Live game: keep the member as an anonymized elimination instead of deleting.
      ops.push({ kind: 'scrub', ref: memberDoc.ref });
    } else {
      ops.push({ kind: 'delete', ref: memberDoc.ref });
    }
    if (gameId) {
      ops.push({
        kind: 'delete',
        ref: firestore()
          .collection(Collections.GAMES)
          .doc(gameId)
          .collection(Collections.LOCATIONS)
          .doc(userId),
      });
    }
  }
  ops.push({ kind: 'delete', ref: firestore().collection(Collections.USERS).doc(userId) });

  const CHUNK = 450; // safe margin under the 500-op batch limit
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = firestore().batch();
    for (const op of ops.slice(i, i + CHUNK)) {
      if (op.kind === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.update(op.ref, {
          out: true,
          outAt: firestore.FieldValue.serverTimestamp(),
          cause: 'self',
          email: '',
          displayName: '(left)',
          fcmToken: firestore.FieldValue.delete(),
        });
      }
    }
    await batch.commit();
  }

  // Sole-GM games were already handed off / ended by the transferGmOrEndGame call above (#29),
  // so the membership removal here can no longer orphan a game.

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
  coords: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    heading?: number;
    /** Device battery 0–1 (#35); omitted when unavailable. */
    battery?: number;
  }
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
      // #35: only write battery when we have a real reading, so a fix never clobbers a
      // prior good level with null on a device that can't report it.
      ...(typeof coords.battery === 'number' ? { battery: coords.battery } : {}),
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
}
