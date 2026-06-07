import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';
import { projectMarker, resolveRevealAudience, CheckpointDoc } from './markers';

// The run-sheet (ROADMAP #11): a GM authors timed actions on
// games/{gameId}/scheduledEvents; this function sweeps every minute for due,
// unfired actions and executes them, stamping `firedAt` so each fires exactly once.

type ScheduledActionType =
  | 'broadcast'
  | 'open-site'
  | 'close-site'
  | 'reveal-checkpoint'
  | 'gear-drop'
  | 'gm-reminder';

// Mirror of CheckpointState / CheckpointTransition from types/index.ts (#54).
type CheckpointState = 'closed' | 'boon' | 'hazard' | 'notification';
interface CheckpointTransition {
  atMinute: number;
  state: CheckpointState;
  message?: string;
}

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

    // Apply time-based checkpoint state transitions (#54) alongside the run-sheet sweep.
    await applyCheckpointTransitions(db, nowMs);

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

  // Open / close a timed site (#12) by writing its window, then tell the GMs.
  if (ev.type === 'open-site' || ev.type === 'close-site') {
    if (!ev.checkpointId) return;
    const cpRef = gameRef.collection('checkpoints').doc(ev.checkpointId);
    if (ev.type === 'open-site') {
      await cpRef.update({
        opensAt: admin.firestore.FieldValue.serverTimestamp(),
        closesAt: admin.firestore.FieldValue.delete(),
      });
    } else {
      await cpRef.update({ closesAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    const cpName = (await cpRef.get()).data()?.name ?? 'a site';
    const gmTokens = await getGmTokens(db, gameId);
    await sendPushToTokens(
      gmTokens,
      ev.type === 'open-site' ? '🟢 Site opened' : '🔴 Site closed',
      `${cpName} is now ${ev.type === 'open-site' ? 'open' : 'closed'}.`
    );
    return;
  }

  // Reveal a checkpoint marker to players at a scheduled game-time (#48 case B/D). Project
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

/**
 * Apply time-based checkpoint state transitions (#54). For each running game, reads
 * all checkpoints with a `transitions` array and applies the latest transition whose
 * `atMinute ≤ elapsed game time`. Writes `currentState` + adjusts `event`/window only
 * when the state actually changes — idempotent under repeated sweeps (#26).
 */
async function applyCheckpointTransitions(
  db: admin.firestore.Firestore,
  nowMs: number
): Promise<void> {
  const gamesSnap = await db
    .collection('games')
    .where('status', '==', 'active')
    .where('phase', '==', 'play')
    .get();
  if (gamesSnap.empty) return;

  await Promise.allSettled(
    gamesSnap.docs.map(async (gameDoc) => {
      const game = gameDoc.data();
      const startedMs = game.startedAt?.toMillis?.() ?? null;
      if (startedMs == null) return;
      const elapsedMinutes = (nowMs - startedMs) / 60_000;

      const cpsSnap = await db
        .collection('games').doc(gameDoc.id).collection('checkpoints').get();

      await Promise.allSettled(
        cpsSnap.docs.map(async (cpDoc) => {
          const cp = cpDoc.data();
          const transitions = cp.transitions as CheckpointTransition[] | undefined;
          if (!Array.isArray(transitions) || transitions.length === 0) return;

          // Find the latest applicable transition.
          const applicable = transitions
            .filter((t) => t.atMinute <= elapsedMinutes)
            .sort((a, b) => b.atMinute - a.atMinute);
          if (applicable.length === 0) return;
          const target = applicable[0];

          // Idempotent: skip if the stored currentState already matches.
          if (cp.currentState === target.state) return;

          const update: Record<string, unknown> = { currentState: target.state };

          if (target.state === 'closed') {
            // Close the site window so the geofence ignores it.
            update.closesAt = admin.firestore.FieldValue.serverTimestamp();
          } else {
            // Map CheckpointState → CheckpointKind and open the window.
            const kindMap: Record<Exclude<CheckpointState, 'closed'>, string> = {
              boon: 'boon',
              hazard: 'hazard',
              notification: 'player-notify',
            };
            update.event = {
              kind: kindMap[target.state as Exclude<CheckpointState, 'closed'>],
              ...(target.message ? { message: target.message } : {}),
            };
            update.opensAt = admin.firestore.FieldValue.serverTimestamp();
            update.closesAt = admin.firestore.FieldValue.delete();
          }

          await cpDoc.ref.update(update);
        })
      );
    })
  );
}
