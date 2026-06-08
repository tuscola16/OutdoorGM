import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Auto-starvation sweep (ROADMAP #11). At each ration-interval boundary, a living player
// with no non-rejected ration for the *just-closed* interval is auto-eliminated
// (cause: 'starvation') — but ONLY when the game opted into `starvationMode: 'auto'`.
// The default `'gm-confirmed'` keeps elimination manual (the GM eliminates missed players by
// hand from the Players list), so this is harmless until a GM turns it on.
//
// Mirrors rationPings.ts: a per-minute sweep over play-phase games with an idempotent
// per-interval latch (games/{id}/starvationSweeps/{intervalIndex}) so overlapping sweeps
// don't double-run and each interval is evaluated exactly once. Eliminating a player only
// flips `member.out`/`outAt`/`cause`; the death broadcast + winner detection then fire in
// members.ts `onMemberWrite` — this function never duplicates that.

// Config defaults mirror BASE_GAME_CONFIG (the functions package can't import the app's types).
const DEFAULT_DURATION = 210;
const DEFAULT_RATION_INTERVAL = 30;

// Grace after an interval boundary during which we still run the sweep (covers a slightly
// delayed scheduler); the latch prevents a double-run once it has fired.
const BOUNDARY_GRACE_MS = 90_000;

export const starvationSweep = functions.pubsub.schedule('every 1 minutes').onRun(async () => {
  const db = admin.firestore();
  const nowMs = Date.now();

  // Games currently in play (single-field index, auto-created). A play-phase game is active.
  const playing = await db.collection('games').where('phase', '==', 'play').get();
  if (playing.empty) return null;

  await Promise.all(
    playing.docs.map(async (gameDoc) => {
      const game = gameDoc.data();
      const cfg = game.config ?? {};
      if (cfg.rationsEnabled === false) return; // rations off → nothing to starve on
      if (cfg.starvationMode !== 'auto') return; // default 'gm-confirmed' → manual only

      const startedMs = game.startedAt?.toMillis?.() ?? null;
      if (startedMs == null) return;

      const intervalMin = cfg.rationIntervalMinutes ?? DEFAULT_RATION_INTERVAL;
      const durationMin = cfg.durationMinutes ?? DEFAULT_DURATION;
      if (!(intervalMin > 0)) return;

      const intervalMs = intervalMin * 60_000;
      const total = Math.ceil(durationMin / intervalMin);

      // Most recent interval boundary at/just before now. After `k` full intervals have
      // elapsed, the boundary at startedMs + k*intervalMs closed interval i = k-1.
      const k = Math.floor((nowMs - startedMs) / intervalMs);
      const i = k - 1;
      if (i < 0 || i >= total) return; // no interval has closed yet, or past the last one

      const boundaryMs = startedMs + k * intervalMs;
      if (nowMs - boundaryMs > BOUNDARY_GRACE_MS) return; // boundary too long ago — handled/missed

      // Idempotent latch: only the sweep that creates the doc evaluates interval i.
      const latchRef = gameDoc.ref.collection('starvationSweeps').doc(String(i));
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(latchRef);
        if (fresh.exists) return false;
        tx.set(latchRef, {
          intervalIndex: i,
          sweptAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!claimed) return;

      // Living non-GM members with no non-rejected ration for interval i starve. A pending
      // or valid submission survives (benefit of the doubt until the GM reviews); a rejected
      // or absent one does not.
      const membersSnap = await gameDoc.ref.collection('members').get();
      const living = membersSnap.docs
        .map((d) => ({ id: d.id, role: d.data().role as string | undefined, out: !!d.data().out }))
        .filter((m) => m.role !== 'gm' && !m.out);
      if (living.length === 0) return;

      await Promise.all(
        living.map(async (m) => {
          const rationSnap = await gameDoc.ref.collection('rations').doc(`${m.id}_${i}`).get();
          const fed = rationSnap.exists && rationSnap.data()?.status !== 'rejected';
          if (fed) return;
          await gameDoc.ref.collection('members').doc(m.id).update({
            out: true,
            outAt: admin.firestore.FieldValue.serverTimestamp(),
            cause: 'starvation',
          });
        })
      );
    })
  );

  return null;
});
