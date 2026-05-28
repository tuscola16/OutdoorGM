import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import crashlytics from '@react-native-firebase/crashlytics';
import { AuthProvider } from '@/context/AuthContext';
import { GameProvider } from '@/context/GameContext';
import '@/services/locationTask';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    crashlytics().setCrashlyticsCollectionEnabled(!__DEV__);

    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('arrivals', {
        name: 'Checkpoint Arrivals',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#E8402A',
        sound: 'default',
      });
    }
    SplashScreen.hideAsync();
  }, []);

  return (
    <AuthProvider>
      <GameProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </GameProvider>
    </AuthProvider>
  );
}
