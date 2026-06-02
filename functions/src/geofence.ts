import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendArrivalPushNotifications, sendPushToTokens } from './notifications';
import { sendArrivalSMS } from './sms';

// Mirror of types/index.ts (the RN/web shared types can't be imported into functions/).
type CheckpointKind = 'hazard' | 'boon' | 'player-notify' | 'gm-only';
type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';

interface CheckpointEvent {
  kind: CheckpointKind;
  message?: string;
  audience?: EventAudience;
}

/** Resolve who sees an event from its kind, honoring an explicit audience for notifies. */
function resolveAudience(event: CheckpointEvent): EventAudience {
  switch (event.kind) {
    case 'gm-only':
      return 'gm-only';
    case 'player-notify':
      return event.audience ?? 'crossing-player';
    case 'hazard':
    case 'boon':
    default:
      return 'crossing-player';
  }
}

/** Haversine formula — returns distance in meters between two coordinates. */
function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const onLocationUpdate = functions.firestore
  .document('games/{gameId}/locations/{userId}')
  .onWrite(async (change, context) => {
    // Only process on create or update (not delete)
    if (!change.after.exists) return;

    const { gameId, userId } = context.params;
    const location = change.after.data() as {
      latitude: number;
      longitude: number;
      displayName: string;
      accuracy?: number;
    };

    // GPS is only accurate to ~10–30m, so a strict "distance <= radius" test
    // misses real arrivals at tight radii. Allow the reported accuracy as slack
    // (capped so a wildly inaccurate fix can't trigger everything), i.e. count an
    // arrival if the player *could* be inside the circle given GPS uncertainty.
    const accuracySlack = Math.min(Math.max(location.accuracy ?? 0, 0), 30);

    // Skip if the player is a GM (GMs don't trigger checkpoint arrivals)
    const memberSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberSnap.exists || memberSnap.data()?.role === 'gm') return;
    const playerFcmToken = memberSnap.data()?.fcmToken as string | undefined;

    // Fetch all checkpoints for this game
    const checkpointsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('checkpoints')
      .get();

    if (checkpointsSnap.empty) return;

    // Fetch existing arrivals for this player (to avoid duplicate notifications)
    const existingArrivalsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('arrivals')
      .where('playerId', '==', userId)
      .get();

    const arrivedCheckpointIds = new Set(
      existingArrivalsSnap.docs.map((d) => d.data().checkpointId as string)
    );

    const db = admin.firestore();
    const arrivalsCol = db.collection('games').doc(gameId).collection('arrivals');
    const batch = db.batch();
    // Events resolved for this crossing: `event` is undefined → GM-only arrival ping.
    const newArrivals: Array<{
      checkpointName: string;
      playerName: string;
      event?: CheckpointEvent;
    }> = [];

    for (const cpDoc of checkpointsSnap.docs) {
      const cp = cpDoc.data() as {
        latitude: number;
        longitude: number;
        radius: number;
        name: string;
        event?: CheckpointEvent;
        eventQueue?: CheckpointEvent[];
      };
      const checkpointId = cpDoc.id;

      if (arrivedCheckpointIds.has(checkpointId)) continue;

      const dist = distanceMeters(
        location.latitude,
        location.longitude,
        cp.latitude,
        cp.longitude
      );

      if (dist > cp.radius + accuracySlack) continue;

      if (cp.eventQueue && cp.eventQueue.length > 0) {
        // Arrival-order queue: the Nth distinct arriver gets eventQueue[N]. Record the
        // arrival and compute the ordinal atomically so simultaneous crossings don't
        // collide on the same slot.
        const queue = cp.eventQueue;
        const ordinal = await db.runTransaction(async (tx) => {
          const existing = await tx.get(arrivalsCol.where('checkpointId', '==', checkpointId));
          // Idempotency: if this player somehow already arrived, don't re-fire.
          if (existing.docs.some((d) => d.data().playerId === userId)) return null;
          const n = existing.size; // distinct prior arrivers
          const ref = arrivalsCol.doc();
          tx.set(ref, {
            playerId: userId,
            playerName: location.displayName,
            checkpointId,
            checkpointName: cp.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            latitude: location.latitude,
            longitude: location.longitude,
          });
          return n;
        });
        if (ordinal === null) continue; // raced — already recorded
        newArrivals.push({
          checkpointName: cp.name,
          playerName: location.displayName,
          // Queue exhausted (more arrivers than events) → GM-only ping, no player event.
          event: ordinal < queue.length ? queue[ordinal] : undefined,
        });
      } else {
        // Single event (same for every arriver) or no event (GM-only ping).
        const arrivalRef = arrivalsCol.doc();
        batch.set(arrivalRef, {
          playerId: userId,
          playerName: location.displayName,
          checkpointId,
          checkpointName: cp.name,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          latitude: location.latitude,
          longitude: location.longitude,
        });
        newArrivals.push({
          checkpointName: cp.name,
          playerName: location.displayName,
          event: cp.event,
        });
      }
      // Prevent duplicate arrivals within the same write
      arrivedCheckpointIds.add(checkpointId);
    }

    if (newArrivals.length === 0) return;

    await batch.commit();

    // Fetch all GMs to notify
    const gmsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('members')
      .where('role', '==', 'gm')
      .get();

    const gmTokens: string[] = [];
    const gmPhones: string[] = [];

    for (const gmDoc of gmsSnap.docs) {
      const gm = gmDoc.data();
      if (gm.fcmToken) gmTokens.push(gm.fcmToken as string);
      if (gm.phone) gmPhones.push(gm.phone as string);
    }

    // For all-players events we need every living player's token. Only fetch the
    // full roster if at least one resolved event broadcasts to everyone.
    const needsAllPlayers = newArrivals.some(
      (a) => a.event && resolveAudience(a.event) === 'all-players'
    );
    const allPlayerTokens = needsAllPlayers
      ? (await admin.firestore().collection('games').doc(gameId).collection('members').get()).docs
          .map((d) => d.data())
          .filter((m) => m.role !== 'gm' && !m.out)
          .map((m) => m.fcmToken as string | undefined)
          .filter((t): t is string => !!t)
      : [];

    // Fire notifications + events for each new arrival.
    await Promise.all(
      newArrivals.map(async ({ playerName, checkpointName, event }) => {
        // Default behavior (no event, or an explicit gm-only): notify the GM only.
        if (!event || event.kind === 'gm-only') {
          const body = `${playerName} reached ${checkpointName}`;
          await Promise.allSettled([
            sendArrivalPushNotifications(gmTokens, `📍 Arrival Alert`, body),
            sendArrivalSMS(gmPhones, body),
          ]);
          return;
        }

        await dispatchCheckpointEvent({
          gameId,
          event,
          checkpointName,
          playerName,
          crossingPlayerId: userId,
          crossingPlayerToken: playerFcmToken,
          gmTokens,
          gmPhones,
          allPlayerTokens,
        });
      })
    );
  });

