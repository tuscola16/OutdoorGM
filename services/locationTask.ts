import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updatePlayerLocation } from './gameService';
import { isBatteryOptimized } from './batteryOptimization';
import { getSteps, startStepCounting, stopStepCounting } from './stepCounter';
import { startWakeLock, stopWakeLock, wakeLockHeld } from './wakeLock';
import { auth } from './firebase';

/**
 * #82 instrumentation: how long the app has been out of the foreground.
 *
 * The 2026-09-05 walk was confounded by something invisible in the data — one player
 * checked their phone repeatedly while the other never unlocked theirs, and *that*, not
 * the handset, explained a 13m vs 38m accuracy split. Screen state alone wouldn't have
 * caught it either: the checked phone's "background" fixes were still good, because it
 * never settled into deep idle. Doze depth is a function of how long the device has been
 * left alone, so record the duration, not just the state.
 */
let lastForegroundAt: number = Date.now();
AppState.addEventListener('change', (s) => {
  if (s === 'active') lastForegroundAt = Date.now();
});

/** Per-fix capture context (#82) — recorded, never acted on. */
async function captureContext(): Promise<{
  appState: string;
  msSinceForeground: number;
  batteryOptimized?: boolean;
  wakeLock: boolean;
}> {
  const state = AppState.currentState ?? 'unknown';
  return {
    appState: String(state),
    // When the app is active *right now*, age is zero by definition — the listener above
    // only fires on transitions, so a long-foregrounded session would otherwise report a
    // stale age.
    msSinceForeground: state === 'active' ? 0 : Date.now() - lastForegroundAt,
    batteryOptimized: await isBatteryOptimized().catch(() => undefined),
    wakeLock: wakeLockHeld(),
  };
}

export const LOCATION_TASK_NAME = 'hgl-background-location';
export const GEOFENCE_TASK_NAME = 'hgl-checkpoint-geofence';
export const ACTIVE_GAME_KEY = 'hgl_active_game';
export const DISPLAY_NAME_KEY = 'hgl_display_name';

// --- Tracking diagnostics ----------------------------------------------------
// A debugging aid surfaced on the player screen. Because startLocationTracking
// can hang on a wedged native call (before its promise resolves), the UI can't
// tell *where* it stalled from the resolved/rejected state alone. So we stamp a
// module-level record at each milestone; the player screen polls it. The last
// field that advanced tells us which native call wedged.
export type TrackingPath = 'none' | 'background-service' | 'foreground-watch';
export interface TrackingDiagnostics {
  /** Foreground permission status from the last start attempt. */
  foreground: string;
  /** Background ("Always") permission status, or 'error'/'timeout'. */
  background: string;
  /** Which source actually engaged. 'none' while still starting (or wedged). */
  path: TrackingPath;
  /** ms when a source successfully engaged (setup resolved). */
  startedAt: number | null;
  /** ms of the most recent successful location upload. */
  lastUploadAt: number | null;
  /** Android only: true when battery optimization is still on (Doze will stop background
   * location when the screen locks even though the service is running). null = unknown/iOS. */
  batteryOptimized: boolean | null;
  /** Most recent error (start or upload), or null. */
  lastError: string | null;
  /** ms of the most recent OS-geofence wake-up upload, or null if none yet. */
  lastGeofenceWakeAt: number | null;
  /** How many checkpoint regions the OS is currently watching (0 = geofencing off). */
  geofencedRegions: number;
  /**
   * Why geofencing isn't armed, or null when it is (or was never attempted).
   *
   * Separate from `lastError` on purpose: the upload path clears `lastError` on every
   * successful write, which happens every few seconds. A geofence failure written there
   * was reliably erased before anyone could read it — field-observed 2026-08-15, where
   * the card showed "none armed" alongside "Last error: none" and the actual cause
   * (permission not yet granted on a fresh install) was invisible.
   */
  geofenceError: string | null;
  /**
   * #82: is the partial CPU wake lock currently held? Android only (always false
   * elsewhere). Surfaced so a field test can confirm the A/B arm a player is actually in,
   * rather than assuming the config flag took effect.
   */
  wakeLock: boolean;
  updatedAt: number;
}

let _diag: TrackingDiagnostics = {
  foreground: 'unknown',
  background: 'unknown',
  path: 'none',
  startedAt: null,
  lastUploadAt: null,
  batteryOptimized: null,
  lastError: null,
  lastGeofenceWakeAt: null,
  geofencedRegions: 0,
  geofenceError: null,
  wakeLock: false,
  updatedAt: Date.now(),
};

