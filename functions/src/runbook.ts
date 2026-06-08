import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';

// Fire a `gm-prompted` runbook entry on demand (ROADMAP #60). The GM taps an entry in the
// dashboard and (optionally) picks target players; this resolves the entry server-side,
// writes the player-facing broadcast(s), pushes the recipients + a GM confirmation, and
// latches `firedAt` for the results view. Runs as a callable so the client can't push FCM
// directly and the GM role is verified server-side.

type CheckpointKind = 'hazard' | 'boon' | 'gm-notify' | 'notify';
type NotifyAudience = 'crossing-player' | 'all-players';
interface RunbookEffect {
  kind: CheckpointKind;
  message?: string;
  audience?: NotifyAudience;
}

const KIND_TITLES: Record<CheckpointKind, string> = {
  hazard: '⚠️ Hazard!',
  boon: '✨ A boon',
  notify: '📢 Message',
  'gm-notify': '📍 Update',
};

/** All GM FCM tokens for a game. */
async function getGmTokens(db: admin.firestore.Firestore, gameId: string): Promise<string[]> {
  const snap = await db
    .collection('games').doc(gameId).collection('members')
    .where('role', '==', 'gm').get();
  return snap.docs
    .map((d) => d.data().fcmToken as string | undefined)
    .filter((t): t is string => !!t);
}

export const fireRunbookEntry = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  const uid = context.auth.uid;
  const gameId = String(data?.gameId ?? '').trim();
  const entryId = String(data?.entryId ?? '').trim();
  const rawTargets = Array.isArray(data?.targetPlayerIds) ? data.targetPlayerIds : null;
  const targetPlayerIds: string[] | null = rawTargets
    ? rawTargets.map((t: unknown) => String(t)).filter(Boolean)
    : null;

  if (!gameId || !entryId) {
    throw new functions.https.HttpsError('invalid-argument', 'A game id and entry id are required.');
  }

  const db = admin.firestore();
  const gameRef = db.collection('games').doc(gameId);

  // Verify the caller is a GM of this game.
  const memberSnap = await gameRef.collection('members').doc(uid).get();
  if (!memberSnap.exists || memberSnap.data()?.role !== 'gm') {
    throw new functions.https.HttpsError('permission-denied', 'Only a Game Master can fire a runbook entry.');
  }

  const entryRef = gameRef.collection('runbook').doc(entryId);
  const entrySnap = await entryRef.get();
  if (!entrySnap.exists) {
    throw new functions.https.HttpsError('not-found', 'That runbook entry no longer exists.');
  }
  const entry = entrySnap.data() as { trigger?: string; effect?: RunbookEffect };
  if (entry.trigger !== 'gm-prompted') {
    throw new functions.https.HttpsError('failed-precondition', 'Only GM-prompted entries can be fired manually.');
  }
  const effect = entry.effect;
  if (!effect || !effect.kind) {
    throw new functions.https.HttpsError('failed-precondition', 'That entry has no effect to deliver.');
  }

  const title = KIND_TITLES[effect.kind] ?? '📍 Update';
  const body = effect.message || title;

  // Resolve recipients: explicit targets, else every living player.
  const membersSnap = await gameRef.collection('members').get();
  const livingPlayers = membersSnap.docs
    .map((d) => ({ id: d.id, data: d.data() as admin.firestore.DocumentData }))
    .filter((m) => m.data.role !== 'gm' && !m.data.out);

  const recipients =
    targetPlayerIds && targetPlayerIds.length > 0
      ? livingPlayers.filter((m) => targetPlayerIds.includes(m.id))
      : livingPlayers;

  const work: Promise<unknown>[] = [];

  if (effect.kind === 'gm-notify') {
    // GM-only: no player-facing broadcast; just confirm to the GMs.
    const gmTokens = await getGmTokens(db, gameId);
    work.push(sendPushToTokens(gmTokens, title, body, 'arrivals'));
  } else if (targetPlayerIds == null && effect.kind === 'notify' && effect.audience === 'all-players') {
    // A true all-players announcement → one global broadcast.
    work.push(
      gameRef.collection('broadcasts').add({
        kind: 'checkpoint-event',
        eventKind: effect.kind,
        message: body,
        targetPlayerId: null,
        pushed: true, // #69: pushed below, so onBroadcastCreate skips it
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    const tokens = recipients
      .map((m) => m.data.fcmToken as string | undefined)
      .filter((t): t is string => !!t);
    work.push(sendPushToTokens(tokens, title, body, 'broadcasts'));
  } else {
    // Targeted delivery: one broadcast + push per recipient.
    for (const m of recipients) {
      work.push(
        gameRef.collection('broadcasts').add({
          kind: 'checkpoint-event',
          eventKind: effect.kind,
          message: body,
          targetPlayerId: m.id,
          pushed: true, // #69: pushed below, so onBroadcastCreate skips it
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      );
      const token = m.data.fcmToken as string | undefined;
      if (token) work.push(sendPushToTokens([token], title, body, 'broadcasts'));
    }
  }

  // Latch firedAt for the results view / idempotency context (#60).
  work.push(entryRef.update({ firedAt: admin.firestore.FieldValue.serverTimestamp() }));

  await Promise.allSettled(work);
  return { fired: true, recipients: recipients.length };
});
