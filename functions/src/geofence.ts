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
  defaultNone?: boolean;
  startAt?: TimedBound;
  endAt?: TimedBound;
  playerIds?: string[] | null; // #80: only these players can trip it (empty/absent = anyone)
  revealOnFire?: 'none' | 'triggerer' | 'targeted' | 'all'; // #80: reveal the checkpoint on fire
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
 * The effect a single runbook entry delivers to a player **right now**, or `null` if it isn't
 * eligible (ROADMAP #67 — entries are evaluated independently, not collapsed to one per crossing):
 * always-on always; timed only in-window; fixed-order by this arrival ordinal (the Nth arriver's
 * slot, else the default — which `defaultNone` can make "nothing"); gm-prompted never on a crossing.
 * `ordinal` is the 0-based count of prior distinct arrivers, or `null` on a revisit.
 */
function eligibleEffect(
  e: RunbookEntry,
  ordinal: number | null,
  nowMs: number,
  startedMs: number | null
): RunbookEffect | null {
  if (e.trigger === 'always-on') return e.effect ?? null;
  if (e.trigger === 'timed') return timedEligible(e, nowMs, startedMs) ? (e.effect ?? null) : null;
  if (e.trigger === 'fixed-order') {
    if (ordinal != null && Array.isArray(e.queueSlots) && ordinal < e.queueSlots.length) {
      return e.queueSlots[ordinal] ?? null; // may be null → nothing fires for this arriver
    }
    return e.defaultNone ? null : (e.effect ?? null); // default / revisit
  }
  return null; // gm-prompted — fired manually, never on a crossing
}

/**
 * #80: may this player trip this entry? An untargeted entry (no `playerIds`, or an empty
 * array) is open to everyone; a targeted one only fires for the named members — anyone else
 * crossing falls through to the next-highest-priority entry.
 */
function entryTargetsPlayer(e: RunbookEntry, playerId: string): boolean {
  return !Array.isArray(e.playerIds) || e.playerIds.length === 0 || e.playerIds.includes(playerId);
}

/**
 * #80: the marker audience for an entry's reveal-on-fire, or `undefined` when it reveals
 * nothing. `null` = every player; an array = only those uids. `targeted` falls back to the
 * triggerer when the entry isn't targeted, so a reveal is never silently a no-op.
 */
function revealAudienceForEntry(e: RunbookEntry, triggererId: string): string[] | null | undefined {
  switch (e.revealOnFire) {
    case 'all':
      return null;
    case 'targeted':
      return Array.isArray(e.playerIds) && e.playerIds.length > 0 ? e.playerIds : [triggererId];
    case 'triggerer':
      return [triggererId];
    default:
      return undefined; // 'none' / absent
  }
}

/** Stable per-checkpoint firing order: highest priority first, ties → earliest createdAt. */
function byPriorityThenAge(a: RunbookEntry, b: RunbookEntry): number {
  return (b.priority ?? 0) - (a.priority ?? 0) ||
    (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0);
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

// Short-TTL cache of each game's doc (#16), reused across warm invocations so a burst of
// fixes from one player doesn't re-read the game doc every write. Only read-only,
// mid-burst-stable fields are consumed from it (phase/status/boundary/config/startedAt) —
// none are mutated by this trigger. A GM phase change (e.g. End Game) is honored within one
// TTL window. Pairs with #20/#24's rules, which add a game-doc get() on some writes.
const gameCache = new Map<string, { data: FirebaseFirestore.DocumentData; expires: number }>();

async function getGameCached(gameId: string): Promise<FirebaseFirestore.DocumentData | null> {
  const hit = gameCache.get(gameId);
  if (hit && hit.expires > Date.now()) return hit.data;
  const snap = await admin.firestore().collection('games').doc(gameId).get();
  const data = snap.data();
  if (!data) return null;
  gameCache.set(gameId, { data, expires: Date.now() + CP_CACHE_TTL_MS });
  return data;
}

// Short-TTL cache of a player's member doc (#16). role/fcmToken/district are read-only on the
// location-write path; `outOfBounds` is the lone mutable field, written through below so the
// boundary latch (#7) still fires exactly once per excursion within a warm instance. Cached
// `null` short-circuits writes from a non-member without a per-write read.
interface CachedMember {
  role?: string;
  fcmToken?: string;
  district?: string | number;
  outOfBounds?: boolean;
}
const memberCache = new Map<string, { data: CachedMember | null; expires: number }>();

async function getMemberCached(gameId: string, uid: string): Promise<CachedMember | null> {
  const key = `${gameId}_${uid}`;
  const hit = memberCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data;
  const snap = await admin.firestore()
    .collection('games').doc(gameId).collection('members').doc(uid).get();
  const m = snap.exists ? snap.data()! : null;
  const data: CachedMember | null = m
    ? {
        role: m.role as string | undefined,
        fcmToken: m.fcmToken as string | undefined,
        district: m.district as string | number | undefined,
        outOfBounds: m.outOfBounds === true,
      }
    : null;
  memberCache.set(key, { data, expires: Date.now() + CP_CACHE_TTL_MS });
  return data;
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
      battery?: number;
      speed?: number;   // #82 — recorded only, never gated on
      mocked?: boolean; // #82
      steps?: number;   // #82
      updatedAt?: FirebaseFirestore.Timestamp;
    };

    // Previous fix for this player — the location doc is overwritten on every update, so
    // `change.before` is the prior position. Used for pass-through detection (#49): while
    // the phone is locked the OS throttles background location, so a player can walk
    // entirely through a checkpoint radius between two fixes that both fall outside it. We
    // test the path segment prev→curr against each checkpoint, not just the current point.
    const prevData = change.before.exists
      ? (change.before.data() as { latitude?: number; longitude?: number; steps?: number })
      : undefined;
    /** Previous cumulative step count (#82), for the trail's `stepsSincePrev`. */
    const prevSteps = typeof prevData?.steps === 'number' ? prevData.steps : null;
    const prevLoc =
      prevData && typeof prevData.latitude === 'number' && typeof prevData.longitude === 'number'
        ? { latitude: prevData.latitude, longitude: prevData.longitude }
        : null;

    // Only fire checkpoint arrivals while the game is in play. Players upload location
    // during the lobby too (#16) — lobby fixes must never trigger a checkpoint. The game
    // doc is cached (#16): a burst of fixes reuses one read.
    const gameData = await getGameCached(gameId);
    if (!gameData) return;
    const phase = gameData.phase ?? (gameData.status === 'ended' ? 'results' : 'play');
    // #41: keep tracking, boundary, SOS, and checkpoint eval running through the end-game
    // showdown (a convergence checkpoint can still fire); only the ration loop turns off.
    if (phase !== 'play' && phase !== 'endgame') return;

    // Resolve geofence config knobs with defaults (#50/#55/#56/#67).
    const rawConfig = (gameData.config ?? {}) as {
      minFixAccuracyMeters?: number;
      geofenceConfirmFixes?: number;
      tripIntervalMinutes?: number;
      locationTrail?: boolean;
    };
    // Field-measured 2026-08-14: a pocketed Android phone with the screen locked reports
    // ~52m accuracy while walking, and ~16m only when stationary with the app open. The old
    // 30m default therefore rejected essentially every real gameplay fix — checkpoints never
    // fired in the field while the GM map kept updating, because the location write happens
    // ABOVE this gate and only checkpoint evaluation is skipped.
    // 100m accepts pocketed fixes. It is deliberately blunt: a fix accurate to only 100m can
    // trigger a smaller checkpoint from outside it, so `geofenceConfirmFixes` (2) is doing
    // real work here. The better fix is a per-checkpoint gate judged against that
    // checkpoint's own radius; this default is the stopgap until then.
    const minFixAccuracy = rawConfig.minFixAccuracyMeters ?? 100;
    const confirmFixes = rawConfig.geofenceConfirmFixes ?? 2;
    // #67: re-evaluate a lingering player's runbook entries at most this often (default 2 min).
    const tripIntervalMs = Math.max(0, rawConfig.tripIntervalMinutes ?? 2) * 60_000;

    // Skip if the player is a GM (GMs don't trigger checkpoint arrivals). The member doc is
    // cached (#16); the mutable `outOfBounds` field is written through below.
    const member = await getMemberCached(gameId, userId);
    if (!member || member.role === 'gm') return;
    const playerFcmToken = member.fcmToken;
    const crossingDistrict = member.district;

    const db = admin.firestore();
    const memberRef = db.collection('games').doc(gameId).collection('members').doc(userId);
    const arrivalsCol = db.collection('games').doc(gameId).collection('arrivals');

    // Does this fix clear the GPS quality gate? Computed here rather than at the gate itself
    // so the breadcrumb below can record the verdict for fixes that are about to be dropped.
    //
    // `>=`, not `>`. Android's fused provider emits coarse network fixes with an accuracy of
    // exactly 100.0 m, which under `>` cleared a 100 m threshold by a single unit. Field-
    // measured 2026-08-15: those fixes repeated the previous position verbatim (0 m moved)
    // while the player was walking, i.e. precisely the stale positions this gate exists to
    // drop. Read the threshold as "must be better than this", so a fix that merely ties it
    // is rejected.
    const accuracyRejected = location.accuracy != null && location.accuracy >= minFixAccuracy;

    // A rejected fix is invisible everywhere else: the map dot still moves (the location
    // write happens above this trigger) while checkpoint evaluation is silently skipped.
    // That divergence cost two field tests, so say it out loud. Low volume by nature — a
    // healthy game rejects nothing.
    if (accuracyRejected) {
      functions.logger.info('[geofence] fix rejected by accuracy gate', {
        gameId, userId, accuracy: location.accuracy, minFixAccuracy,
      });
    }

    // --- Diagnostic breadcrumb trail (opt-in via config.locationTrail) ---
    // `locations/{playerId}` is overwritten by every fix, so a finished game preserves only
    // the last position plus whatever arrivals happened to fire. Reconstructing a six-minute
    // walk from four arrival records is how the last three field tests went. When enabled,
    // append every fix — including the rejected ones — with enough context to replay the
    // track offline: the reported position, its claimed accuracy, the distance moved since
    // the previous fix, and the distance to every checkpoint.
    if (rawConfig.locationTrail === true) {
      try {
        const trailCps = await getCheckpointsCached(gameId);
        const checkpointDistances: Record<string, number> = {};
        for (const cp of trailCps) {
          const { latitude: cpLat, longitude: cpLng, name } = cp.data as {
            latitude?: number; longitude?: number; name?: string;
          };
          if (typeof cpLat !== 'number' || typeof cpLng !== 'number') continue;
          checkpointDistances[name || cp.id] = Math.round(
            distanceMeters(location.latitude, location.longitude, cpLat, cpLng)
          );
        }
        await db.collection('games').doc(gameId).collection('locationTrail').add({
          playerId: userId,
          playerName: location.displayName ?? null,
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy ?? null,
          battery: location.battery ?? null,
          // #82: the fields that let a post-game read tell a real GNSS fix from a
          // network fallback, and a genuine jump from a stationary one. `speed: null`
          // is itself informative (no Doppler → probably Wi-Fi/cell), and `steps`
          // bounds how far the player could actually have moved since the last fix.
          speed: location.speed ?? null,
          mocked: location.mocked ?? null,
          steps: location.steps ?? null,
          // Steps taken since the previous fix — pair with `metersSincePrev` to separate
          // "they walked" from "the fix moved but they didn't".
          // A negative delta means the counter reset between fixes (the player left and
          // rejoined, or the app process was recycled), not that they walked backwards —
          // record null rather than a number that would silently corrupt the analysis.
          stepsSincePrev:
            typeof location.steps === 'number' &&
            typeof prevSteps === 'number' &&
            location.steps >= prevSteps
              ? location.steps - prevSteps
              : null,
          // Movement since the previous fix — the signal that separates "the phone stopped
          // reporting" from "the phone reported a position that didn't move".
          metersSincePrev: prevLoc
            ? Math.round(distanceMeters(
                prevLoc.latitude, prevLoc.longitude, location.latitude, location.longitude
              ))
            : null,
          accuracyRejected,
          minFixAccuracy,
          checkpointDistances,
          // Client clock vs. server clock: a large skew means the fix was cached on the
          // device and delivered late, which looks identical to a stale position otherwise.
          clientUpdatedAt: location.updatedAt ?? null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        // Never let a debugging aid break gameplay.
        functions.logger.warn('[geofence] locationTrail write failed', { gameId, userId, err });
      }
    }

    // Player-left-the-boundary alert (#7). Runs before checkpoint work so it fires even
    // in a game with zero checkpoints. A per-member `outOfBounds` latch means the GM is
    // pinged exactly once on exit and once on re-entry.
    const boundary = gameData.boundary as MapBoundary | undefined;
    if (boundary) {
      const inside = pointInBoundary(location.latitude, location.longitude, boundary);
      const wasOut = member.outOfBounds === true;
      if (!inside && !wasOut) {
        await memberRef.update({ outOfBounds: true });
        member.outOfBounds = true; // write through the #16 cache so the latch holds within the TTL
        const { tokens, phones } = await getGmRecipients(db, gameId, playerFcmToken);
        const body = `${location.displayName} left the play area`;
        await Promise.allSettled([
          sendPushToTokens(tokens, '🚧 Player left the area', body, 'arrivals'),
          sendArrivalSMS(phones, `BOUNDARY: ${body}`),
        ]);
      } else if (inside && wasOut) {
        await memberRef.update({ outOfBounds: false });
        member.outOfBounds = false; // write through the #16 cache
        const { tokens } = await getGmRecipients(db, gameId, playerFcmToken);
        await sendPushToTokens(
          tokens, '✅ Back in the area',
          `${location.displayName} re-entered the play area`, 'arrivals'
        );
      }
    }

    // GPS quality gate (#50): poor fixes are rejected from checkpoint eval — the map dot
    // still updates via the location write above. Reject is for checkpoint eval only.
    if (accuracyRejected) return;

    const checkpoints = await getCheckpointsCached(gameId);
    if (checkpoints.length === 0) return;

    // Runbook entries grouped by checkpoint (#60) — the behavior resolved per crossing.
    const runbookByCp = await getRunbookByCheckpointCached(gameId);
    const startedMs = gameData.startedAt?.toMillis?.() ?? null;

    // Batch-read trip latches for all checkpoints (#50/#55). One RPC for all docs.
    const tripsCol = db.collection('games').doc(gameId).collection('checkpointTrips');
    const entryTripsCol = db.collection('games').doc(gameId).collection('entryTrips'); // #67
    const tripRefs = checkpoints.map((cp) => tripsCol.doc(`${userId}_${cp.id}`));
    const tripSnaps = await db.getAll(...tripRefs);
    const tripMap = new Map<string, FirebaseFirestore.DocumentData | null>(
      checkpoints.map((cp, i) => [cp.id, tripSnaps[i].exists ? tripSnaps[i].data()! : null])
    );

    const nowMs = Date.now();

    // Effects to *push* from this location update: one entry per fired runbook entry, plus
    // district-suppression notes. A crossing that fires nothing is recorded as an arrival doc
    // but never lands here — bare arrivals don't push (#83).
    const newArrivals: Array<{
      checkpointName: string;
      playerName: string;
      event?: RunbookEffect;
      gmNote?: string;
    }> = [];

    /**
     * #67: fire at most ONE runbook entry per evaluation — the highest-priority eligible entry
     * this player hasn't tripped yet (ties → earliest createdAt). The rest wait for the next
     * tick: a lingering player is re-evaluated every `tripIntervalMinutes`, so a stack of events
     * on one checkpoint is doled out over time (the "2-minute rule") rather than all at once.
     * Each entry is latched once in `entryTrips/{userId}_{entryId}` via an atomic create, so it
     * never fires twice. Returns 1 if an entry fired, else 0.
     */
    async function fireEligibleEntries(
      entries: RunbookEntry[],
      ordinal: number | null,
      cpId: string,
      cp: { name: string; latitude: number; longitude: number }
    ): Promise<number> {
      const cpName = cp.name;
      for (const e of [...entries].sort(byPriorityThenAge)) {
        if (!entryTargetsPlayer(e, userId)) continue; // #80: not this player's entry
        const effect = eligibleEffect(e, ordinal, nowMs, startedMs);
        if (!effect) continue;
        try {
          // Denormalized so the GM notification feed (#73) reads it directly — one row per
          // entry that *actually* fired, with the delivered effect's kind/message.
          await entryTripsCol.doc(`${userId}_${e.id}`).create({
            playerId: userId,
            playerName: location.displayName,
            entryId: e.id,
            entryName: e.name ?? null,
            checkpointId: cpId,
            checkpointName: cpName,
            effectKind: effect.kind,
            message: effect.message ?? null,
            trippedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch {
          continue; // already tripped this entry — try the next-highest priority
        }
        newArrivals.push({ checkpointName: cpName, playerName: location.displayName, event: effect });

        // #80: the entry can also put the checkpoint on the player map for good — the
        // marker carries only the label + location, never the effect body.
        const revealTo = revealAudienceForEntry(e, userId);
        if (revealTo !== undefined) {
          await projectMarker(db, gameId, cpId, cp, revealTo);
        }
        return 1; // one per tick — the next eligible entry fires on the next re-eval
      }
      return 0;
    }

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
        // BOTH endpoints must be outside the radius. `pointToSegmentMeters` returns
        // <= radius whenever *either* endpoint is inside it, so a player DEPARTING a
        // checkpoint (prev inside → current outside) is geometrically identical to one
        // passing through it. `!trip.inside` was the only guard against that, and it is
        // legitimately false in several states — a partial confirm-streak, right after a
        // previous pass-through (which latches inside:false itself), or once a jittery
        // outside fix has reset it — so departures were being recorded as fresh arrivals
        // at the *current* fix, i.e. a checkpoint "arrival" logged 120m from the
        // checkpoint. Requiring prev to be outside makes this a true crossing test:
        // the path clips the circle strictly *between* two fixes.
        const prevDist = distanceMeters(
          prevLoc.latitude, prevLoc.longitude,
          cp.latitude, cp.longitude
        );
        if (prevDist > cp.radius) {
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

      const entries = runbookByCp.get(checkpointId) ?? [];

      // --- Already inside: re-evaluate entries on the GM cadence (#67) ---
      // A lingering player should still trip an entry that becomes eligible later (e.g. a
      // `timed` window opening) without leaving and re-entering — but at most every
      // `tripIntervalMinutes`, and each entry only once (entryTrips). Presence/arrival are
      // unchanged here: no new arrival doc, no streak change.
      if (trip?.inside) {
        const lastCheckMs =
          (trip.lastTripCheckAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ??
          (trip.lastEnterAt as admin.firestore.Timestamp | undefined)?.toMillis?.() ?? 0;
        if (nowMs - lastCheckMs < tripIntervalMs) continue;
        await tripRef.set(
          { lastTripCheckAt: admin.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        const ordinal = typeof trip.arrivalOrdinal === 'number' ? trip.arrivalOrdinal : null;
        await fireEligibleEntries(entries, ordinal, checkpointId, cp);
        processedIds.add(checkpointId);
        continue;
      }

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
      // A normal entry latches inside=true; a pass-through latches as already-exited (the
      // player is already gone), so a later return is seen as a fresh crossing.
      const enteredInside = !passThrough;

      // One transaction: count the arrival ordinal, apply district suppression (#5), then
      // atomically latch presence + record the arrival. The per-entry effect firing (#67)
      // happens after the txn — each entry is latched once in entryTrips.
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

        const latch: Record<string, unknown> = enteredInside
          ? {
              playerId: userId, checkpointId, inside: true, insideStreak: newStreak,
              lastEnterAt: admin.firestore.FieldValue.serverTimestamp(),
              lastTripCheckAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : {
              playerId: userId, checkpointId, inside: false, insideStreak: 0,
              lastEnterAt: admin.firestore.FieldValue.serverTimestamp(),
              lastExitAt: admin.firestore.FieldValue.serverTimestamp(),
              lastTripCheckAt: admin.firestore.FieldValue.serverTimestamp(),
            };
        // Latch the arrival ordinal on first arrival so the re-evaluation path (#67) resolves
        // this player's fixed-order slot consistently.
        if (!alreadyArrived) latch.arrivalOrdinal = ordinal;
        tx.set(tripRef, latch, { merge: true });

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

        return { ordinal, suppressed };
      });

      if (result === null) continue; // raced — another write confirmed entry first

      // Fire each eligible, not-yet-tripped runbook entry (#67) — unless this crossing is
      // district-suppressed (#5), in which case effects are withheld (and may fire on a later
      // re-eval tick, once the co-arrival window has passed).
      //
      // #83: a bare crossing — one where nothing in the runbook fired — is *recorded* (the
      // arrival doc written above) but never pushed. The GM reads plain crossings in the
      // notification feed's Arrivals rows; push/SMS is reserved for a crossing that actually
      // tripped something, so walking past scenery doesn't buzz the GM's phone mid-game.
      if (result.suppressed) {
        newArrivals.push({
          checkpointName: cp.name,
          playerName: location.displayName,
          gmNote: `${location.displayName} & a District ${crossingDistrict} partner arrived together at ${cp.name} — trap withheld`,
        });
      } else {
        await fireEligibleEntries(entries, result.ordinal, checkpointId, cp);
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
        pushed: true, // #69: pushed here, so onBroadcastCreate skips it
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
        pushed: true, // #69: pushed here, so onBroadcastCreate skips it
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    );
    if (args.crossingPlayerToken) {
      work.push(sendPushToTokens([args.crossingPlayerToken], title, body, 'broadcasts'));
    }
  }

  await Promise.allSettled(work);
}