const KIND_TITLES: Record<CheckpointKind, string> = {
  hazard: '⚠️ Hazard!',
  boon: '✨ A boon',
  'player-notify': '📢 Message',
  'gm-only': '📍 Checkpoint',
};

const KIND_VERBS: Record<CheckpointKind, string> = {
  hazard: 'hit a hazard',
  boon: 'found a boon',
  'player-notify': 'triggered a message',
  'gm-only': 'reached a checkpoint',
};

async function dispatchCheckpointEvent(args: {
  gameId: string;
  event: CheckpointEvent;
  checkpointName: string;
  playerName: string;
  crossingPlayerId: string;
  crossingPlayerToken?: string;
  gmTokens: string[];
  gmPhones: string[];
  allPlayerTokens: string[];
}): Promise<void> {
  const { gameId, event, checkpointName, playerName } = args;
  const title = KIND_TITLES[event.kind] ?? '📍 Checkpoint';
  const body = event.message || `${KIND_TITLES[event.kind]} at ${checkpointName}`;
  const audience = resolveAudience(event);
  const db = admin.firestore();

  // Always tell the GM something fired (so they can react in person).
  const gmBody = `${playerName} ${KIND_VERBS[event.kind]} at ${checkpointName}`;
  const work: Promise<unknown>[] = [
    sendArrivalPushNotifications(args.gmTokens, '⚡ Event triggered', gmBody),
    sendArrivalSMS(args.gmPhones, gmBody),
  ];

  if (audience === 'gm-only') {
    await Promise.allSettled(work);
    return;
  }

  // Write an in-app broadcast so the player(s) see it in their feed, and push it.
  if (audience === 'all-players') {
    work.push(
      db.collection('games').doc(gameId).collection('broadcasts').add({
        kind: 'checkpoint-event',
        eventKind: event.kind,
        message: body,
        targetPlayerId: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    work.push(sendPushToTokens(args.allPlayerTokens, title, body, 'broadcasts'));
  } else {
    // crossing-player: a targeted broadcast (so it lands in that player's feed)
    // plus a direct push.
    work.push(
      db.collection('games').doc(gameId).collection('broadcasts').add({
        kind: 'checkpoint-event',
        eventKind: event.kind,
        message: body,
        targetPlayerId: args.crossingPlayerId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    if (args.crossingPlayerToken) {
      work.push(sendPushToTokens([args.crossingPlayerToken], title, body, 'broadcasts'));
    }
  }

  await Promise.allSettled(work);
}
