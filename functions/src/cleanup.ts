import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Delete a game's ration photos (the meal/food picture loop, Rules 6–9) when the
 * game ends. The photos only matter during play — they prove a player ate so they
 * don't starve — so once the game is over there's nothing left to verify. Cleaning
 * up here (on the `play → ended` transition) keeps Storage from accumulating a
 * season of meal photos without needing a scheduled job / Cloud Scheduler.
 *
 * Games are only deletable before they start (see deleteGame), so an ended game is
 * the single path that can have leftover ration photos to clear.
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
    // `force` keeps going past any individual delete error; absent photos are fine.
    await admin
      .storage()
      .bucket()
      .deleteFiles({ prefix: `games/${gameId}/rations/`, force: true });

    functions.logger.info(`[cleanupRationPhotos] cleared ration photos for ended game ${gameId}`);
  });
