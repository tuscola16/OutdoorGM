import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Player-visible checkpoint markers (ROADMAP #48). The `checkpoints` collection is
// GM-only-readable — it holds every objective's coordinates and its secret event
// payload. To let players see *some* checkpoints (from the start, on a timer, on a GM
// tap, or on crossing) without exposing the rest, the server projects a revealed
// checkpoint into a separate, player-readable `markers` collection carrying ONLY the
// label + location. This module owns that projection and is reused by the geofence
// (player-crossing reveals), the run-sheet (timed reveals), and Start Game ('shown').

// Mirror of the relevant shared types (functions/ can't import the RN/web types).
type CheckpointVisibility = 'hidden' | 'shown' | 'shown-on-trigger';
type RevealAudience = 'all' | 'specific-players' | 'triggerer';
interface CheckpointReveal {
  trigger?: 'player' | 'gm' | 'timed';
  audience?: RevealAudience;
  recipientPlayerIds?: string[];
}
export interface CheckpointDoc {
  name?: string;
  latitude?: number;
  longitude?: number;
  visibility?: CheckpointVisibility;
  reveal?: CheckpointReveal;
}

/**
 * Resolve the player audience for a reveal into the `markers` doc's `audiencePlayerIds`:
 * `null` = visible to everyone; an array = only those uids. `triggerer` needs the
 * crossing player's id (geofence path); `timed`/`gm` use `recipientPlayerIds`.
 */
export function resolveRevealAudience(
  reveal: CheckpointReveal | undefined,
  triggererId?: string
): string[] | null {
  const aud = reveal?.audience ?? 'all';
  if (aud === 'specific-players') return reveal?.recipientPlayerIds ?? [];
  if (aud === 'triggerer') return triggererId ? [triggererId] : [];
  return null; // 'all' (and the 'always' visibility default)
}

/**
 * Project a now-visible checkpoint into the player-readable `markers` collection. The
 * marker carries only the label + location (never the secret `event` payload), so case C
 * ("see it, but not what it does") holds. `audiencePlayerIds === null` makes it visible
 * to all; an array restricts it. Per-player reveals merge (arrayUnion) so a later
 * triggerer/recipient is added without dropping earlier ones. Doc id = checkpointId, so
 * re-revealing is idempotent.
 */
export async function projectMarker(
  db: admin.firestore.Firestore,
  gameId: string,
  checkpointId: string,
  cp: CheckpointDoc,
  audiencePlayerIds: string[] | null
): Promise<void> {
  if (cp.latitude == null || cp.longitude == null) return;
  const ref = db.collection('games').doc(gameId).collection('markers').doc(checkpointId);
  const base = {
    checkpointId,
    name: cp.name ?? 'Marker',
    latitude: cp.latitude,
    longitude: cp.longitude,
    revealedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (audiencePlayerIds === null) {
    await ref.set({ ...base, audiencePlayerIds: null }, { merge: true });
  } else if (audiencePlayerIds.length === 0) {
    // A specific-players reveal with no recipients → visible to nobody. (arrayUnion()
    // with zero args throws, so set the empty array directly.)
    await ref.set({ ...base, audiencePlayerIds: [] }, { merge: true });
  } else {
    await ref.set(
      {
        ...base,
        audiencePlayerIds: admin.firestore.FieldValue.arrayUnion(...audiencePlayerIds),
      },
      { merge: true }
    );
  }
}

/** Resolve a game's phase the same way the client does (legacy games → play/results). */
function phaseOf(g: admin.firestore.DocumentData | undefined): string {
  return (g?.phase as string) ?? (g?.status === 'ended' ? 'results' : 'play');
}

// Auto per-interval "N remaining" broadcast (#12). Defaults mirror BASE_GAME_CONFIG
// (types/index.ts), which functions/ can't import.
const DEFAULT_DURATION_MIN = 210;
const DEFAULT_INTERVAL_MIN = 30;
const MAX_AUTO_COUNT_ROWS = 50; // sanity cap on a misconfigured (tiny-interval) game

/**
 * Seed one repeating `template: 'player-count'` run-sheet row per ration interval (#12) when
 * the `playerCountBroadcast` toggle is on, so the GM needn't hand-add a scheduled-announcement
 * row each interval. The `runScheduledEvents` sweep then fires each at its offset, filling in
 * the living-tribute count (Rule 24). Rows use deterministic ids so a Start retry (or a
 * reopen→restart) overwrites rather than duplicating, and re-arms `firedAt` for the new run.
 */
async function seedPlayerCountBroadcasts(
  db: admin.firestore.Firestore,
  gameId: string,
  config: admin.firestore.DocumentData | undefined
): Promise<void> {
  // Toggle defaults ON (BASE_GAME_CONFIG.playerCountBroadcast), so a legacy/no-config game
  // gets the base-rules behavior; only an explicit `false` opts out.
  if (config?.playerCountBroadcast === false) return;

  const durationMin = Number(config?.durationMinutes) > 0
    ? Number(config?.durationMinutes) : DEFAULT_DURATION_MIN;
  const intervalMin = Number(config?.rationIntervalMinutes) > 0
    ? Number(config?.rationIntervalMinutes) : DEFAULT_INTERVAL_MIN;
  if (intervalMin <= 0 || durationMin <= 0) return;

  const eventsCol = db.collection('games').doc(gameId).collection('scheduledEvents');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();

  // Clear any auto rows from a prior run/seed so a changed duration/interval can't leave
  // stale rows behind (the deterministic ids below also overwrite, but a shrink would
  // otherwise orphan the now-excess rows). GM-authored rows (no `auto` marker) are untouched.
  const existingAuto = await eventsCol.where('auto', '==', 'player-count').get();
  for (const d of existingAuto.docs) batch.delete(d.ref);

  let seeded = 0;
  for (let k = 1; k * intervalMin < durationMin && seeded < MAX_AUTO_COUNT_ROWS; k++) {
    // Deterministic id → idempotent across retries / re-starts.
    const ref = eventsCol.doc(`auto_playercount_${k}`);
    batch.set(ref, {
      type: 'broadcast',
      template: 'player-count',
      offsetMinutes: k * intervalMin,
      message: '',
      auto: 'player-count', // marks rows the GM didn't hand-author (#12)
      firedAt: null,
      createdAt: now,
    });
    seeded++;
  }
  await batch.commit();
}

/**
 * On Start Game (the lobby → play transition):
 * 1. Delete stale marker docs for checkpoints that are NOT `'shown'` — a marker
 *    left over from a prior run would appear immediately (#60, formerly #48).
 * 2. Project every `visibility: 'shown'` checkpoint into `markers` so players see
 *    those named locations from kickoff. `shown-on-trigger` checkpoints are projected
 *    later by their trigger; `hidden` never are.
 */
export const onGameStartProjectMarkers = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    if (phaseOf(change.after.data()) !== 'play' || phaseOf(change.before.data()) === 'play') {
      return; // only on the transition into play
    }
    const { gameId } = context.params;
    const db = admin.firestore();

    // #12: seed the auto per-interval "N remaining" run-sheet rows for this run.
    await seedPlayerCountBroadcasts(db, gameId, change.after.data()?.config);

    const cps = await db.collection('games').doc(gameId).collection('checkpoints').get();

    // Delete any existing marker docs for non-'shown' checkpoints. A stale marker
    // from a previous run of the same game would otherwise show up at Start (#60).
    const shownIds = new Set(
      cps.docs
        .filter((d) => (d.data() as CheckpointDoc).visibility === 'shown')
        .map((d) => d.id)
    );
    const existingMarkers = await db
      .collection('games').doc(gameId).collection('markers').get();
    await Promise.allSettled(
      existingMarkers.docs
        .filter((d) => !shownIds.has(d.id))
        .map((d) => d.ref.delete())
    );

    // Project 'shown' checkpoints so players see them from kickoff.
    await Promise.allSettled(
      cps.docs
        .filter((d) => (d.data() as CheckpointDoc).visibility === 'shown')
        .map((d) => projectMarker(db, gameId, d.id, d.data() as CheckpointDoc, null))
    );
  });
