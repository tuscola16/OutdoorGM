import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, Alert, TouchableOpacity
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { startLocationTracking, stopLocationTracking } from '@/services/locationTask';
import { onForegroundMessage } from '@/services/notificationService';
import firestore from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { GameStatus } from '@/types';

export default function PlayerGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [gameName, setGameName] = useState('');
  const [gameStatus, setGameStatus] = useState<GameStatus>('active');
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [displayName, setDisplayName] = useState('Player');
  const [error, setError] = useState('');
  const endedRef = useRef(false);

  // Handle game-ended state
  useEffect(() => {
    if (gameStatus !== 'ended' || endedRef.current) return;
    endedRef.current = true;
    stopLocationTracking().catch(console.error);
    Alert.alert(
      'Game Over',
      'The game has ended. Thanks for playing!',
      [{ text: 'OK', onPress: () => router.replace('/(app)/games') }]
    );
  }, [gameStatus]);

  // Load game name and member info
  useEffect(() => {
    if (!gameId || !user) return;
    const unsubGame = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .onSnapshot((snap) => {
        if (snap.exists) {
          setGameName(snap.data()?.name ?? '');
          if (snap.data()?.status === 'ended') setGameStatus('ended');
        }
      });

    const unsubMember = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .doc(user.uid)
      .onSnapshot((snap) => {
        if (snap.exists) setDisplayName(snap.data()?.displayName ?? 'Player');
      });

    return () => { unsubGame(); unsubMember(); };
  }, [gameId, user]);

  // Start tracking on mount, stop on unmount
  useEffect(() => {
    if (!gameId || !displayName) return;
    let started = false;
    startLocationTracking(gameId, displayName)
      .then(() => { setTracking(true); started = true; })
      .catch((err) => setError(err.message));

    return () => {
      if (started) stopLocationTracking().catch(console.error);
    };
  }, [gameId, displayName]);

  // Watch own location for the mini-map
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
      (loc) => setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
    ).then((s) => { sub = s; });
    return () => { sub?.remove(); };
  }, []);

  // Listen for foreground FCM messages (e.g. if this player is also a GM in another game)
  useEffect(() => {
    return onForegroundMessage((title, body) => {
      Alert.alert(title, body);
    });
  }, []);

  function handleLeave() {
    Alert.alert(
      'Leave Game?',
      'Your location will stop being tracked.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await stopLocationTracking();
            router.replace('/(app)/games');
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.gameName}>{gameName}</Text>
          <Text style={styles.role}>You are a Player</Text>
        </View>
        <TouchableOpacity onPress={handleLeave} style={styles.leaveBtn}>
          <Ionicons name="exit-outline" size={20} color={Colors.danger} />
          <Text style={styles.leaveText}>Leave</Text>
        </TouchableOpacity>
      </View>

      {/* Mini-map showing only the player's own location */}
      <View style={styles.mapContainer}>
        {myLocation ? (
          <MapView
            style={styles.map}
            provider={PROVIDER_GOOGLE}
            region={{
              latitude: myLocation.latitude,
              longitude: myLocation.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            }}
            showsUserLocation={false}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
          >
            <Marker
              coordinate={myLocation}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.myDot} />
            </Marker>
          </MapView>
        ) : (
          <View style={[styles.map, styles.mapPlaceholder]}>
            <Ionicons name="locate-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.locatingText}>Getting location…</Text>
          </View>
        )}
      </View>

      <View style={styles.statusCard}>
        <View style={[styles.statusDot, tracking ? styles.activeDot : styles.inactiveDot]} />
        <View>
          <Text style={styles.statusTitle}>
            {tracking ? 'Location Sharing Active' : 'Starting tracking…'}
          </Text>
          <Text style={styles.statusSub}>
            {tracking
              ? 'Your Game Master can see your location in real time.'
              : 'Requesting location permission…'}
          </Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.playerNote}>
        <Ionicons name="eye-off-outline" size={16} color={Colors.textMuted} style={{ marginRight: 6 }} />
        <Text style={styles.noteText}>
          You cannot see other players or checkpoints. Only your Game Master has that view.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  gameName: { fontSize: 20, fontWeight: '800', color: Colors.text },
  role: { fontSize: 13, color: Colors.primary, marginTop: 2 },
  leaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  leaveText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
  mapContainer: {
    flex: 1,
    margin: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  map: { flex: 1 },
  mapPlaceholder: {
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  locatingText: { color: Colors.textMuted, fontSize: 14 },
  myDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.playerDot,
    borderWidth: 3,
    borderColor: Colors.white,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: 16,
    marginTop: 0,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  activeDot: { backgroundColor: Colors.success },
  inactiveDot: { backgroundColor: Colors.textMuted },
  statusTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  statusSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  errorBanner: {
    marginHorizontal: 16,
    backgroundColor: Colors.danger + '22',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  errorText: { color: Colors.danger, fontSize: 13 },
  playerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 16,
    marginTop: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
  },
  noteText: { flex: 1, color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
});
