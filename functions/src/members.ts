import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';
import { sendArrivalSMS, TWILIO_SECRETS } from './sms';

interface MemberData {
  userId?: string;
  role?: 'player' | 'gm';
  displayName?: string;
  fcmToken?: string;
  phone?: string;
  out?: boolean;
  sos?: boolean;
}

/** Seconds to wait before crowning a winner, so near-simultaneous deaths (Rule 17,
 * "if blows land simultaneously you are both dead") settle before we re-read the
 * roster. Without this, the first death to fire could crown a player who is dying
 * in the same instant. */
const WINNER_GRACE_MS = 3000;

/** Did a boolean flag flip from falsy → true between two member snapshots? */
function rose(before: MemberData | undefined, after: MemberData | undefined, key: 'out' | 'sos'): boolean {
  return !!after?.[key] && !before?.[key];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Server-authoritative reactions to a member doc changing:
 *  - A player became `out` → write a "death" broadcast and, after a short grace,
 *    re-check the roster in a transaction; if exactly one player is left and the
 *    game is still active, declare a winner + end the game (Rules 1, 2, 8, 16, 17).
 *  - A player raised `sos` → push + SMS the alert to all GMs (Rules 22, 27, 28).
 */
export const onMemberWrite = functions
  // Bind Twilio secrets so the SOS SMS path can read them from process.env (#25).
  .runWith({ secrets: TWILIO_SECRETS })
  .firestore.document('games/{gameId}/members/{userId}')
  .onWrite(async (change, context) => {
    const { gameId } = context.params;
    const before = change.before.exists ? (change.before.data() as MemberData) : undefined;
    const after = change.after.exists ? (change.after.data() as MemberData) : undefined;
    if (!after) return; // member removed — nothing to announce

    const gameRef = admin.firestore().collection('games').doc(gameId);

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
  const db = admin.firestore();

  // Immediate death broadcast + push (informational; count may shift slightly if
  // another death lands during the grace window — that's fine for the toll text).
  const membersSnap = await gameRef.collection('members').get();
  const livingNonGm = membersSnap.docs
    .map((d) => d.data() as MemberData)
    .filter((m) => m.role !== 'gm' && !m.out);
  const livingCount = livingNonGm.length;

  const name = player.displayName ?? 'A tribute';
  await gameRef.collection('broadcasts').add({
    kind: 'death',
    message: `${name} has fallen — ${livingCount} ${livingCount === 1 ? 'tribute remains' : 'tributes remain'}.`,
    targetPlayerId: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const livingTokens = livingNonGm.map((m) => m.fcmToken).filter((t): t is string => !!t);
  await sendPushToTokens(livingTokens, '☠️ A tribute has fallen', `${livingCount} remaining`, 'broadcasts');

  // Winner detection only kicks in once the field could plausibly be down to the
  // last player; skip the expensive grace+transaction otherwise.
  const gameSnap = await gameRef.get();
  const cfg = (gameSnap.data()?.config ?? {}) as { winnerDetection?: boolean };
  if (cfg.winnerDetection === false) return; // default on
  if (livingCount > 1) return;

  // Let simultaneous deaths settle, then decide atomically.
  await sleep(WINNER_GRACE_MS);

  await db.runTransaction(async (t) => {
    const gSnap = await t.get(gameRef);
    if (!gSnap.exists || gSnap.data()?.status === 'ended') return; // already over

    const mSnap = await t.get(gameRef.collection('members'));
    const living = mSnap.docs
      .map((d) => d.data() as MemberData)
      .filter((m) => m.role !== 'gm' && !m.out);

    if (living.length > 1) return; // someone is still standing — not over yet

    const bRef = gameRef.collection('broadcasts').doc();
    if (living.length === 1) {
      t.set(bRef, {
        kind: 'winner',
        message: `${living[0].displayName ?? 'The last tribute'} is the winner! 🏆`,
        targetPlayerId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Zero survivors (e.g. simultaneous final blows, Rule 17) — no winner.
      t.set(bRef, {
        kind: 'winner',
        message: 'All tributes have fallen — there is no winner.',
        targetPlayerId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    t.update(gameRef, {
      phase: 'results',
      status: 'ended',
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

async function handleSos(
  gameRef: FirebaseFirestore.DocumentReference,
  player: MemberData
): Promise<void> {
  const gmsSnap = await gameRef.collection('members').where('role', '==', 'gm').get();
  const gms = gmsSnap.docs.map((d) => d.data() as MemberData);
  const gmTokens = gms.map((m) => m.fcmToken).filter((t): t is string => !!t);
  const gmPhones = gms.map((m) => m.phone).filter((p): p is string => !!p);
  const name = player.displayName ?? 'A player';
  const body = `${name} needs assistance`;
  // Push + SMS in parallel: a muted/asleep phone (Rule 25) shouldn't swallow a
  // safety alert, and Outdoor GM is now the only safety channel (replaces Pingo).
  await Promise.allSettled([
    sendPushToTokens(gmTokens, '🆘 Safety alert', body, 'arrivals'),
    sendArrivalSMS(gmPhones, `SAFETY ALERT: ${body}`),
  ]);
}
