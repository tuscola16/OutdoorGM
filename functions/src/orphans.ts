import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

/**
 * Hourly sweep that auto-ends games left with **zero GMs** (ROADMAP #50). A game with
 * no Game Master is unwatched and unwinnable (players can't end it — "no permissions").
 *
 * Prevention — blocking the last GM from removing/demoting themselves — is enforced
 * client-side (the rules can't count collection members). This is the **remediation**
 * for games that are *already* orphaned (e.g. a sole GM who deleted their account, #34).
 *
 * Ending the game (`status: 'ended'`) triggers `cleanupRationPhotosOnGameEnd`, which
 * purges the game's location/arrival data and ration photos (#30). No GM transfer — an
 * orphaned game is simply closed out, not reassigned. createGame writes the game doc and
 * the creator's GM member atomically, so a freshly created game is never falsely swept.
 */
export const sweepOrphanedGames = functions.pubsub
  .schedule('every 60 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const active = await db.collection('games').where('status', '==', 'active').get();
    if (active.empty) return null;

    await Promise.all(
      active.docs.map(async (gameDoc) => {
        const gms = await gameDoc.ref
          .collection('members')
          .where('role', '==', 'gm')
          .limit(1)
          .get();
        if (!gms.empty) return; // still has at least one GM

        await gameDoc.ref.update({
          status: 'ended',
          phase: 'results',
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        functions.logger.info(`[orphans] auto-ended GM-less game ${gameDoc.id}`);
      })
    );
    return null;
  });
