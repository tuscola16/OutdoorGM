/* eslint-disable */
/**
 * ONE-TIME migration: legacy checkpoint behavior → the #60 runbook model.
 *
 * Status: WRITTEN BUT NOT RUN. The #60 milestone chose a "fresh start" — existing
 * games are disposable test data — so this converter is provided for completeness and
 * for anyone who needs to preserve a real game. New code does NOT read the legacy
 * shape, so run this before pointing migrated clients at old data.
 *
 * What it does, per game:
 *   - Renames checkpoint `visibility`  gm-only→hidden, always→shown, on-reveal→shown-on-trigger
 *     and `reveal.trigger`             on-crossing→player, game-time→timed, gm-manual→gm.
 *   - Converts `event`        → one `always-on` runbook entry.
 *   - Converts `eventQueue`   → one `fixed-order` runbook entry (queueSlots).
 *   - Converts `opensAt/closesAt` + `transitions` → `timed` runbook entries.
 *   - Maps effect kinds       player-notify→notify, gm-only→gm-notify.
 *   - Strips the legacy behavior fields from each checkpoint doc.
 *
 * Run (with a service-account key):
 *   GOOGLE_APPLICATION_CREDENTIALS=./sa.json node functions/scripts/migrateRunbook.js
 *   add --dry to preview without writing.
 */
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const DRY = process.argv.includes('--dry');

const KIND_MAP = { hazard: 'hazard', boon: 'boon', 'player-notify': 'notify', 'gm-only': 'gm-notify' };
const VIS_MAP = { 'gm-only': 'hidden', always: 'shown', 'on-reveal': 'shown-on-trigger' };
const TRIGGER_MAP = { 'on-crossing': 'player', 'game-time': 'timed', 'gm-manual': 'gm' };
const STATE_TO_KIND = { boon: 'boon', hazard: 'hazard', notification: 'notify' };

function mapEffect(ev) {
  if (!ev || !ev.kind) return { kind: 'gm-notify' };
  const out = { kind: KIND_MAP[ev.kind] || 'gm-notify' };
  if (ev.message) out.message = ev.message;
  if (out.kind === 'notify' && ev.audience === 'all-players') out.audience = 'all-players';
  return out;
}

async function migrateGame(gameDoc) {
  const gameId = gameDoc.id;
  const cps = await db.collection('games').doc(gameId).collection('checkpoints').get();
  let entriesAdded = 0;

  for (const cpDoc of cps.docs) {
    const cp = cpDoc.data();
    const runbookCol = db.collection('games').doc(gameId).collection('runbook');
    const newEntries = [];

    if (cp.event) {
      newEntries.push({
        checkpointId: cpDoc.id, name: `${cp.name || 'Checkpoint'} — effect`, priority: 0,
        trigger: 'always-on', effect: mapEffect(cp.event),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (Array.isArray(cp.eventQueue) && cp.eventQueue.length > 0) {
      newEntries.push({
        checkpointId: cpDoc.id, name: `${cp.name || 'Checkpoint'} — arrival queue`, priority: 0,
        trigger: 'fixed-order', effect: { kind: 'gm-notify' },
        queueSlots: cp.eventQueue.map((e) => mapEffect(e)),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    // Legacy timed transitions → one `timed` entry per non-closed state.
    if (Array.isArray(cp.transitions) && cp.transitions.length > 0) {
      const sorted = [...cp.transitions].sort((a, b) => a.atMinute - b.atMinute);
      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i];
        if (t.state === 'closed') continue;
        const next = sorted.slice(i + 1).find((x) => true);
        newEntries.push({
          checkpointId: cpDoc.id, name: `${cp.name || 'Checkpoint'} — ${t.state} @${t.atMinute}m`, priority: 0,
          trigger: 'timed',
          effect: { kind: STATE_TO_KIND[t.state] || 'gm-notify', ...(t.message ? { message: t.message } : {}) },
          startAt: { kind: 'time', atMinute: t.atMinute },
          endAt: next ? { kind: 'time', atMinute: next.atMinute } : { kind: 'game-end' },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // Slim the checkpoint doc.
    const update = {
      visibility: VIS_MAP[cp.visibility] || 'hidden',
      event: admin.firestore.FieldValue.delete(),
      eventQueue: admin.firestore.FieldValue.delete(),
      opensAt: admin.firestore.FieldValue.delete(),
      closesAt: admin.firestore.FieldValue.delete(),
      initialState: admin.firestore.FieldValue.delete(),
      transitions: admin.firestore.FieldValue.delete(),
      currentState: admin.firestore.FieldValue.delete(),
      description: admin.firestore.FieldValue.delete(),
    };
    if (cp.reveal && cp.reveal.trigger) {
      update.reveal = { ...cp.reveal, trigger: TRIGGER_MAP[cp.reveal.trigger] || cp.reveal.trigger };
    }

    console.log(`  cp ${cpDoc.id} (${cp.name}): +${newEntries.length} entries, visibility ${cp.visibility}→${update.visibility}`);
    if (!DRY) {
      for (const e of newEntries) { await runbookCol.add(e); entriesAdded++; }
      await cpDoc.ref.update(update);
    } else {
      entriesAdded += newEntries.length;
    }
  }
  return entriesAdded;
}

(async () => {
  const games = await db.collection('games').get();
  console.log(`${DRY ? '[DRY] ' : ''}Migrating ${games.size} game(s)…`);
  let total = 0;
  for (const g of games.docs) {
    console.log(`Game ${g.id} (${g.data().name})`);
    total += await migrateGame(g);
  }
  console.log(`${DRY ? '[DRY] ' : ''}Done. ${total} runbook entries ${DRY ? 'would be' : ''} created.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
