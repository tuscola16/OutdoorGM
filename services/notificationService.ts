import {
  getToken,
  requestPermission,
  registerDeviceForRemoteMessages,
  onMessage,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';
import { messaging } from './firebase';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  // `shouldShowAlert` was split into banner + list in expo-notifications SDK 54+.
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    const authStatus = await requestPermission(messaging);
    const enabled =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;
    if (!enabled) return false;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

export async function getFcmToken(): Promise<string | null> {
  try {
    await registerDeviceForRemoteMessages(messaging);
    const token = await getToken(messaging);
    return token;
  } catch (err) {
    console.error('Failed to get FCM token:', err);
    return null;
  }
}

export function onForegroundMessage(handler: (title: string, body: string) => void): () => void {
  return onMessage(messaging, async (remoteMessage) => {
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
