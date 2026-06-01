import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';

interface MemberData {
  userId?: string;
  role?: 'player' | 'gm';
  displayName?: string;
  fcmToken?: string;
  out?: boolean;
  sos?: boolean;
}

/** Did a boolean flag flip from falsy → true between two member snapshots? */
function rose(before: MemberData | undefined, after: MemberData | undefined, key: 'out' | 'sos'): boolean {
  return !!after?.[key] && !before?.[key];
}

/**
 * Server-authoritative reactions to a member doc changing:
 *  - A player became `out` → write a "death" broadcast and, if only one living
 *    player remains and winnerDetection is on, declare a winner + end the game
 *    (Rules 1, 2, 8, 16).
 *  - A player raised `sos` → push the alert to all GMs (Rules 22, 27, 28).
 * Runs regardless of whether the player self-reported or a GM eliminated them.
 */
export const onMemberWrite = functions.firestore
  .document('games/{gameId}/members/{userId}')
  .onWrite(async (change, context) => {
    const { gameId } = context.params;
    const before = change.before.exists ? (change.before.data() as MemberData) : undefined;
    const after = change.after.exists ? (change.after.data() as MemberData) : undefined;
    if (!after) return; // member removed — nothing to announce

    const db = admin.firestore();
    const gameRef = db.collection('games').doc(gameId);

    if (rose(before, after, 'out') && after.role !== 'gm') {
      await handleDeath(gameRef, after);
    }

    if (rose(before, after, 'sos')) {
      await handleSos(gameRef, after);
    }
  });

async function handleDeath(
  gameRef: FirebaseFirestore.DocumentReference,
  player: MemberData
): Promise<void> {
  const membersSnap = await gameRef.collection('members').get();
  const players = membersSnap.docs
    .map((d) => d.data() as MemberData)
    .filter((m) => m.role !== 'gm');
  const living = players.filter((m) => !m.out);
  const livingCount = living.length;

  const name = player.displayName ?? 'A tribute';
  await gameRef.collection('broadcasts').add({
    kind: 'death',
    message: `${name} has fallen — ${livingCount} ${livingCount === 1 ? 'tribute remains' : 'tributes remain'}.`,
    targetPlayerId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Push the toll to all living players.
  const livingTokens = living.map((m) => m.fcmToken).filter((t): t is string => !!t);
  await sendPushToTokens(livingTokens, '☠️ A tribute has fallen', `${livingCount} remaining`, 'broadcasts');

  // Winner detection (Rule 1). Off if disabled in config or 0/many remain.
  const gameSnap = await gameRef.get();
  const cfg = (gameSnap.data()?.config ?? {}) as { winnerDetection?: boolean };
  const winnerDetection = cfg.winnerDetection !== false; // default on
  if (winnerDetection && livingCount === 1) {
    const winner = living[0];
    await gameRef.collection('broadcasts').add({
      kind: 'winner',
      message: `${winner.displayName ?? 'The last tribute'} is the winner! 🏆`,
      targetPlayerId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await gameRef.update({
      phase: 'results',
      status: 'ended',
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

async function handleSos(
  gameRef: FirebaseFirestore.DocumentReference,
  player: MemberData
): Promise<void> {
  const gmsSnap = await gameRef.collection('members').where('role', '==', 'gm').get();
  const gmTokens = gmsSnap.docs
    .map((d) => (d.data() as MemberData).fcmToken)
    .filter((t): t is string => !!t);
  const name = player.displayName ?? 'A player';
  await sendPushToTokens(gmTokens, '🆘 Safety alert', `${name} needs assistance`, 'arrivals');
}
