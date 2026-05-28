import messaging from '@react-native-firebase/messaging';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) return false;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getFcmToken(): Promise<string | null> {
  try {
    await messaging().registerDeviceForRemoteMessages();
    const token = await messaging().getToken();
    return token;
  } catch (err) {
    console.error('Failed to get FCM token:', err);
    return null;
  }
}

export function onForegroundMessage(handler: (title: string, body: string) => void): () => void {
  return messaging().onMessage(async (remoteMessage) => {
    const title = remoteMessage.notification?.title ?? 'Alert';
    const body = remoteMessage.notification?.body ?? '';
    handler(title, body);
    // Also show a local notification since FCM doesn't auto-display in foreground
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  });
}
