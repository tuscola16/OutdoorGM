import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendArrivalPushNotifications, sendPushToTokens } from './notifications';
import { sendArrivalSMS, TWILIO_SECRETS } from './sms';

// Mirror of types/index.ts (the RN/web shared types can't be imported into functions/).
type CheckpointKind = 'hazard' | 'boon' | 'player-notify' | 'gm-only';
type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';

interface CheckpointEvent {
  kind: CheckpointKind;
  message?: string;
  audience?: EventAudience;
}

// Same-district trap suppression window (#5): if a tribute's same-district partner
// arrived at the same trap site within this many ms, the trap is withheld (the
// explicit rule "don't give a trap if both tributes from a district arrive together").
const COARRIVAL_WINDOW_MS = 90_000;

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

// Short-TTL cache of each game's checkpoints, reused across warm invocations of this
// trigger (#29). onLocationUpdate fires on every player's location write (~every 5s), and
// re-reading the whole checkpoints collection each time is the redundant cost. Checkpoints
// change rarely; a brand-new checkpoint or a run-sheet-driven open/close window is honored
// within CP_CACHE_TTL_MS — well under the run-sheet's 60s sweep cadence. Arrivals are still
// read fresh every time, so dedup/arrival-ordinal correctness is unaffected.
interface CachedCheckpoint {
  id: string;
  data: FirebaseFirestore.DocumentData;
}
const CP_CACHE_TTL_MS = 15_000;
const checkpointCache = new Map<string, { cps: CachedCheckpoint[]; expires: number }>();

async function getCheckpointsCached(gameId: string): Promise<CachedCheckpoint[]> {
  const hit = checkpointCache.get(gameId);
  if (hit && hit.expires > Date.now()) return hit.cps;
  const snap = await admin.firestore()
    .collection('games').doc(gameId).collection('checkpoints').get();
  const cps = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  checkpointCache.set(gameId, { cps, expires: Date.now() + CP_CACHE_TTL_MS });
  return cps;
}

