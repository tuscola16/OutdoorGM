import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';

// Reliable ration-window-open push (ROADMAP #72). The client schedules a *local*
// notification for each window (`hooks/useRationReminders.ts`), but a dozing/locked phone
// delivers those minutes late — risking wrongful starvation. This server sweep is the
// authoritative source: every minute it finds games in `play`, computes whether a ration
// eat-window just opened, and pushes living players **once** (FCM high-priority wakes a
// dozing device). An idempotent latch — `games/{id}/rationWindowPings/{intervalIndex}` —
// guarantees one push per window even across overlapping sweeps. The local notification
// stays as a fast-path fallback (a rare double is harmless).

// Config defaults mirror BASE_GAME_CONFIG (the functions package can't import the app's types).
const DEFAULT_DURATION = 210;
const DEFAULT_RATION_INTERVAL = 30;
const DEFAULT_RATION_WINDOW = 10;

// Grace after a window opens during which we still fire (covers a slightly delayed sweep);
// the latch prevents a double-fire once it has gone out.
const OPEN_GRACE_MS = 90_000;

export const rationPings = functions.pubsub.schedule('every 1 minutes').onRun(async () => {
  const db = admin.firestore();
  const nowMs = Date.now();

  // Games currently in play (single-field index, auto-created). A play-phase game is active.
  const playing = await db.collection('games').where('phase', '==', 'play').get();
  if (playing.empty) return null;

  await Promise.all(
    playing.docs.map(async (gameDoc) => {
      const game = gameDoc.data();
      const cfg = game.config ?? {};
      if (cfg.rationsEnabled === false) return; // default on; explicit off skips

      const startedMs = game.startedAt?.toMillis?.() ?? null;
      if (startedMs == null) return;

      const intervalMin = cfg.rationIntervalMinutes ?? DEFAULT_RATION_INTERVAL;
      const windowMin = cfg.rationWindowMinutes ?? DEFAULT_RATION_WINDOW;
      const durationMin = cfg.durationMinutes ?? DEFAULT_DURATION;
      if (!(intervalMin > 0)) return;

      const intervalMs = intervalMin * 60_000;
      const openMs = Math.min(Math.max(windowMin, 0), intervalMin) * 60_000;
      const total = Math.ceil(durationMin / intervalMin);

      // The most recent window-open boundary at/just before now.
      // openTime(i) = startedMs + (i+1)*intervalMs - openMs
      const i = Math.floor((nowMs - startedMs + openMs) / intervalMs) - 1;
      if (i < 0 || i >= total) return; // nothing opened yet, or past the last window

      const openTime = startedMs + (i + 1) * intervalMs - openMs;
      if (nowMs - openTime > OPEN_GRACE_MS) return; // opened too long ago — missed/already handled

      // Idempotent latch: only the sweep that creates the doc sends the push.
      const latchRef = gameDoc.ref.collection('rationWindowPings').doc(String(i));
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(latchRef);
        if (fresh.exists) return false;
        tx.set(latchRef, {
          intervalIndex: i,
          firedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!claimed) return;

      const tokens = await getLivingPlayerTokens(db, gameDoc.id);
      if (tokens.length === 0) return;
      await sendPushToTokens(
        tokens,
        '🍖 Ration window open',
        'Photograph your ration card before the window closes — or you starve.',
        'broadcasts'
      );
    })
  );

  return null;
});

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
