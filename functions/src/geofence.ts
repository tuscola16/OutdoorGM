import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendArrivalPushNotifications, sendPushToTokens } from './notifications';
import { sendArrivalSMS, TWILIO_SECRETS } from './sms';
import { projectMarker } from './markers';

// Mirror of types/index.ts (the RN/web shared types can't be imported into functions/).
type CheckpointKind = 'hazard' | 'boon' | 'gm-notify' | 'notify';
type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';
type NotifyAudience = 'crossing-player' | 'all-players';

interface RunbookEffect {
  kind: CheckpointKind;
  message?: string;
  audience?: NotifyAudience;
}

type TimedBound =
  | { kind: 'game-start' }
  | { kind: 'game-end' }
  | { kind: 'time'; atMinute?: number; fireAt?: admin.firestore.Timestamp };

interface RunbookEntry {
  id: string;
  checkpointId: string;
  name: string;
  priority: number;
  trigger: 'fixed-order' | 'always-on' | 'timed' | 'gm-prompted';
  effect: RunbookEffect;
  queueSlots?: (RunbookEffect | null)[];
  startAt?: TimedBound;
  endAt?: TimedBound;
  createdAt?: admin.firestore.Timestamp;
}

interface CheckpointReveal {
  trigger?: 'player' | 'gm' | 'timed';
  audience?: 'all' | 'specific-players' | 'triggerer';
  recipientPlayerIds?: string[];
}

// Same-district trap suppression window (#5): if a tribute's same-district partner
// arrived at the same trap site within this many ms, the trap is withheld.
const COARRIVAL_WINDOW_MS = 90_000;

/** Resolve who sees an effect from its kind, honoring an explicit audience for notifies. */
function resolveAudience(effect: RunbookEffect): EventAudience {
  switch (effect.kind) {
    case 'gm-notify':
      return 'gm-only';
    case 'notify':
      return effect.audience ?? 'crossing-player';
    case 'hazard':
    case 'boon':
    default:
      return 'crossing-player';
  }
}

/** Is a `timed` entry currently within its [start, end] window? `now` and `started` in ms. */
function timedEligible(entry: RunbookEntry, nowMs: number, startedMs: number | null): boolean {
  const boundMs = (b: TimedBound | undefined, fallback: number): number => {
    if (!b) return fallback;
    if (b.kind === 'game-start') return startedMs ?? -Infinity;
    if (b.kind === 'game-end') return Infinity; // geofence only runs while the game is in play
    if (typeof b.fireAt?.toMillis === 'function') return b.fireAt.toMillis();
    if (typeof b.atMinute === 'number' && startedMs != null) return startedMs + b.atMinute * 60_000;
    return fallback;
  };
  const start = boundMs(entry.startAt, startedMs ?? -Infinity);
  const end = boundMs(entry.endAt, Infinity);
  return nowMs >= start && nowMs <= end;
}

/**
 * Resolve the single effect a crossing player receives (#60): among the checkpoint's runbook
 * entries, gather those currently matching (always-on; timed in-window; fixed-order slot for
 * this arrival ordinal), then pick the highest `priority` (ties → earliest `createdAt`).
 * `gm-prompted` entries never fire on a crossing. `ordinal` is the 0-based count of prior
 * distinct arrivers, or `null` on a revisit (fixed-order then uses its default effect).
 */
function resolveCrossingEffect(
  entries: RunbookEntry[],
  ordinal: number | null,
  nowMs: number,
  startedMs: number | null
): RunbookEffect | undefined {
  let best: { priority: number; createdMs: number; effect: RunbookEffect } | null = null;
  for (const e of entries) {
    let candidate: RunbookEffect | null | undefined;
    if (e.trigger === 'always-on') {
      candidate = e.effect;
    } else if (e.trigger === 'timed') {
      if (timedEligible(e, nowMs, startedMs)) candidate = e.effect;
    } else if (e.trigger === 'fixed-order') {
      if (ordinal == null) {
        candidate = e.effect; // revisit → the default effect, no slot consumed
      } else if (Array.isArray(e.queueSlots) && ordinal < e.queueSlots.length) {
        candidate = e.queueSlots[ordinal]; // may be null → nothing fires for this arriver
      } else {
        candidate = e.effect; // beyond the slot list → default
      }
    }
    if (!candidate) continue;
    const createdMs = e.createdAt?.toMillis?.() ?? 0;
    const wins =
      !best || e.priority > best.priority ||
      (e.priority === best.priority && createdMs < best.createdMs);
    if (wins) best = { priority: e.priority, createdMs, effect: candidate };
  }
  return best?.effect;
}

