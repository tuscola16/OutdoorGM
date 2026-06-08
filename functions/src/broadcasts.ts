import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';

// #69: push player-facing broadcasts to closed/backgrounded phones.
//
// The GM "Broadcast to players" (and targeted player messages) write a broadcasts/* doc
// directly from the client with no push — so they only surfaced in-app. This trigger sends
// the FCM push when a broadcast is created.
//
// Server paths that ALREADY push (geofence, runbook, run-sheet, death) stamp `pushed: true`
// on their broadcast docs so this trigger skips them — no double-push. Co-GM messages
// (`audience: 'gm-only'`) are an in-app-only channel and are skipped too.

type BroadcastDoc = {
  kind?: string;
  eventKind?: 'hazard' | 'boon' | 'gm-notify' | 'notify';
  message?: string;
  targetPlayerId?: string | null;
  audience?: string;
  pushed?: boolean;
};

const KIND_TITLES: Record<string, string> = {
  'gm-message': '📢 Message',
  death: '☠️ A tribute has fallen',
  winner: '🏆 Game over',
  'player-count': '📢 Update',
};

const EVENT_KIND_TITLES: Record<string, string> = {
  hazard: '⚠️ Hazard!',
  boon: '✨ A boon',
  notify: '📢 Message',
  'gm-notify': '📍 Update',
};

export const onBroadcastCreate = functions.firestore
  .document('games/{gameId}/broadcasts/{broadcastId}')
  .onCreate(async (snap, context) => {
    const { gameId } = context.params as { gameId: string };
    const b = snap.data() as BroadcastDoc | undefined;
    if (!b) return;

    if (b.pushed === true) return; // a server path already pushed this one
    if (b.audience === 'gm-only') return; // co-GM channel stays in-app
    const message = (b.message ?? '').trim();
    if (!message) return;

    const title =
      b.kind === 'checkpoint-event'
        ? EVENT_KIND_TITLES[b.eventKind ?? 'notify'] ?? '📢 Update'
        : KIND_TITLES[b.kind ?? ''] ?? '📢 Update';

    const db = admin.firestore();
    const membersCol = db.collection('games').doc(gameId).collection('members');

    let tokens: string[] = [];
    if (b.targetPlayerId) {
      const m = await membersCol.doc(b.targetPlayerId).get();
      const t = m.data()?.fcmToken as string | undefined;
      if (t) tokens = [t];
    } else {
      // All living (non-out) players.
      const all = await membersCol.get();
      tokens = all.docs
        .map((d) => d.data())
        .filter((m) => m.role !== 'gm' && !m.out)
        .map((m) => m.fcmToken as string | undefined)
        .filter((t): t is string => !!t);
    }

    await sendPushToTokens(tokens, title, message, 'broadcasts');
  });
