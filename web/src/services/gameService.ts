import {
  doc,
  collection,
  collectionGroup,
  query,
  where,
  getDoc,
  getDocs,
  onSnapshot,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  deleteField,
  arrayUnion,
  Timestamp,
  type UpdateData,
  type DocumentData,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, functions, storage, Collections } from './firebase';
import {
  BASE_GAME_CONFIG,
  GM_BROADCAST_TARGET,
  type Game,
  type GameConfig,
  type Broadcast,
  type Checkpoint,
  type RunbookEntry,
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
export async function createGame(
  name: string,
  displayName: string,
  practice = false
): Promise<{ id: string }> {
  const callable = httpsCallable(functions, 'createGame');
  const res = await callable({ name, displayName, fcmToken: null, practice });
  return { id: (res.data as { gameId: string }).gameId };
}

/** Reset a practice game (#43) so it can be re-run: clears runtime data, re-arms the run-sheet,
 * revives players, and drops the game back to the lobby. GM-only; server-side. */
export async function resetPracticeGame(gameId: string): Promise<void> {
  const callable = httpsCallable(functions, 'resetPracticeGame');
  await callable({ gameId });
}

/**
 * Clone a game's setup into a fresh game (#65) via the cloneGame Cloud Function. Copies the
 * boundary, rules, config, checkpoints, and their runbook entries; resets everything
 * runtime/participant. The caller becomes sole GM and the new game starts in `setup`.
 */
export async function cloneGame(
  sourceGameId: string,
  displayName: string,
  name?: string
): Promise<{ id: string }> {
  const callable = httpsCallable(functions, 'cloneGame');
  const res = await callable({ sourceGameId, displayName, name: name ?? null, fcmToken: null });
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
  if (phase === 'lobby') return;
  if (phase !== 'setup') throw new Error('This game has already started.');
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'lobby' });
}

/**
 * Send a game back to setup (phase: lobby → setup) — the one sanctioned backward move.
 * #22: only from the lobby; refused once play has begun.
 */
export async function reopenSetup(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'setup') return;
  if (phase !== 'lobby') throw new Error('Only a game waiting in the lobby can return to setup.');
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'setup' });
}

/**
 * Start play and stamp the start time (phase: lobby → play). #22: a no-op if already in
 * play (so a double-tap can't re-stamp `startedAt`), and refused from setup/results.
 */
export async function startGame(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'play') return;
  if (phase !== 'lobby') throw new Error('The game can only be started from the lobby.');
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    phase: 'play',
    startedAt: serverTimestamp(),
  });
}

/** Stop play and move to results (phase: play → results). Keeps `status: 'ended'`
 * so existing "is this game over?" checks (and the joinGameByCode active filter)
 * keep working. #22: a no-op if already in results, and refused before play. */
export async function endGame(gameId: string): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'results') return;
  // #41: closeable from play OR the end-game showdown.
  if (phase !== 'play' && phase !== 'endgame') throw new Error('Only a game in play can be ended.');
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    status: 'ended',
    phase: 'results',
    endedAt: serverTimestamp(),
  });
}

/** Deterministic marker id for the #41 end-game convergence point. */
export const ENDGAME_RALLY_ID = 'endgame-rally';

/**
 * Start the end-game "final showdown" (#41): phase `play → endgame`. Auto-disables the
 * ration loop (gated on the resolved phase), drops a GM-placed convergence marker visible to
 * all players (rides the #48 `markers` reveal plumbing), and broadcasts the rally call. Live
 * systems (tracking, boundary, SOS, geofence) keep running. #22: a no-op if already in
 * endgame, refused unless currently in play. Mirrors the mobile gameService.startEndgame.
 */