export const onLocationUpdate = functions
  // Bind Twilio secrets so sendArrivalSMS can read them from process.env (#25).
  .runWith({ secrets: TWILIO_SECRETS })
  .firestore.document('games/{gameId}/locations/{userId}')
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

    // Only fire checkpoint arrivals while the game is actually in play. Players now
    // upload location during the lobby too (#16) so they're already on the GM's map at
    // kickoff — but a lobby/setup/results fix must never trigger a checkpoint. Mirror the
    // gamePhase() resolver: legacy games (no `phase`) are `play` while active.
    const gameSnap = await admin.firestore().collection('games').doc(gameId).get();
    const gameData = gameSnap.data();
    if (!gameData) return;
    const phase = gameData.phase ?? (gameData.status === 'ended' ? 'results' : 'play');
    if (phase !== 'play') return;

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
    // District/tribute pairing (#10), used for same-district trap suppression (#5).
    const crossingDistrict = memberSnap.data()?.district as string | number | undefined;

    const db = admin.firestore();
    const arrivalsCol = db.collection('games').doc(gameId).collection('arrivals');

    // Fetch checkpoints (cached, #29) and this player's existing arrivals (always fresh)
    // in parallel — they're independent, so this trims the trigger's wall-time.
    const [checkpoints, existingArrivalsSnap] = await Promise.all([
      getCheckpointsCached(gameId),
      arrivalsCol.where('playerId', '==', userId).get(),
    ]);

    if (checkpoints.length === 0) return;

    // Existing arrivals for this player, to avoid duplicate notifications.
    const arrivedCheckpointIds = new Set(
      existingArrivalsSnap.docs.map((d) => d.data().checkpointId as string)
    );

    // Events resolved for this crossing: `event` is undefined → GM-only arrival ping.
    const newArrivals: Array<{
      checkpointName: string;
      playerName: string;
      event?: CheckpointEvent;
      /** GM-only note (e.g. a withheld trap) shown instead of the default arrival line. */
      gmNote?: string;
    }> = [];

    for (const cpEntry of checkpoints) {
      const checkpointId = cpEntry.id;
      const cp = cpEntry.data as {
        latitude: number;
        longitude: number;
        radius: number;
        name: string;
        event?: CheckpointEvent;
        eventQueue?: CheckpointEvent[];
        opensAt?: admin.firestore.Timestamp | null;
        closesAt?: admin.firestore.Timestamp | null;
      };

      if (arrivedCheckpointIds.has(checkpointId)) continue;

      // Time-gate (#12): a site only fires while live, i.e. now ∈ [opensAt, closesAt].
      // Crossings outside the window are ignored (not recorded), so a site that opens
      // later still fires once the player is inside it during the live window.
      const nowMs = Date.now();
      const opensMs = cp.opensAt ? cp.opensAt.toMillis() : null;
      const closesMs = cp.closesAt ? cp.closesAt.toMillis() : null;
      if ((opensMs !== null && nowMs < opensMs) || (closesMs !== null && nowMs > closesMs)) {
        continue;
      }

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
        const result = await db.runTransaction(async (tx) => {
          const existing = await tx.get(arrivalsCol.where('checkpointId', '==', checkpointId));
          // Idempotency: if this player somehow already arrived, don't re-fire.
          if (existing.docs.some((d) => d.data().playerId === userId)) return null;
          const n = existing.size; // distinct prior arrivers → this player's ordinal
          // Same-district co-arrival suppression (#5): withhold the trap if a tribute
          // from the SAME district arrived at this site within the co-arrival window.
          const suppressed =
            crossingDistrict != null &&
            existing.docs.some((d) => {
              const a = d.data();
              if (a.district == null || a.district !== crossingDistrict) return false;
              const ms = a.timestamp?.toMillis?.() ?? null;
              return ms != null && nowMs - ms <= COARRIVAL_WINDOW_MS;
            });
          const ref = arrivalsCol.doc();
          tx.set(ref, {
            playerId: userId,
            playerName: location.displayName,
            checkpointId,
            checkpointName: cp.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            latitude: location.latitude,
            longitude: location.longitude,
            ...(crossingDistrict != null ? { district: crossingDistrict } : {}),
          });
          return { n, suppressed };
        });
        if (result === null) continue; // raced — already recorded
        const { n: ordinal, suppressed } = result;
        newArrivals.push({
          checkpointName: cp.name,
          playerName: location.displayName,
          // Queue exhausted (more arrivers than events) → GM-only ping. Same-district
          // co-arrival → trap withheld (GM-only ping with a note explaining why).
          event: suppressed ? undefined : ordinal < queue.length ? queue[ordinal] : undefined,
          gmNote: suppressed
            ? `${location.displayName} & a District ${crossingDistrict} partner arrived together at ${cp.name} — trap withheld`
            : undefined,
        });
      } else {
        // Single event (same for every arriver) or no event (GM-only ping). Record the
        // arrival in a transaction (#33) so two concurrent location writes for the same
        // player can't both pass the in-memory dedup and create duplicate arrivals/pushes.
        // Mirrors the queue path: query by checkpointId (single-field auto index) and
        // filter playerId in memory, so no composite index is needed.
        const wrote = await db.runTransaction(async (tx) => {
          const existing = await tx.get(arrivalsCol.where('checkpointId', '==', checkpointId));
          if (existing.docs.some((d) => d.data().playerId === userId)) return false;
          tx.set(arrivalsCol.doc(), {
            playerId: userId,
            playerName: location.displayName,
            checkpointId,
            checkpointName: cp.name,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            latitude: location.latitude,
            longitude: location.longitude,
            ...(crossingDistrict != null ? { district: crossingDistrict } : {}),
          });
          return true;
        });
        if (!wrote) continue; // raced — already recorded
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
      newArrivals.map(async ({ playerName, checkpointName, event, gmNote }) => {
        // Default behavior (no event, or an explicit gm-only): notify the GM only.
        // A `gmNote` (e.g. a withheld same-district trap) replaces the default line.
        if (!event || event.kind === 'gm-only') {
          const body = gmNote ?? `${playerName} reached ${checkpointName}`;
          await Promise.allSettled([
            sendArrivalPushNotifications(gmTokens, gmNote ? '⚖️ Trap withheld' : '📍 Arrival Alert', body),
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
