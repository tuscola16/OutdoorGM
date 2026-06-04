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

    // All best-effort and independent — run in parallel. `force` on deleteFiles keeps
    // going past any individual error; absent photos/subcollections are fine.
    await Promise.allSettled([
      admin.storage().bucket().deleteFiles({ prefix: `games/${gameId}/rations/`, force: true }),
      db.recursiveDelete(gameRef.collection('locations')),
      db.recursiveDelete(gameRef.collection('arrivals')),
    ]);

    functions.logger.info(
      `[cleanupOnGameEnd] cleared ration photos + location/arrival data for ended game ${gameId}`
    );
  });
