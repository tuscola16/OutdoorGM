import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Clean up a game's transient, location-bearing data when it ends — on the
 * `play → ended` transition. Two reasons:
 *   • **Ration photos** (Rules 6–9) only matter during play (they prove a player ate),
 *     so once the game is over there's nothing left to verify; clearing them keeps
 *     Storage from accumulating a season of meal photos.
 *   • **Location & arrival data** (#30) is a privacy/retention liability for a
 *     location-tracking app and would otherwise persist forever for every finished
 *     game. `locations/*` (each player's last GPS fix + name) and `arrivals/*`
 *     (checkpoint crossings with coordinates) are deleted here. Neither is shown on
 *     the results screens (which read member docs), so removing them is safe.
 *
 * Doing this on the end transition (instead of a scheduled job) needs no Cloud
 * Scheduler. Games are only deletable before they start (see deleteGame), so an
 * ended game is the single path that can have leftover data to clear.
 *
 * NOTE: the function keeps its original deployed name to avoid orphaning a deployed
 * trigger, even though it now purges more than ration photos.
 */
export const cleanupRationPhotosOnGameEnd = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // endGame() stamps status:'ended'. Act only on the transition into it, so the
    // many other game-doc updates (config edits, phase steps) are no-ops.
    if (after?.status !== 'ended' || before?.status === 'ended') return;

    const { gameId } = context.params;
    const db = admin.firestore();
    const gameRef = db.collection('games').doc(gameId);

    // #43: a practice game is disposable — when it ends, delete the whole thing (doc + all
    // subcollections) and its Storage photos, so a season of throwaway rehearsals doesn't
    // accumulate. This supersedes the targeted cleanup below.
    if (after?.practice === true) {
      functions.logger.info(`[cleanupOnGameEnd] practice game ${gameId} ended — deleting it entirely`);
      await Promise.allSettled([
        admin.storage().bucket().deleteFiles({ prefix: `games/${gameId}/`, force: true }),
        db.recursiveDelete(gameRef),
      ]);
      return;
    }

    // #28 Audit trail: log every game-end (a fleet-wide destructive transition) at the
    // single chokepoint they all flow through — GM-initiated End Game *and* winner-detection
    // auto-end both land here on `status → ended`. (The Firestore trigger carries no auth
    // context, so we log the transition fact, not the actor.)
    functions.logger.info(`[audit] game ${gameId} ended — destructive transition (phase ${before?.phase ?? '?'} → results)`, {
      gameId,
      name: after?.name ?? null,
      endedAt: after?.endedAt ?? null,
    });

    // All best-effort and independent — run in parallel. `force` on deleteFiles keeps
    // going past any individual error; absent photos/subcollections are fine.
    await Promise.allSettled([
      admin.storage().bucket().deleteFiles({ prefix: `games/${gameId}/rations/`, force: true }),
      // #42 arena overlay — a GM-uploaded image of up to 15 MB per game. Nothing renders it
      // after the game ends, and no other path deletes it, so without this every finished
      // game leaves its overlay in Storage permanently.
      admin.storage().bucket().deleteFiles({ prefix: `games/${gameId}/overlay/`, force: true }),
      db.recursiveDelete(gameRef.collection('locations')),
      db.recursiveDelete(gameRef.collection('arrivals')),
      // Per-player crossing/entry latches (#50/#55/#67) — transient, tied to play.
      db.recursiveDelete(gameRef.collection('checkpointTrips')),
      db.recursiveDelete(gameRef.collection('entryTrips')),
      // Per-window ration-open push latches (#72) — transient, tied to play.
      db.recursiveDelete(gameRef.collection('rationWindowPings')),
      // Per-interval auto-starvation sweep latches (#11) — transient, tied to play.
      db.recursiveDelete(gameRef.collection('starvationSweeps')),
    ]);

    functions.logger.info(
      `[cleanupOnGameEnd] cleared ration photos + location/arrival data for ended game ${gameId}`
    );
  });
