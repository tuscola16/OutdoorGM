import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updatePlayerLocation } from './gameService';
import auth from '@react-native-firebase/auth';

export const LOCATION_TASK_NAME = 'hgl-background-location';
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
  /** Most recent error (start or upload), or null. */
  lastError: string | null;
  updatedAt: number;
}

let _diag: TrackingDiagnostics = {
  foreground: 'unknown',
  background: 'unknown',
  path: 'none',
  startedAt: null,
  lastUploadAt: null,
  lastError: null,
  updatedAt: Date.now(),
};

export function getTrackingDiagnostics(): TrackingDiagnostics {
  return { ..._diag };
}

function setDiag(patch: Partial<TrackingDiagnostics>): void {
  _diag = { ..._diag, ...patch, updatedAt: Date.now() };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

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

  const user = auth().currentUser;
  if (!user) return;

  const gameId = await AsyncStorage.getItem(ACTIVE_GAME_KEY);
  const displayName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
  if (!gameId) return;

  try {
    await updatePlayerLocation(gameId, user.uid, displayName ?? user.email ?? 'Player', {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      heading: location.coords.heading ?? undefined,
    });
    setDiag({ lastUploadAt: Date.now(), lastError: null });
  } catch (err) {
    // A single failed upload (transient network/permission) shouldn't crash the
    // background task — the next location update will retry.
    console.error('[LocationTask] location upload failed:', err);
    setDiag({ lastError: `bg upload: ${errMsg(err)}` });
  }
});

// Foreground location watcher. Uploads while the app is open and works with only
// "While Using" permission, so a player who declines background location still
// shows up on the GM's map during active play. Held at module scope so we can
// stop it when tracking ends.
let foregroundSub: Location.LocationSubscription | null = null;

export interface TrackingOptions {
  /** Coarser cadence + balanced accuracy to conserve battery over a long game
   * (Rule 21). Falls back to high-accuracy 5s/10m when false. */
  batterySaver?: boolean;
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
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  setDiag({ foreground: fgStatus });
  if (fgStatus !== 'granted') {
    setDiag({ lastError: 'foreground permission denied' });
    throw new Error('PERMISSION_DENIED:Location access is required to play. Please enable it in Settings.');
  }

  // Tracking cadence: tighter when accuracy matters, looser to save battery.
  const accuracy = options.batterySaver ? Location.Accuracy.Balanced : Location.Accuracy.High;
  const timeInterval = options.batterySaver ? 15000 : 5000;
  const distanceInterval = options.batterySaver ? 30 : 10;

  await AsyncStorage.setItem(ACTIVE_GAME_KEY, gameId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  // Use exactly ONE location source — never both at once (running the foreground
  // watcher and the background task together produces redundant updates and
  // instability). Prefer the background task when "Always" is granted, since it
  // also fires while the app is foregrounded; otherwise fall back to a foreground
  // watcher that works with just "While Using" (uploads while the app is open).
  let bgGranted = false;
  try {
    // Time-box the background-permission request: on some Android builds it can
    // wedge (or sit behind a settings redirect) and would otherwise block the
    // foreground fallback below, leaving the player invisible to the GM.
    const { status: bgStatus } = await withTimeout(
      Location.requestBackgroundPermissionsAsync(),
      8000,
      'requestBackgroundPermissions'
    );
    bgGranted = bgStatus === 'granted';
    setDiag({ background: bgStatus });
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
            timeInterval,             // 5s normally, 15s in battery saver
            distanceInterval,         // 10m normally, 30m in battery saver
            foregroundService: {
              notificationTitle: 'Outdoor GM',
              notificationBody: 'Your location is being shared with your Game Master.',
              notificationColor: '#D4893F',
            },
            showsBackgroundLocationIndicator: true,
            pausesUpdatesAutomatically: false,
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
        { accuracy, timeInterval, distanceInterval: options.batterySaver ? 20 : 5 },
        async (pos) => {
          const user = auth().currentUser;
          if (!user) return;
          try {
            await updatePlayerLocation(gameId, user.uid, displayName, {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? undefined,
              heading: pos.coords.heading ?? undefined,
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
  await AsyncStorage.multiRemove([ACTIVE_GAME_KEY, DISPLAY_NAME_KEY]);
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