// Play-area boundary (#7), mirrored from types/index.ts MapBoundary.
interface MapBoundary {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  polygon?: { latitude: number; longitude: number }[];
}

/** Ray-casting point-in-polygon test (#39's geofence half). */
function pointInPolygon(
  lat: number,
  lng: number,
  poly: { latitude: number; longitude: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].latitude;
    const xi = poly[i].longitude;
    const yj = poly[j].latitude;
    const xj = poly[j].longitude;
    const intersects =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Is a coordinate inside the play area? Polygon (≥3 verts) wins; else the bbox (#7). */
function pointInBoundary(lat: number, lng: number, b: MapBoundary): boolean {
  if (Array.isArray(b.polygon) && b.polygon.length >= 3) {
    return pointInPolygon(lat, lng, b.polygon);
  }
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** GM FCM tokens + phones for a game, optionally excluding one token (#9). */
async function getGmRecipients(
  db: admin.firestore.Firestore,
  gameId: string,
  excludeToken?: string
): Promise<{ tokens: string[]; phones: string[] }> {
  const snap = await db
    .collection('games').doc(gameId).collection('members')
    .where('role', '==', 'gm').get();
  const tokens: string[] = [];
  const phones: string[] = [];
  for (const d of snap.docs) {
    const m = d.data();
    if (m.fcmToken && m.fcmToken !== excludeToken) tokens.push(m.fcmToken as string);
    if (m.phone) phones.push(m.phone as string);
  }
  return { tokens, phones };
}

/** Haversine formula — returns distance in meters between two coordinates. */
function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Cap (meters) on the prev→curr segment we'll interpolate for pass-through detection (#49).
// Beyond this, the straight-line guess between two fixes is unreliable (the player may have
// taken a curved path), so we fall back to the point test. Comfortably covers a few minutes
// of walking between throttled background fixes while rejecting implausible GPS teleports.
const MAX_SEGMENT_METERS = 400;

/** Distance (m) from point P to segment AB, via a local equirectangular projection centered
 * on P — accurate at geofence scales (<~1 km). Powers #49 pass-through detection. */
function pointToSegmentMeters(
  pLat: number, pLng: number,
  aLat: number, aLng: number,
  bLat: number, bLng: number
): number {
  const R = 6371000;
  const latRef = (pLat * Math.PI) / 180;
  const toXY = (lat: number, lng: number): [number, number] => [
    R * ((lng * Math.PI) / 180) * Math.cos(latRef),
    R * ((lat * Math.PI) / 180),
  ];
  const [px, py] = toXY(pLat, pLng);
  const [ax, ay] = toXY(aLat, aLng);
  const [bx, by] = toXY(bLat, bLng);
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

// Short-TTL cache of each game's checkpoints, reused across warm invocations (#29).
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

// Short-TTL cache of each game's runbook entries, grouped by checkpointId (#60). Reused
// across warm invocations the same way as the checkpoint cache so a busy game doesn't re-read
// the whole runbook on every location write.
const runbookCache = new Map<string, { byCp: Map<string, RunbookEntry[]>; expires: number }>();

async function getRunbookByCheckpointCached(gameId: string): Promise<Map<string, RunbookEntry[]>> {
  const hit = runbookCache.get(gameId);
  if (hit && hit.expires > Date.now()) return hit.byCp;
  const snap = await admin.firestore()
    .collection('games').doc(gameId).collection('runbook').get();
  const byCp = new Map<string, RunbookEntry[]>();
  for (const d of snap.docs) {
    const e = { id: d.id, ...(d.data() as Omit<RunbookEntry, 'id'>) };
    const list = byCp.get(e.checkpointId) ?? [];
    list.push(e);
    byCp.set(e.checkpointId, list);
  }
  runbookCache.set(gameId, { byCp, expires: Date.now() + CP_CACHE_TTL_MS });
  return byCp;
}

export const onLocationUpdate = functions
  .runWith({ secrets: TWILIO_SECRETS })
  .firestore.document('games/{gameId}/locations/{userId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return;

    const { gameId, userId } = context.params;
    const location = change.after.data() as {
      latitude: number;
      longitude: number;
      displayName: string;
      accuracy?: number;
    };

    // Previous fix for this player — the location doc is overwritten on every update, so
    // `change.before` is the prior position. Used for pass-through detection (#49): while
    // the phone is locked the OS throttles background location, so a player can walk
    // entirely through a checkpoint radius between two fixes that both fall outside it. We
    // test the path segment prev→curr against each checkpoint, not just the current point.
    const prevData = change.before.exists
      ? (change.before.data() as { latitude?: number; longitude?: number })
      : undefined;
    const prevLoc =
      prevData && typeof prevData.latitude === 'number' && typeof prevData.longitude === 'number'
        ? { latitude: prevData.latitude, longitude: prevData.longitude }
        : null;

    // Only fire checkpoint arrivals while the game is in play. Players upload location
    // during the lobby too (#16) — lobby fixes must never trigger a checkpoint.
    const gameSnap = await admin.firestore().collection('games').doc(gameId).get();
    const gameData = gameSnap.data();
    if (!gameData) return;
    const phase = gameData.phase ?? (gameData.status === 'ended' ? 'results' : 'play');
    if (phase !== 'play') return;

    // Resolve geofence config knobs with defaults (#50/#55/#56).
    const rawConfig = (gameData.config ?? {}) as {
      minFixAccuracyMeters?: number;
      geofenceConfirmFixes?: number;
      reNotifyAwayCooldownMinutes?: number;
    };
    const minFixAccuracy = rawConfig.minFixAccuracyMeters ?? 30;
    const confirmFixes = rawConfig.geofenceConfirmFixes ?? 2;
    const reNotifyAwayCooldownMs = (rawConfig.reNotifyAwayCooldownMinutes ?? 5) * 60_000;

    // Skip if the player is a GM (GMs don't trigger checkpoint arrivals).
    const memberSnap = await admin.firestore()
      .collection('games').doc(gameId).collection('members').doc(userId).get();
    if (!memberSnap.exists || memberSnap.data()?.role === 'gm') return;
    const playerFcmToken = memberSnap.data()?.fcmToken as string | undefined;
    const crossingDistrict = memberSnap.data()?.district as string | number | undefined;

    const db = admin.firestore();
    const arrivalsCol = db.collection('games').doc(gameId).collection('arrivals');

    // Player-left-the-boundary alert (#7). Runs before checkpoint work so it fires even
    // in a game with zero checkpoints. A per-member `outOfBounds` latch means the GM is
    // pinged exactly once on exit and once on re-entry.
    const boundary = gameData.boundary as MapBoundary | undefined;
    if (boundary) {
      const inside = pointInBoundary(location.latitude, location.longitude, boundary);
      const wasOut = memberSnap.data()?.outOfBounds === true;
      if (!inside && !wasOut) {
        await memberSnap.ref.update({ outOfBounds: true });
        const { tokens, phones } = await getGmRecipients(db, gameId, playerFcmToken);
        const body = `${location.displayName} left the play area`;
        await Promise.allSettled([
          sendPushToTokens(tokens, '🚧 Player left the area', body, 'arrivals'),
          sendArrivalSMS(phones, `BOUNDARY: ${body}`),
        ]);
      } else if (inside && wasOut) {
        await memberSnap.ref.update({ outOfBounds: false });
        const { tokens } = await getGmRecipients(db, gameId, playerFcmToken);
        await sendPushToTokens(
          tokens, '✅ Back in the area',
          `${location.displayName} re-entered the play area`, 'arrivals'
        );
      }
    }

    // GPS quality gate (#50): poor fixes are rejected from checkpoint eval — the map dot
    // still updates via the location write above. Reject is for checkpoint eval only.
    if (location.accuracy != null && location.accuracy > minFixAccuracy) return;

    const checkpoints = await getCheckpointsCached(gameId);
    if (checkpoints.length === 0) return;

    // Runbook entries grouped by checkpoint (#60) — the behavior resolved per crossing.
    const runbookByCp = await getRunbookByCheckpointCached(gameId);
    const startedMs = gameData.startedAt?.toMillis?.() ?? null;

    // Batch-read trip latches for all checkpoints (#50/#55). One RPC for all docs.
    const tripsCol = db.collection('games').doc(gameId).collection('checkpointTrips');
    const tripRefs = checkpoints.map((cp) => tripsCol.doc(`${userId}_${cp.id}`));
    const tripSnaps = await db.getAll(...tripRefs);
    const tripMap = new Map<string, FirebaseFirestore.DocumentData | null>(
      checkpoints.map((cp, i) => [cp.id, tripSnaps[i].exists ? tripSnaps[i].data()! : null])
    );

    const nowMs = Date.now();

    // Effects resolved for this crossing.
    const newArrivals: Array<{
      checkpointName: string;
      playerName: string;
      event?: RunbookEffect;
      gmNote?: string;
    }> = [];

    // In-invocation dedup: if the same checkpoint somehow appears twice, skip it.
    const processedIds = new Set<string>();

    for (const cpEntry of checkpoints) {
      const checkpointId = cpEntry.id;
      if (processedIds.has(checkpointId)) continue;

      const cp = cpEntry.data as {
        latitude: number;
        longitude: number;
        radius: number;
        name: string;
        visibility?: 'hidden' | 'shown' | 'shown-on-trigger';
        reveal?: CheckpointReveal;
      };

      const dist = distanceMeters(
        location.latitude, location.longitude,
        cp.latitude, cp.longitude
      );
      const inRadius = dist <= cp.radius; // strict check — no accuracy expansion (#50)

      const trip = tripMap.get(checkpointId) ?? null;
      const tripRef = tripsCol.doc(`${userId}_${checkpointId}`);

      // Pass-through (#49): the current fix is outside, but the path from the previous fix
      // to it clips the radius and the player wasn't already inside — i.e. they crossed
      // between two sparse (locked-phone) fixes with no fix landing in the circle. Only
      // checked when not in-radius; a segment crossing is its own confirmation, so it
      // bypasses the #50 confirm-fixes streak and latches as already-exited below.
      let passThrough = false;
      if (!inRadius && prevLoc && !trip?.inside) {
        const segLen = distanceMeters(
          prevLoc.latitude, prevLoc.longitude,
          location.latitude, location.longitude
        );
        if (segLen > 0 && segLen <= MAX_SEGMENT_METERS) {
          const segDist = pointToSegmentMeters(
            cp.latitude, cp.longitude,
            prevLoc.latitude, prevLoc.longitude,
            location.latitude, location.longitude
          );
          passThrough = segDist <= cp.radius;
        }
      }

      // --- Exit path: player was inside, now outside (and not a fresh pass-through) ---
      if (!inRadius && !passThrough) {
        if (trip?.inside) {
          await tripRef.set(
            { inside: false, insideStreak: 0, lastExitAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        } else if ((trip?.insideStreak ?? 0) > 0) {
          // Reset partial streak on any outside fix.
          await tripRef.set({ insideStreak: 0 }, { merge: true });
        }
        continue;
      }

      // --- Still inside: no new trigger ---
      if (trip?.inside) continue;

      // --- Accumulate streak toward confirmation (#50 debounce) ---
      // A pass-through (#49) skips the streak — the player is already gone, so there's no
      // chance to gather consecutive in-radius fixes; the segment crossing confirms it.
      const newStreak = (trip?.insideStreak ?? 0) + 1;
      if (!passThrough && newStreak < confirmFixes) {
        await tripRef.set(
          { playerId: userId, checkpointId, inside: false, insideStreak: newStreak },
          { merge: true }
        );
        continue;
      }

      // --- Confirmed crossing (lingering entry or pass-through) ---
      // A normal entry latches inside=true; a pass-through latches as already-exited so the
      // away-cooldown (#55) is measured from now and a later return can re-fire.
      const enteredInside = !passThrough;
      const buildLatch = (): Record<string, unknown> =>
        enteredInside
          ? {
              playerId: userId, checkpointId, inside: true, insideStreak: newStreak,
              lastEnterAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : {
              playerId: userId, checkpointId, inside: false, insideStreak: 0,
              lastEnterAt: admin.firestore.FieldValue.serverTimestamp(),
              lastExitAt: admin.firestore.FieldValue.serverTimestamp(),
            };

      // GM re-notification gate (#55): re-alert on return after cooldown.
      const lastExitMs = trip?.lastExitAt
        ? (trip.lastExitAt as admin.firestore.Timestamp).toMillis()
        : null;
      const gmShouldNotify = lastExitMs === null || (nowMs - lastExitMs >= reNotifyAwayCooldownMs);
      const lastNotifiedState = (trip?.lastNotifiedState as string | null | undefined) ?? null;
      const entries = runbookByCp.get(checkpointId) ?? [];

      // One transaction: count the arrival ordinal, apply district suppression (#5), resolve
      // the single highest-priority runbook effect (#60), gate the player re-notify (#55) on
      // the resolved effect, then atomically latch + record the arrival.
      const result = await db.runTransaction(async (tx) => {
        // Race guard: if another concurrent write already confirmed entry, skip.
        const freshTrip = await tx.get(tripRef);
        if (freshTrip.exists && freshTrip.data()?.inside) return null;

        const existing = await tx.get(arrivalsCol.where('checkpointId', '==', checkpointId));
        const alreadyArrived = existing.docs.some(
          (d) => d.data().playerId === userId && !d.data().revisit
        );
        const nonRevisitCount = existing.docs.filter((d) => !d.data().revisit).length;
        const ordinal = alreadyArrived ? null : nonRevisitCount;

        // Same-district co-arrival suppression (#5).
        const suppressed =
          crossingDistrict != null &&
          existing.docs.some((d) => {
            const a = d.data();
            if (a.district == null || a.district !== crossingDistrict) return false;
            const ms = a.timestamp?.toMillis?.() ?? null;
            return ms != null && nowMs - ms <= COARRIVAL_WINDOW_MS;
          });

        // Resolve the single effect this crossing delivers (#60).
        const resolved = resolveCrossingEffect(entries, ordinal, nowMs, startedMs);
        const effect = suppressed ? undefined : resolved;
        const cpState = effect?.kind ?? null;
        const playerShouldNotify = lastNotifiedState === null || cpState !== lastNotifiedState;

        // Neither GM nor player needs notifying → refresh the latch, skip the arrival write.
        if (!gmShouldNotify && !playerShouldNotify) {
          tx.set(tripRef, buildLatch(), { merge: true });
          return { skipArrival: true as const };
        }

        const latchData = buildLatch();
        if (playerShouldNotify && cpState != null) latchData.lastNotifiedState = cpState;
        tx.set(tripRef, latchData, { merge: true });

        tx.set(arrivalsCol.doc(), {
          playerId: userId,
          playerName: location.displayName,
          checkpointId,
          checkpointName: cp.name,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          latitude: location.latitude,
          longitude: location.longitude,
          ...(alreadyArrived ? { revisit: true } : {}),
          ...(crossingDistrict != null ? { district: crossingDistrict } : {}),
        });

        return { effect, suppressed, playerShouldNotify, gmShouldNotify };
      });

      if (result === null) continue; // raced — another write confirmed entry first
      if ('skipArrival' in result) { processedIds.add(checkpointId); continue; }

      const firePlayer = result.playerShouldNotify && !result.suppressed;
      const event = firePlayer ? result.effect : undefined;

      if (result.gmShouldNotify || (event && event.kind !== 'gm-notify')) {
        newArrivals.push({
          checkpointName: cp.name,
          playerName: location.displayName,
          event,
          gmNote: result.suppressed
            ? `${location.displayName} & a District ${crossingDistrict} partner arrived together at ${cp.name} — trap withheld`
            : undefined,
        });
      }

      // Reveal-on-crossing (#60): the trap this player just sprang becomes a marker
      // visible only to them.
      if (cp.visibility === 'shown-on-trigger' && cp.reveal?.trigger === 'player') {
        await projectMarker(db, gameId, checkpointId, cp, [userId]);
      }

      processedIds.add(checkpointId);
    }

    if (newArrivals.length === 0) return;

    const gmsSnap = await admin.firestore()
      .collection('games').doc(gameId).collection('members')
      .where('role', '==', 'gm').get();

    const gmTokens: string[] = [];
    const gmPhones: string[] = [];
    for (const gmDoc of gmsSnap.docs) {
      const gm = gmDoc.data();
      if (gm.fcmToken && gm.fcmToken !== playerFcmToken) gmTokens.push(gm.fcmToken as string);
      if (gm.phone) gmPhones.push(gm.phone as string);
    }

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

    await Promise.all(
      newArrivals.map(async ({ playerName, checkpointName, event, gmNote }) => {
        if (!event || event.kind === 'gm-notify') {
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
  notify: '📢 Message',
  'gm-notify': '📍 Checkpoint',
};

const KIND_VERBS: Record<CheckpointKind, string> = {
  hazard: 'hit a hazard',
  boon: 'found a boon',
  notify: 'triggered a message',
  'gm-notify': 'reached a checkpoint',
};

async function dispatchCheckpointEvent(args: {
  gameId: string;
  event: RunbookEffect;
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

  const gmBody = `${playerName} ${KIND_VERBS[event.kind]} at ${checkpointName}`;
  const work: Promise<unknown>[] = [
    sendArrivalPushNotifications(args.gmTokens, '⚡ Event triggered', gmBody),
    sendArrivalSMS(args.gmPhones, gmBody),
  ];

  if (audience === 'gm-only') {
    await Promise.allSettled(work);
    return;
  }

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
