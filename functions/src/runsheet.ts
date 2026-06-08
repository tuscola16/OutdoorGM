import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';
import { projectMarker, resolveRevealAudience, CheckpointDoc } from './markers';

// The run-sheet (ROADMAP #11): a GM authors timed actions on
// games/{gameId}/scheduledEvents; this function sweeps every minute for due,
// unfired actions and executes them, stamping `firedAt` so each fires exactly once.

type ScheduledActionType =
  | 'broadcast'
  | 'reveal-checkpoint'
  | 'gear-drop'
  | 'gm-reminder';

interface ScheduledEventData {
  type: ScheduledActionType;
  offsetMinutes?: number | null;
  fireAt?: admin.firestore.Timestamp | null;
  checkpointId?: string;
  message?: string;
  template?: 'player-count' | null;
  firedAt?: admin.firestore.Timestamp | null;
}

export const runScheduledEvents = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async () => {
    const db = admin.firestore();
    const nowMs = Date.now();

    // All unfired run-sheet rows across every game (a single collection-group read).
    const pending = await db
      .collectionGroup('scheduledEvents')
      .where('firedAt', '==', null)
      .get();
    if (pending.empty) return null;

    // Cache parent game docs so we resolve each game's startedAt/status once.
    const gameCache = new Map<string, admin.firestore.DocumentData | null>();
    const getGame = async (gameId: string) => {
      if (!gameCache.has(gameId)) {
        const snap = await db.collection('games').doc(gameId).get();
        gameCache.set(gameId, snap.exists ? (snap.data() as admin.firestore.DocumentData) : null);
      }
      return gameCache.get(gameId) ?? null;
    };

    await Promise.all(
      pending.docs.map(async (evDoc) => {
        const gameRef = evDoc.ref.parent.parent;
        if (!gameRef) return;
        const gameId = gameRef.id;
        const game = await getGame(gameId);
        // Only fire for a running game (an ended/abandoned game's run-sheet is inert).
        if (!game || game.status !== 'active') return;

        const ev = evDoc.data() as ScheduledEventData;

        // Resolve the absolute fire time: explicit fireAt, else startedAt + offset.
        let fireMs: number | null = null;
        if (ev.fireAt && typeof ev.fireAt.toMillis === 'function') {
          fireMs = ev.fireAt.toMillis();
        } else if (typeof ev.offsetMinutes === 'number') {
          const startedMs = game.startedAt?.toMillis?.() ?? null;
          if (startedMs == null) return; // an offset can't resolve before the game starts
          fireMs = startedMs + ev.offsetMinutes * 60_000;
        }
        if (fireMs == null || nowMs < fireMs) return; // not due yet

        // Claim atomically so overlapping sweeps can't double-execute: only the run
        // that flips firedAt from null proceeds to the side effects.
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(evDoc.ref);
          if (!fresh.exists || fresh.data()?.firedAt != null) return false;
          tx.update(evDoc.ref, { firedAt: admin.firestore.FieldValue.serverTimestamp() });
          return true;
        });
        if (!claimed) return;

        try {
          await executeAction(db, gameId, ev);
        } catch (err) {
          console.error(`[runsheet] action failed (game ${gameId}, type ${ev.type})`, err);
        }
      })
    );

    return null;
  });

async function executeAction(
  db: admin.firestore.Firestore,
  gameId: string,
  ev: ScheduledEventData
): Promise<void> {
  const gameRef = db.collection('games').doc(gameId);

  // Reveal a checkpoint marker to players at a scheduled game-time (#60 timed reveal). Project
  // the marker (label + location only) for the configured audience and latch revealedAt.
  if (ev.type === 'reveal-checkpoint') {
    if (!ev.checkpointId) return;
    const cpRef = gameRef.collection('checkpoints').doc(ev.checkpointId);
    const cpSnap = await cpRef.get();
    if (!cpSnap.exists) return;
    const cp = cpSnap.data() as CheckpointDoc;
    const audience = resolveRevealAudience(cp.reveal); // no triggerer for a timed reveal
    await projectMarker(db, gameId, ev.checkpointId, cp, audience);
    await cpRef.update({
      revealedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(audience && audience.length > 0
        ? { revealedTo: admin.firestore.FieldValue.arrayUnion(...audience) }
        : {}),
    });
    const gmTokens = await getGmTokens(db, gameId);
    await sendPushToTokens(
      gmTokens,
      '👁️ Marker revealed',
      `${cp.name ?? 'A site'} is now visible to players.`
    );
    return;
  }

  // GM-only nudge — push to GMs, no player-facing broadcast.
  if (ev.type === 'gm-reminder') {
    const gmTokens = await getGmTokens(db, gameId);
    await sendPushToTokens(gmTokens, '⏰ Reminder', ev.message || 'Run-sheet reminder');
    return;
  }

  // broadcast / gear-drop → write a player-facing Broadcast and push living players.
  let message = ev.message || '';
  let kind = 'gm-message';
  if (ev.template === 'player-count') {
    const count = await countLivingPlayers(db, gameId);
    message = `${count} tribute${count === 1 ? '' : 's'} remain`;
    kind = 'player-count';
  }
  if (!message) return;

  await gameRef.collection('broadcasts').add({
    kind,
    message,
    targetPlayerId: null,
    pushed: true, // #69: pushed below, so onBroadcastCreate skips it
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const tokens = await getLivingPlayerTokens(db, gameId);
  await sendPushToTokens(
    tokens,
    ev.type === 'gear-drop' ? '🎁 Gear drop' : '📢 Announcement',
    message,
    'broadcasts'
  );
}

/** All GM FCM tokens for a game. */
async function getGmTokens(db: admin.firestore.Firestore, gameId: string): Promise<string[]> {
  const snap = await db
    .collection('games')
    .doc(gameId)
    .collection('members')
    .where('role', '==', 'gm')
    .get();
  return snap.docs
    .map((d) => d.data().fcmToken as string | undefined)
    .filter((t): t is string => !!t);
}

/** All living (non-out) player FCM tokens for a game. */
async function getLivingPlayerTokens(
  db: admin.firestore.Firestore,
  gameId: string
): Promise<string[]> {
  const snap = await db.collection('games').doc(gameId).collection('members').get();
  return snap.docs
    .map((d) => d.data())
    .filter((m) => m.role !== 'gm' && !m.out)
    .map((m) => m.fcmToken as string | undefined)
    .filter((t): t is string => !!t);
}

/** Count of living (non-out) players. */
async function countLivingPlayers(
  db: admin.firestore.Firestore,
  gameId: string
): Promise<number> {
  const snap = await db.collection('games').doc(gameId).collection('members').get();
  return snap.docs.map((d) => d.data()).filter((m) => m.role !== 'gm' && !m.out).length;
}