export async function startEndgame(
  gameId: string,
  rally: { latitude: number; longitude: number }
): Promise<void> {
  const phase = await readPhase(gameId);
  if (phase === 'endgame') return;
  if (phase !== 'play') throw new Error('The end-game can only begin from play.');
  await updateDoc(doc(db, Collections.GAMES, gameId), { phase: 'endgame' });
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
 * Set (or clear) post-game media links (#45) on the game doc. Pass `null` to clear. The
 * `onGameMediaWrite` Cloud Function pushes every member except `updatedBy`. GM-only via
 * firestore.rules. Host-validate the URLs before calling. Mirrors mobile setGameMedia.
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

// --- Arena map overlay (#42) ---

/**
 * Upload a GM's arena image to Storage and return its download URL.
 *
 * Path is `games/{gameId}/overlay/{uid}/arena` — namespaced by uploader so storage.rules can
 * stop anyone from overwriting a published overlay, and extension-free so "Replace image"
 * always overwrites the same object instead of orphaning the old one when the file type
 * changes. The stored contentType is what browsers/Mapbox read, not the name.
 */
export async function uploadArenaOverlay(gameId: string, uid: string, file: File): Promise<string> {
  const ref = storageRef(storage, `${Collections.GAMES}/${gameId}/overlay/${uid}/arena`);
  await uploadBytes(ref, file, { contentType: file.type || 'image/jpeg' });
  return getDownloadURL(ref);
}

/**
 * Persist (or clear) the custom arena overlay (#42) on the game doc. Pass `null` to remove
 * it. GM-only via firestore.rules (the game-doc `mapOverlay` whitelist key). `corners` are
 * ordered TL, TR, BR, BL.
 */
export async function setMapOverlay(
  gameId: string,
  overlay: { url: string; corners: { latitude: number; longitude: number }[]; opacity?: number } | null,
  updatedBy: string
): Promise<void> {
  await updateDoc(doc(db, Collections.GAMES, gameId), {
    mapOverlay: overlay
      ? { ...overlay, updatedBy, updatedAt: serverTimestamp() }
      : deleteField(),
  });
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

/**
 * Reverse an accidental elimination (#21). Clears out/outAt/cause, posts a correcting
 * broadcast, and — if that death had ended the game via winner detection — reopens
 * `results → play`. GM-only. Mirrors the mobile gameService.revivePlayer.
 *
 * Clearing `out` (true→false) does NOT re-trigger handleDeath (it gates on `out` rising),
 * so reviving never re-fires a death toll. We also drop the deterministic death-toll doc
 * (`${userId}_death`, #26) so a later re-elimination can toll afresh.
 */
export async function revivePlayer(gameId: string, userId: string): Promise<void> {
  const gameRef = doc(db, Collections.GAMES, gameId);
  const memberRef = doc(db, Collections.GAMES, gameId, Collections.MEMBERS, userId);
  const [memberSnap, gameSnap] = await Promise.all([getDoc(memberRef), getDoc(gameRef)]);
  const name = (memberSnap.data()?.displayName as string | undefined) ?? 'A tribute';
  const game = gameSnap.data() as Game | undefined;

  await updateDoc(memberRef, { out: false, outAt: null, cause: deleteField() });

  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.BROADCASTS, `${userId}_death`)).catch(() => {});

  await addDoc(collection(db, Collections.GAMES, gameId, Collections.BROADCASTS), {
    kind: 'gm-message',
    message: `${name} is back in the game.`,
    targetPlayerId: null,
    createdAt: serverTimestamp(),
  });

  if (gamePhase(game) === 'results' && game?.status === 'ended') {
    await updateDoc(gameRef, { phase: 'play', status: 'active', endedAt: null });
  }
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

/**
 * Send a GM↔GM (co-GM) message (#40): a broadcast readable only by GMs, via the
 * `GM_BROADCAST_TARGET` sentinel + `audience: 'gm-only'` (enforced in firestore.rules).
 * GM↔GM only — there is no player↔player channel (Rule 23).
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

/** Subscribe to a game's co-GM messages (#40), newest first. GM-only (firestore.rules). */
export function subscribeGmMessages(
  gameId: string,
  onChange: (messages: Broadcast[]) => void
): () => void {
  const q = query(
    collection(db, Collections.GAMES, gameId, Collections.BROADCASTS),
    where('audience', '==', 'gm-only')
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Broadcast)
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      onChange(msgs);
    },
    (err) => console.error('[GmMessages] subscription error', err)
  );
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
  // Drop any paired timed reveal row (#60) so a deleted checkpoint can't be revealed.
  await deleteDoc(
    doc(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS, `reveal_${checkpointId}`)
  ).catch(() => {});
  // Cascade-delete the checkpoint's runbook entries so none are left dangling (#60).
  const entries = await getDocs(
    query(runbookCol(gameId), where('checkpointId', '==', checkpointId))
  );
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
): Promise<string> {
  const ref = await addDoc(runbookCol(gameId), { ...entry, createdAt: serverTimestamp() });
  return ref.id;
}

/** Update a runbook entry. Pass `deleteField()` to drop trigger-specific fields. */
export async function updateRunbookEntry(
  gameId: string,
  entryId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await updateDoc(
    doc(db, Collections.GAMES, gameId, Collections.RUNBOOK, entryId),
    updates as UpdateData<DocumentData>
  );
}

export async function deleteRunbookEntry(gameId: string, entryId: string): Promise<void> {
  await deleteDoc(doc(db, Collections.GAMES, gameId, Collections.RUNBOOK, entryId));
}

/**
 * Fire a `gm-prompted` runbook entry now (#60): the GM picks target player(s). Runs
 * server-side (the fireRunbookEntry callable) so it can push to players. Omit
 * `targetPlayerIds` to deliver to every living player.
 */
export async function fireRunbookEntry(
  gameId: string,
  entryId: string,
  targetPlayerIds?: string[]
): Promise<void> {
  const callable = httpsCallable(functions, 'fireRunbookEntry');
  await callable({ gameId, entryId, targetPlayerIds: targetPlayerIds ?? null });
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
