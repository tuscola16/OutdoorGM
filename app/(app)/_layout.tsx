import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { getFcmToken, requestNotificationPermissions } from '@/services/notificationService';

export default function AppLayout() {
  const { user, loading, updateProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/(auth)/phone');
    }
  }, [user, loading]);

  // Request notification permissions and save FCM token once authenticated
  useEffect(() => {
    if (!user) return;
    (async () => {
      const granted = await requestNotificationPermissions();
      if (granted) {
        const token = await getFcmToken();
        if (token) await updateProfile({ fcmToken: token });
      }
    })();
  }, [user]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}
    />
  );
}
