import {
  collection,
  collectionGroup,
  doc,
  query,
  where,
  getDoc,
  getDocs,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  deleteField,
  arrayUnion,
  writeBatch,
  Timestamp,
  type DocumentReference,
} from '@react-native-firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from '@react-native-firebase/auth';
import { httpsCallable } from '@react-native-firebase/functions';
import { Collections, db, auth, functions } from './firebase';
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
  isTest = false,
  practice = false
): Promise<{ id: string }> {
  const callable = httpsCallable(functions, 'createGame');
  const res = await callable({ name, displayName, fcmToken: fcmToken ?? null, isTest, practice });
  return { id: (res.data as { gameId: string }).gameId };
}

/** Reset a practice game (#43) so it can be re-run: clears runtime data, re-arms the run-sheet,
 * revives players, and drops the game back to the lobby. GM-only; server-side (resetPracticeGame). */
export async function resetPracticeGame(gameId: string): Promise<void> {
  const callable = httpsCallable(functions, 'resetPracticeGame');
  await callable({ gameId });
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
  const callable = httpsCallable(functions, 'cloneGame');
  const res = await callable({ sourceGameId, displayName, name: name ?? null, fcmToken: fcmToken ?? null });
  return { id: (res.data as { gameId: string }).gameId };
}

/** Persist the GM's position in the Test Runner walkthrough (a resumable cursor). */
export async function setTestStep(gameId: string, index: number): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), { testStepIndex: index });
}

/** Re-arm a Test Event checkpoint so the GM can walk its arrival-order queue with a
 * small group: rewrites the player's arrival doc to a consumed marker (server-side) so
 * the queue ordinal advances while the player can cross again. See functions/src/rearm.ts. */
export async function rearmCheckpoint(
  gameId: string,
  playerId: string,
  checkpointId: string
): Promise<void> {
  const callable = httpsCallable(functions, 'rearmCheckpoint');
  await callable({ gameId, playerId, checkpointId });
}

// --- Phase transitions ---

/** Read a game's resolved phase (for the #22 monotonic-transition guards). */
async function readPhase(gameId: string): Promise<GamePhase> {
  const snap = await getDoc(doc(db, Collections.GAMES, gameId));
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
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'lobby' });
}

/**
 * Send a game back to setup (phase: lobby → setup) — the one sanctioned backward move.
 * #22: only from the lobby; refused once play has begun.
 */
export async function reopenSetup(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'setup') return; // already there — no-op
  if (phase !== 'lobby') throw new Error('Only a game waiting in the lobby can return to setup.');
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'setup' });
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
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    phase: 'play',
    startedAt: serverTimestamp(),
  });
}

/** Deterministic marker id for the #41 end-game convergence point. */
export const ENDGAME_RALLY_ID = 'endgame-rally';

/**
 * Start the end-game "final showdown" (#41): phase `play → endgame`. Auto-disables the
 * ration loop (gated on the resolved phase, so no config flip), drops a GM-placed
 * convergence marker visible to all players (rides the #48 `markers` reveal plumbing), and
 * broadcasts the rally call. Live systems (tracking, boundary, SOS, geofence) keep running.
 * #22: a no-op if already in endgame, and refused unless currently in play.
 */
export async function startEndgame(
  gameId: string,
  rally: { latitude: number; longitude: number }
): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'endgame') return; // already in the showdown — no-op
  if (phase !== 'play') throw new Error('The end-game can only begin from play.');
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'endgame' });
  // Convergence marker — label + location only, visible to all players (audience null).
  await setDoc(doc(db, Collections.GAMES, gameId, Collections.MARKERS, ENDGAME_RALLY_ID), {
    checkpointId: ENDGAME_RALLY_ID,
    name: 'Final Rally',
    latitude: rally.latitude,
    longitude: rally.longitude,
    audiencePlayerIds: null,
    revealedAt: serverTimestamp(),
  });
  await sendBroadcast(gameId, '⚔️ Final showdown — converge on the rally point!');
}

/** Parse a 'YYYY-MM-DD' event-date string into a Firestore Timestamp at that day's local
 * midnight, or null when blank/invalid — for the GM event-date field (#36). */
export function parseEventDate(ymd: string): FsTimestamp | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(ymd.trim());
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date) as unknown as FsTimestamp;
}

