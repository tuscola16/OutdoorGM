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

export async function startLocationTracking(gameId: string, displayName: string): Promise<void> {
  // Foreground permission is the only hard requirement — it's enough to share
  // location while the app is open, which is when the GM is watching live.
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    throw new Error('PERMISSION_DENIED:Location access is required to play. Please enable it in Settings.');
  }

  await AsyncStorage.setItem(ACTIVE_GAME_KEY, gameId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  // Always run the foreground watcher (frequent updates, no background grant
  // needed). Restart it so it captures the current gameId/displayName.
  if (foregroundSub) { foregroundSub.remove(); foregroundSub = null; }
  foregroundSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 5 },
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

  // Background location is a *bonus* — it keeps tracking alive when the app is
  // backgrounded/screen-off. Never block tracking on it: if the player grants
  // only "While Using", the foreground watcher above still works.
  try {
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus === 'granted') {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (!isRunning) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,       // every 5 seconds
          distanceInterval: 10,     // or every 10 meters
          foregroundService: {
            notificationTitle: 'Outdoor GM',
            notificationBody: 'Your location is being shared with your Game Master.',
            notificationColor: '#D4893F',
          },
          showsBackgroundLocationIndicator: true,
          pausesUpdatesAutomatically: false,
        });
      }
    }
  } catch (err) {
    console.warn('[Location] background updates not started (foreground tracking still active):', err);
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
