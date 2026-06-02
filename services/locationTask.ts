import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { updatePlayerLocation } from './gameService';
import auth from '@react-native-firebase/auth';

export const LOCATION_TASK_NAME = 'hgl-background-location';
export const ACTIVE_GAME_KEY = 'hgl_active_game';
export const DISPLAY_NAME_KEY = 'hgl_display_name';

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
  } catch (err) {
    // A single failed upload (transient network/permission) shouldn't crash the
    // background task — the next location update will retry.
    console.error('[LocationTask] location upload failed:', err);
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

export async function startLocationTracking(
  gameId: string,
  displayName: string,
  options: TrackingOptions = {}
): Promise<void> {
  // Foreground permission is the only hard requirement — it's enough to share
  // location while the app is open, which is when the GM is watching live.
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
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
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bgStatus === 'granted';
  } catch {
    bgGranted = false;
  }

  if (bgGranted) {
    // Stop any foreground watcher from a previous "While Using" session.
    if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
    if (!isRunning) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
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
      });
    }
  } else {
    // Foreground-only fallback (works with "While Using"). Restart it so it
    // captures the current gameId/displayName.
    if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
    foregroundSub = await Location.watchPositionAsync(
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
        } catch (err) {
          console.error('[Location] foreground upload failed:', err);
        }
      }
    );
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