export function getTrackingDiagnostics(): TrackingDiagnostics {
  return { ..._diag };
}

function setDiag(patch: Partial<TrackingDiagnostics>): void {
  _diag = { ..._diag, ...patch, updatedAt: Date.now() };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Current battery level 0–1 (#35), or `undefined` if it can't be read (emulator, denied,
 * or transient error) — callers omit the field in that case rather than reporting a fake 0. */
async function readBattery(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    // expo-battery returns -1 when the level is unavailable.
    return typeof level === 'number' && level >= 0 ? level : undefined;
  } catch {
    return undefined;
  }
}

// Define the background task — must be at module top level
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[LocationTask] Error:', error.message);
    return;
  }
  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  const location = locations[0];
  if (!location) return;

  const user = auth.currentUser;
  if (!user) return;

  const gameId = await AsyncStorage.getItem(ACTIVE_GAME_KEY);
  const displayName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
  if (!gameId) return;

  // #82: this task can run in a FRESH JS context — when Android reclaims the app process
  // and restarts it headlessly to deliver a location, module state is re-initialised and
  // the startStepCounting() call in startLocationTracking() never happened here. Without
  // this, getSteps() would return undefined for every fix from a recycled process, i.e.
  // the step instrument would silently no-op in exactly the pocketed/locked case it exists
  // to measure. Idempotent (early-returns once subscribed), so the cost after the first
  // fix is nil, and it never prompts: permission was already granted in the foreground.
  await startStepCounting().catch(() => {});

  try {
    await updatePlayerLocation(gameId, user.uid, displayName ?? user.email ?? 'Player', {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      heading: location.coords.heading ?? undefined,
      battery: await readBattery(),
      // #82 diagnostics — recorded, never acted on.
      speed: location.coords.speed ?? undefined,
      mocked: location.mocked ?? undefined,
      steps: await getSteps(),
      ...(await captureContext()),
    });
    setDiag({ lastUploadAt: Date.now(), lastError: null });
  } catch (err) {
    // A single failed upload (transient network/permission) shouldn't crash the
    // background task — the next location update will retry.
    console.error('[LocationTask] location upload failed:', err);
    setDiag({ lastError: `bg upload: ${errMsg(err)}` });
  }
});

/**
 * Checkpoint geofence task — a WAKE-UP TRIGGER, not an arrival detector.
 *
 * Android throttles background location hard once the device is stationary with the screen
 * off (Doze). Field-measured: upload cadence collapses from ~15s to ~90s, so a checkpoint
 * crossing could take over two minutes to register even when everything else was working.
 * The OS geofence fires on region entry *even in Doze*, so this task exists solely to force
 * an immediate location upload the moment the player crosses into a checkpoint.
 *
 * It deliberately does NOT write an arrival. The Cloud Function still receives the location
 * write and decides whether the player arrived, so arrivals stay server-authoritative and a
 * client can't forge one. All this buys is latency — which is the whole problem.
 *
 * On Exit we do nothing: departures aren't interesting, and firing an upload on exit was
 * exactly the pattern that produced spurious "arrivals" server-side (#49).
 */
TaskManager.defineTask(GEOFENCE_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[Geofence] task error:', error.message);
    return;
  }
  const { eventType } = (data ?? {}) as { eventType?: Location.LocationGeofencingEventType };
  if (eventType !== Location.LocationGeofencingEventType.Enter) return;

  const user = auth.currentUser;
  if (!user) return;
  const gameId = await AsyncStorage.getItem(ACTIVE_GAME_KEY);
  const displayName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
  if (!gameId) return;

  try {
    // A fresh high-accuracy fix, not the last-known one — the point is to hand the server a
    // position good enough to clear its accuracy gate and land inside the radius.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    await updatePlayerLocation(gameId, user.uid, displayName ?? user.email ?? 'Player', {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? undefined,
      heading: pos.coords.heading ?? undefined,
      battery: await readBattery(),
      speed: pos.coords.speed ?? undefined,   // #82
      mocked: pos.mocked ?? undefined,        // #82
      steps: await getSteps(),                // #82
      ...(await captureContext()),            // #82
    });
    setDiag({ lastUploadAt: Date.now(), lastGeofenceWakeAt: Date.now(), lastError: null });
  } catch (err) {
    console.error('[Geofence] wake-up upload failed:', err);
    setDiag({ lastError: `geofence wake: ${errMsg(err)}` });
  }
});

