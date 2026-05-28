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

  await updatePlayerLocation(gameId, user.uid, displayName ?? user.phoneNumber ?? 'Player', {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? undefined,
    heading: location.coords.heading ?? undefined,
  });
});

export async function startLocationTracking(gameId: string, displayName: string): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_GAME_KEY, gameId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    throw new Error('PERMISSION_DENIED:Location access is required to play. Please enable it in Settings.');
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    throw new Error('PERMISSION_DENIED:Background location is required so tracking works when the app is in the background. In Settings, set location to "Always".');
  }

  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (!isRunning) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 10000,      // update every 10 seconds
      distanceInterval: 20,     // or every 20 meters
      foregroundService: {
        notificationTitle: 'Outdoor GM',
        notificationBody: 'Your location is being shared with your Game Master.',
        notificationColor: '#E8402A',
      },
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: false,
    });
  }
}

export async function stopLocationTracking(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_GAME_KEY);
  const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
