import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
      // MAX importance → heads-up banner + sound even when the app is backgrounded
      // or the phone is locked, so a GM/event alert can't be silently missed (#17).
      Notifications.setNotificationChannelAsync('arrivals', {
        name: 'Checkpoint Arrivals',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D4893F',
        sound: 'default',
      });
      // GM messages, hazard/boon events, death/winner & player-count pushes
      // (the geofence + broadcast functions push to channelId 'broadcasts').
      Notifications.setNotificationChannelAsync('broadcasts', {
        name: 'Game Alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#D4893F',
        sound: 'default',
      });
    }
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <GameProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
        </GameProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