/** Format a stored event-date timestamp back to 'YYYY-MM-DD' for the editor ('' if unset). */
export function formatEventDate(ts: FsTimestamp | null | undefined): string {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Set (or clear) the post-game media links (#45) on the game doc. Pass `null` to clear. The
 * `onGameMediaWrite` Cloud Function then pushes every member except `updatedBy`. GM-only via
 * firestore.rules (the `media` whitelist key). Host-validate the URLs before calling.
 */
export async function setGameMedia(
  gameId: string,
  media: { youtubeUrl?: string; photosAlbumUrl?: string } | null,
  updatedBy: string
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    media: media
      ? {
          ...(media.youtubeUrl ? { youtubeUrl: media.youtubeUrl } : {}),
          ...(media.photosAlbumUrl ? { photosAlbumUrl: media.photosAlbumUrl } : {}),
          updatedBy,
          updatedAt: serverTimestamp(),
        }
      : deleteField(),
  });
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
  await updateDoc(doc(db, Collections.GAMES, gameId), updates);
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
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { out: true, outAt: serverTimestamp(), cause });
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
  const gameRef = doc(db, Collections.GAMES, gameId);
  const memberRef = doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId);
  const [memberSnap, gameSnap] = await Promise.all([getDoc(memberRef), getDoc(gameRef)]);
  const name = memberSnap.data()?.displayName ?? 'A tribute';
  const game = gameSnap.data() as Game | undefined;

  await updateDoc(memberRef, {
    out: false,
    outAt: null,
    cause: deleteField(),
  });

  // Drop the deterministic death toll so a future re-elimination tolls again (#26).
  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.BROADCASTS, `${userId}_death`)).catch(() => {});

  // Correcting broadcast so players see the reversal (the original toll already went out).
  await addDoc(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), {
    kind: 'gm-message',
    message: `${name} is back in the game.`,
    targetPlayerId: null,
    createdAt: serverTimestamp(),
  });

  // If this death had ended the game, reopen play. (The stale winner broadcast is left
  // as-is — the correcting broadcast covers it; don't try to retract it.)
  if (gamePhase(game) === 'results' && game?.status === 'ended') {
    await updateDoc(gameRef, { phase: 'play', status: 'active', endedAt: null });
  }
}

/** Record where a dead player dropped their pack/weapons (Rules 19, 20). */
export async function setDeathLocation(
  gameId: string,
  userId: string,
  coords: { latitude: number; longitude: number }
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { deathLocation: coords });
}

/** Raise a safety alert to the GM (Rules 22, 27, 28). The onMemberWrite function
 * pushes the alert + the player's location to all GMs. Resets `sosAckAt` so a fresh
 * SOS starts as the live, unacknowledged state (#5) even if a prior one was acked. */
export async function raiseSos(
  gameId: string,
  userId: string,
  coords?: { latitude: number; longitude: number }
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
      sos: true,
      sosAt: serverTimestamp(),
      sosLocation: coords ?? null,
      sosAckAt: null,
    });
}

/** GM acknowledges a safety alert (#5): stamps `sosAckAt` so it stops being the live,
 * escalating state but the SOS record stays open (the GM still resolves it with
 * `clearSos`). GM-write-only — players can't forge an ack (firestore.rules). */
export async function ackSos(gameId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { sosAckAt: serverTimestamp() });
}

/** GM stands down a resolved safety alert: clears the flag and the acknowledgement so
 * the next SOS starts clean (#5). */
export async function clearSos(gameId: string, userId: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { sos: false, sosAckAt: null });
}

/** GM sends a one-way message to players. Omit `targetPlayerId` to broadcast to
 * everyone, or set it to target a single player (e.g. a marked gear drop, Rule 32).
 * Players have no write access to this collection (Rule 23: no player↔player comms). */
export async function sendBroadcast(
  gameId: string,
  message: string,
  targetPlayerId?: string
): Promise<void> {
  await addDoc(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), {
      kind: 'gm-message',
      message,
      // Always written (null = global) so players can query `targetPlayerId == null`;
      // Firestore can't match on an absent field.
      targetPlayerId: targetPlayerId ?? null,
      createdAt: serverTimestamp(),
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
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.BROADCASTS, broadcastId), { dismissedBy: arrayUnion(uid) });
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
  await addDoc(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), {
      kind: 'gm-message',
      message,
      targetPlayerId: GM_BROADCAST_TARGET,
      audience: 'gm-only',
      senderName,
      createdAt: serverTimestamp(),
    });
}

/** Subscribe to a game's co-GM messages (#40), newest first. GM-only (firestore.rules).
 * Single-field equality query (no composite index); sorted in memory. */
export function subscribeGmMessages(
  gameId: string,
  onChange: (messages: import('@/types').Broadcast[]) => void
): () => void {
  return onSnapshot(query(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), where('audience', '==', 'gm-only')), 
      (snap) => {
        const msgs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as import('@/types').Broadcast)
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        onChange(msgs);
      },
      (err: Error) => console.error('[GmMessages] subscription error', err)
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
  const callable = httpsCallable(functions, 'submitRation');
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
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.RATIONS, rationId), { status, reviewedAt: serverTimestamp() });
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
  const callable = httpsCallable(functions, 'joinGameByCode');
  const res = await callable({ code, displayName, fcmToken: fcmToken ?? null });
  return res.data as { gameId: string; role: 'player' | 'gm' };
}

