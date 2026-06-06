import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Player-visible checkpoint markers (ROADMAP #48). The `checkpoints` collection is
// GM-only-readable — it holds every objective's coordinates and its secret event
// payload. To let players see *some* checkpoints (from the start, on a timer, on a GM
// tap, or on crossing) without exposing the rest, the server projects a revealed
// checkpoint into a separate, player-readable `markers` collection carrying ONLY the
// label + location. This module owns that projection and is reused by the geofence
// (on-crossing reveals), the run-sheet (game-time reveals), and Start Game ('always').

// Mirror of the relevant shared types (functions/ can't import the RN/web types).
type CheckpointVisibility = 'gm-only' | 'always' | 'on-reveal';
type RevealAudience = 'all' | 'specific-players' | 'triggerer';
interface CheckpointReveal {
  trigger?: 'game-time' | 'gm-manual' | 'on-crossing';
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
 * crossing player's id (geofence path); `game-time`/`gm-manual` use `recipientPlayerIds`.
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

/**
 * On Start Game (the lobby → play transition), project every `visibility: 'always'`
 * checkpoint into `markers` so players see those named locations from kickoff (case C).
 * `on-reveal` checkpoints are projected later by their trigger; `gm-only` never are.
 */
export const onGameStartProjectMarkers = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    if (phaseOf(change.after.data()) !== 'play' || phaseOf(change.before.data()) === 'play') {
      return; // only on the transition into play
    }
    const { gameId } = context.params;
    const db = admin.firestore();
    const cps = await db.collection('games').doc(gameId).collection('checkpoints').get();
    await Promise.allSettled(
      cps.docs
        .filter((d) => (d.data() as CheckpointDoc).visibility === 'always')
        .map((d) => projectMarker(db, gameId, d.id, d.data() as CheckpointDoc, null))
    );
  });