/**
 * Register OS geofences for a game's checkpoints. Best-effort: geofencing needs background
 * location permission, and a failure here only costs latency — the normal cadence still
 * detects crossings server-side. Re-registering replaces the previous region set.
 *
 * Android caps geofences at 100 per app; games are far below that, but slice defensively.
 */
export async function startCheckpointGeofencing(
  regions: { id: string; latitude: number; longitude: number; radius: number }[]
): Promise<boolean> {
  try {
    if (regions.length === 0) {
      await stopCheckpointGeofencing();
      setDiag({ geofenceError: 'no checkpoints to watch' });
      return false;
    }
    const { status } = await Location.getBackgroundPermissionsAsync();
    if (status !== 'granted') {
      // Previously a bare `return false`: geofencing silently never armed, `geofencedRegions`
      // stayed 0, and the caller discards the return value — so there was no way, on the
      // device or in Firestore, to tell "armed and didn't fire" from "never armed".
      //
      // This is the single most likely failure in practice, and it is transient: on a fresh
      // install the player screen mounts before "Always" location has been granted. The
      // caller retries, so this is a status, not a dead end.
      setDiag({
        geofenceError: `background permission is '${status}' — waiting for the grant`,
        geofencedRegions: 0,
      });
      return false;
    }
    await Location.startGeofencingAsync(
      GEOFENCE_TASK_NAME,
      regions.slice(0, 100).map((r) => ({
        identifier: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        // Give the OS a slightly larger circle than the game's: it should wake us as the
        // player approaches so the resulting fix lands INSIDE the real radius. The server
        // still enforces the true radius, so a wide wake-up can't create a false arrival.
        radius: Math.max(r.radius * 1.5, r.radius + 25),
        notifyOnEnter: true,
        notifyOnExit: false,
      }))
    );
    // Confirm with the OS rather than assuming the call above took effect — `geofencedRegions`
    // is a diagnostic, and a diagnostic that reports what we *asked for* instead of what is
    // actually armed is worse than none at all.
    const armed = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false);
    if (!armed) {
      setDiag({
        geofenceError: 'startGeofencingAsync resolved but nothing is armed',
        geofencedRegions: 0,
      });
      return false;
    }
    setDiag({ geofencedRegions: regions.length, geofenceError: null });
    return true;
  } catch (err) {
    console.error('[Geofence] could not start geofencing:', err);
    setDiag({ geofenceError: `start failed: ${errMsg(err)}`, geofencedRegions: 0 });
    return false;
  }
}

/**
 * Is the OS currently watching our checkpoint regions? Asks the OS rather than reporting a
 * cached flag, so the retry loop notices if the system drops the regions out from under us
 * (and so a stale in-memory `true` can't suppress a re-registration that is actually needed).
 */
export async function isCheckpointGeofencingArmed(): Promise<boolean> {
  try {
    return await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME);
  } catch {
    return false;
  }
}

/** Tear down checkpoint geofences (leaving a game / tracking stopped). */
export async function stopCheckpointGeofencing(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK_NAME).catch(() => false)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK_NAME);
    }
  } catch { /* best effort */ }
  setDiag({ geofencedRegions: 0 });
}

// Foreground location watcher. Uploads while the app is open and works with only
// "While Using" permission, so a player who declines background location still
// shows up on the GM's map during active play. Held at module scope so we can
// stop it when tracking ends.
let foregroundSub: Location.LocationSubscription | null = null;

export interface TrackingOptions {
  /** Coarser cadence + balanced accuracy to conserve battery over a long game
   * (Rule 21). Falls back to high-accuracy 5s/10m when false. */
  batterySaver?: boolean;
  /**
   * #82: hold a partial CPU wake lock for the duration of tracking (Android only).
   * Gated by `GameConfig.wakeLockEnabled` so it can be A/B'd across players in a single
   * walk — the one capture-layer variable in this build, deliberately isolated so the
   * measurement isn't confounded. Costs battery; that's the trade being measured.
   */
  wakeLock?: boolean;
}