export async function updateFcmToken(gameId: string, userId: string, fcmToken: string): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { fcmToken });
}

export interface MyGameEntry {
  game: Game;
  role: 'player' | 'gm';
  /** Whether this user has archived the game from their own list. */
  archived: boolean;
}

export async function getMyGames(userId: string): Promise<MyGameEntry[]> {
  // Query all member subcollections where the userId field matches
  const snap = await getDocs(query(collectionGroup(db, Collections.MEMBERS), where('userId', '==', userId)));

  // Fetch each parent game doc in parallel rather than serially — this runs on every
  // focus of the Games screen, so a user in N games shouldn't pay N round-trips of latency.
  //
  // Each fetch is individually fault-tolerant: one unreadable game (a doc deleted out from
  // under a surviving membership, a transient permission-denied) must never reject the whole
  // Promise.all and blank the list — that would hide every finished game the user was a
  // player or co-GM in along with the broken one. Skip the bad entry, keep the history.
  const entries = await Promise.all(
    snap.docs.map(async (memberDoc) => {
      // Parent path: games/{gameId}/members/{userId}
      const gameId = memberDoc.ref.parent.parent?.id;
      if (!gameId) return null;
      try {
        const gameSnap = await getDoc(doc(db, Collections.GAMES, gameId));
        if (!gameSnap.exists()) return null;
        return {
          game: { id: gameSnap.id, ...gameSnap.data() } as Game,
          role: memberDoc.data().role as 'player' | 'gm',
          archived: memberDoc.data().archived === true,
        };
      } catch (err) {
        console.warn(`[getMyGames] skipping unreadable game ${gameId}`, err);
        return null;
      }
    })
  );
  return entries.filter((e): e is MyGameEntry => e !== null);
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

/**
 * Stop play and move to results (phase: play → results). Keeps `status: 'ended'`
 * so existing "is this game over?" checks (and old clients) keep working. #22: a no-op
 * if already in results (double-tap safe), and refused before play has started.
 */
export async function endGame(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'results') return; // already ended — no-op
  // #41: closeable from play OR the end-game showdown.
  if (phase !== 'play' && phase !== 'endgame') throw new Error('Only a game in play can be ended.');
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    status: 'ended',
    phase: 'results',
    endedAt: serverTimestamp(),
  });
}

// Checkpoints
export async function addCheckpoint(
  gameId: string,
  checkpoint: Omit<Checkpoint, 'id'>
): Promise<Checkpoint> {
  const ref = doc(collection(db, Collections.GAMES, gameId, Collections.CHECKPOINTS));
  await setDoc(ref, checkpoint);
  return { id: ref.id, ...checkpoint };
}

export async function updateCheckpoint(
  gameId: string,
  checkpointId: string,
  updates: Partial<Omit<Checkpoint, 'id'>>
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, checkpointId), updates);
}