/** Reject if `p` hasn't settled within `ms` — so a wedged native call (e.g. a
 * foreground service that won't start on Android 14) can't hang tracking forever. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function startLocationTracking(
  gameId: string,
  displayName: string,
  options: TrackingOptions = {}
): Promise<void> {
  // Reset the per-attempt diagnostics (keep lastUploadAt — it's useful history).
  setDiag({ path: 'none', startedAt: null, lastError: null });

  // Foreground permission is the only hard requirement — it's enough to share
  // location while the app is open, which is when the GM is watching live.
  // Time-box the request: a *concurrent* permission request elsewhere (e.g. the
  // lobby primer) can leave requestForegroundPermissionsAsync pending forever, which
  // would wedge tracking on "Starting tracking…". On timeout, fall back to the
  // current status instead of hanging.
  let fgStatus: string;
  try {
    fgStatus = (await withTimeout(
      Location.requestForegroundPermissionsAsync(),
      12000,
      'requestForegroundPermissions'
    )).status;
  } catch {
    fgStatus = (await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'undetermined' }))).status;
  }
  setDiag({ foreground: fgStatus });
  if (fgStatus !== 'granted') {
    setDiag({ lastError: 'foreground permission denied' });
    throw new Error('PERMISSION_DENIED:Location access is required to play. Please enable it in Settings.');
  }

  // Record whether Doze is still allowed to throttle us. Best-effort + non-blocking — this
  // only drives diagnostics/warnings, never whether tracking starts.
  isBatteryOptimized().then((opt) => setDiag({ batteryOptimized: opt })).catch(() => {});

  // #82: start the step counter — a recording instrument only (see services/stepCounter.ts).
  // Deliberately fire-and-forget and deliberately AFTER the foreground-location grant above:
  // it prompts for ACTIVITY_RECOGNITION on Android 10+, and stacking an optional prompt in
  // front of the critical one is how a player ends up declining both. Tracking must never
  // wait on it, and a decline must never be an error.
  startStepCounting().catch(() => {});

  // #82: hold the CPU awake for the duration of tracking when the game opts in. Must come
  // before the location request below so the very first fixes are already covered.
  if (options.wakeLock) {
    const held = startWakeLock();
    setDiag({ wakeLock: held });
  } else {
    stopWakeLock();
    setDiag({ wakeLock: false });
  }

  // Tracking cadence: tighter when accuracy matters, looser to save battery.
  //
  // BestForNavigation (not High) in normal mode: field-measured 2026-08-14, a pocketed
  // phone reported ~52m accuracy while walking and 40.1m while standing AT a 40m-radius
  // checkpoint — i.e. fixes were landing just outside the circle and the crossing only
  // registered via #49 segment detection. BestForNavigation keeps the GPS hot instead of
  // letting the fused provider fall back to network positioning, which is what produces
  // those 40-50m fixes. It costs battery, so batterySaver still uses Balanced.
  const accuracy = options.batterySaver
    ? Location.Accuracy.Balanced
    : Location.Accuracy.BestForNavigation;
  // 3s requested (was 5s). Observed cadence has been ~15s with ~90s gaps once the device
  // idles, so the request is NOT currently the binding constraint — Android is coalescing.
  // Asking for less can only help, but the real fix for the gaps is elsewhere; measure
  // before assuming this changed anything.
  const timeInterval = options.batterySaver ? 15000 : 3000;
  // Never let the OS batch/defer updates: deferred delivery is exactly the "player stands
  // still and stops reporting" failure we keep hitting. Explicit rather than relying on
  // the library default staying 0.
  const deferredUpdatesInterval = 0;
  const deferredUpdatesDistance = 0;
  // distanceInterval MUST be 0 (purely time-based updates). A non-zero displacement
  // filter means the OS delivers nothing while the player stands still — so a player
  // waiting at a checkpoint (or just standing) stops uploading: the geofence never gets
  // a write inside the radius (no event), and the GM sees them go stale within ~2 min.
  // Time-based updates keep them reporting and fire checkpoints even when stationary/locked.
  const distanceInterval = 0;

  await AsyncStorage.setItem(ACTIVE_GAME_KEY, gameId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  // Use exactly ONE location source — never both at once (running the foreground
  // watcher and the background task together produces redundant updates and
  // instability). Prefer the background task when "Always" is granted, since it
  // also fires while the app is foregrounded; otherwise fall back to a foreground
  // watcher that works with just "While Using" (uploads while the app is open).
  let bgGranted = false;
  try {
    // Check the *current* background ("Allow all the time") grant first — this is instant and
    // never prompts. If the player already granted it, trust it and skip
    // requestBackgroundPermissionsAsync(): that request can wedge for ~seconds (on Android it
    // sits behind the Settings redirect on 11+; on iOS it can hang even when already granted),
    // and the old code's 8s timeout was wrongly flipping a fully-permissioned player to the
    // foreground-only watcher ("you'll vanish when locked" despite "Allow all the time").
    let bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted && bg.canAskAgain) {
      // Not granted yet but we may ask — time-box the prompt (on Android it can wedge behind
      // the settings redirect and would otherwise block the foreground fallback).
      try {
        bg = await withTimeout(
          Location.requestBackgroundPermissionsAsync(),
          8000,
          'requestBackgroundPermissions'
        );
      } catch (err) {
        // The prompt hung/threw — fall back to the current grant so an already-"Always"
        // player (whose request hangs) still ends up on the background service.
        setDiag({ lastError: `bg permission request: ${errMsg(err)}` });
        bg = await Location.getBackgroundPermissionsAsync().catch(() => bg);
      }
    }
    bgGranted = bg.status === 'granted';
    setDiag({ background: bg.status });
  } catch (err) {
    bgGranted = false;
    setDiag({ background: 'error', lastError: `bg permission: ${errMsg(err)}` });
  }

  // Try the background task when "Always" is granted (it also fires while
  // foregrounded). If it can't start — e.g. the Android 14 location foreground
  // service is unavailable or wedged — don't leave the player invisible: fall back
  // to a foreground watcher, which needs no foreground-service permission and
  // uploads while the app is open (when the GM is most likely watching live).
  let backgroundActive = false;
  if (bgGranted) {
    try {
      // Stop any foreground watcher from a previous "While Using" session.
      if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (!isRunning) {
        await withTimeout(
          Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy,
            timeInterval,             // 3s normally, 15s in battery saver
            distanceInterval,         // always 0 — see the note above
            deferredUpdatesInterval,  // 0 — no OS batching
            deferredUpdatesDistance,  // 0 — no OS batching
            // Fitness activity + never auto-pause: iOS otherwise suspends updates
            // when it thinks the player is stationary, dropping them off the map.
            activityType: Location.ActivityType.Fitness,
            pausesUpdatesAutomatically: false,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: 'Outdoor GM',
              notificationBody: 'Your location is being shared with your Game Master.',
              notificationColor: '#D4893F',
              // Keep the location service (and uploads) alive even if the player
              // swipes the app away — they must stay on the GM's map until they
              // actually leave the game, not just while the app is foregrounded.
              killServiceOnDestroy: false,
            },
          }),
          10000,
          'startLocationUpdatesAsync'
        );
      }
      backgroundActive = true;
      setDiag({ path: 'background-service', startedAt: Date.now(), lastError: null });
    } catch (err) {
      console.error('[Location] background updates unavailable, falling back to foreground watcher:', err);
      setDiag({ lastError: `bg start: ${errMsg(err)}` });
      // Tear down any half-started background task so we don't run two sources.
      try {
        if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false)) {
          await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
        }
      } catch { /* best effort */ }
    }
  }

  if (!backgroundActive) {
    // Foreground watcher — used when only "While Using" is granted, or as a
    // fallback when the background service couldn't start. Restart it so it
    // captures the current gameId/displayName.
    if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
    foregroundSub = await withTimeout(
      Location.watchPositionAsync(
        // distanceInterval 0 → time-based updates even while stationary (see above).
        { accuracy, timeInterval, distanceInterval: 0 },
        async (pos) => {
          const user = auth.currentUser;
          if (!user) return;
          try {
            await updatePlayerLocation(gameId, user.uid, displayName, {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? undefined,
              heading: pos.coords.heading ?? undefined,
              battery: await readBattery(),
              speed: pos.coords.speed ?? undefined,   // #82
              mocked: pos.mocked ?? undefined,        // #82
              steps: await getSteps(),                // #82
              ...(await captureContext()),            // #82
            });
            setDiag({ lastUploadAt: Date.now(), lastError: null });
          } catch (err) {
            console.error('[Location] foreground upload failed:', err);
            setDiag({ lastError: `fg upload: ${errMsg(err)}` });
          }
        }
      ),
      10000,
      'watchPositionAsync'
    );
    setDiag({ path: 'foreground-watch', startedAt: Date.now() });
  }
}

export async function stopLocationTracking(): Promise<void> {
  if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
  await stopStepCounting().catch(() => {}); // #82 — best effort, never blocks teardown
  stopWakeLock();                           // #82 — never leave the CPU pinned after a game
  await AsyncStorage.multiRemove([ACTIVE_GAME_KEY, DISPLAY_NAME_KEY]);
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