export async function deleteCheckpoint(gameId: string, checkpointId: string): Promise<void> {
  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.CHECKPOINTS, checkpointId));
  // Drop any paired timed reveal row (#60) so a deleted checkpoint can't be revealed.
  await deleteDoc(doc(scheduledEventsCol(gameId), revealEventId(checkpointId))).catch(() => {});
  // Cascade-delete the checkpoint's runbook entries so none are left dangling (#60).
  const entries = await runbookCol(gameId).where('checkpointId', '==', checkpointId).get();
  if (!entries.empty) {
    const batch = writeBatch(db);
    entries.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// --- Runbook entries (#60) ---

const runbookCol = (gameId: string) =>
  collection(db, Collections.GAMES, gameId, Collections.RUNBOOK);

/** Create a runbook entry attached to a checkpoint. */
export async function addRunbookEntry(
  gameId: string,
  entry: Omit<RunbookEntry, 'id' | 'createdAt'>
): Promise<RunbookEntry> {
  const ref = doc(runbookCol(gameId));
  const data = { ...entry, createdAt: serverTimestamp() };
  await setDoc(ref, data);
  return { id: ref.id, ...entry, createdAt: data.createdAt as unknown as FsTimestamp };
}

/** Update a runbook entry. Pass `deleteField()` to drop trigger-specific
 * fields (e.g. clearing `queueSlots` when switching away from fixed-order). */
export async function updateRunbookEntry(
  gameId: string,
  entryId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await updateDoc(doc(runbookCol(gameId), entryId), updates);
}

export async function deleteRunbookEntry(gameId: string, entryId: string): Promise<void> {
  await deleteDoc(doc(runbookCol(gameId), entryId));
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
  const callable = httpsCallable(functions, 'fireRunbookEntry');
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
  const ref = doc(scheduledEventsCol(gameId), revealEventId(checkpointId));
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
  const gameRef = doc(db, Collections.GAMES, gameId);
  await setDoc(doc(gameRef, Collections.MARKERS, cp.id),
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
            : arrayUnion(...audience),
      revealedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await updateDoc(doc(gameRef, Collections.CHECKPOINTS, cp.id), {
    revealedAt: serverTimestamp(),
    ...(audience && audience.length > 0
      ? { revealedTo: arrayUnion(...audience) }
      : {}),
  });
}

// --- Run-sheet / scheduled events (#11) ---

const scheduledEventsCol = (gameId: string) =>
  collection(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS);

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
  await updateDoc(doc(scheduledEventsCol(gameId), eventId), updates);
}

export async function deleteScheduledEvent(gameId: string, eventId: string): Promise<void> {
  await deleteDoc(doc(scheduledEventsCol(gameId), eventId));
}

export async function deleteAccount(userId: string, password: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.email) {
    throw new Error('You must be signed in to delete your account.');
  }

  // Re-authenticate first. Firestore rules require an authenticated user, so the
  // data cleanup below must run *before* the auth account is deleted. If we let
  // currentUser.delete() fail with `auth/requires-recent-login` at the end, the
  // user's data would already be gone but their account would remain — a broken,
  // unrecoverable state. Reauthenticating up front guarantees delete() will succeed.
  const credential = EmailAuthProvider.credential(current.email, password);
  await reauthenticateWithCredential(current, credential);

  // #29 Sole-GM rescue — run *before* we strip the caller's memberships (the callable
  // resolves them via the still-present member docs). For any active game this user solely
  // GMs, it promotes the longest-tenured active player to GM or ends an empty game, so the
  // membership cleanup below can't orphan a game. Best-effort: a failure here must not block
  // the rest of account deletion (the hourly orphan sweep is the backstop).
  try {
    await httpsCallable(functions, 'transferGmOrEndGame')({});
  } catch (err) {
    console.error('[deleteAccount] sole-GM transfer failed (orphan sweep will backstop):', err);
  }

  // Remove user from all game member + location subcollections
  const memberSnap = await getDocs(query(collectionGroup(db, Collections.MEMBERS), where('userId', '==', userId)));

  // Resolve each game's phase first so we know which member docs we may hard-delete.
  // Member docs are delete-locked during `play` (#20) to preserve elimination history —
  // so for a live game we *scrub-and-eliminate* the member instead of deleting it.
  const gameIds = Array.from(
    new Set(memberSnap.docs.map((d) => d.ref.parent.parent?.id).filter((id): id is string => !!id))
  );
  const gameSnaps = await Promise.all(
    gameIds.map((id) => getDoc(doc(db, Collections.GAMES, id)))
  );
  const phaseByGame = new Map<string, GamePhase>();
  gameSnaps.forEach((snap) => {
    if (snap.exists()) phaseByGame.set(snap.id, gamePhase(snap.data() as Game));
  });

  // A scrub op preserves the eliminated-member record while erasing the departing
  // user's identity (no name/email/token retained), so live games keep accurate
  // timing + death history without orphaning their roster.
  type Op =
    | { kind: 'delete'; ref: DocumentReference }
    | { kind: 'scrub'; ref: DocumentReference };
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
        ref: doc(db, Collections.GAMES, gameId, Collections.LOCATIONS, userId),
      });
    }
  }
  ops.push({ kind: 'delete', ref: doc(db, Collections.USERS, userId) });

  const CHUNK = 450; // safe margin under the 500-op batch limit
  for (let i = 0; i < ops.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + CHUNK)) {
      if (op.kind === 'delete') {
        batch.delete(op.ref);
      } else {
        batch.update(op.ref, {
          out: true,
          outAt: serverTimestamp(),
          cause: 'self',
          email: '',
          displayName: '(left)',
          fcmToken: deleteField(),
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
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), { role });
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
  await updateDoc(doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId), {
      district: trimmed === '' ? deleteField() : trimmed,
    });
}

export async function removePlayer(gameId: string, userId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(
    doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId)
  );
  batch.delete(
    doc(db, Collections.GAMES, gameId, Collections.LOCATIONS, userId)
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
  await setDoc(doc(db, Collections.GAMES, gameId, Collections.LOCATIONS, userId), {
      userId,
      displayName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      heading: coords.heading ?? null,
      // #35: only write battery when we have a real reading, so a fix never clobbers a
      // prior good level with null on a device that can't report it.
      ...(typeof coords.battery === 'number' ? { battery: coords.battery } : {}),
      updatedAt: serverTimestamp(),
    });
}
