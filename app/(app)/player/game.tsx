import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, Alert, TouchableOpacity, Linking,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { Tutorial } from '@/components/Tutorial';
import { startLocationTracking, stopLocationTracking } from '@/services/locationTask';
import { onForegroundMessage } from '@/services/notificationService';
import { markPlayerOut, gamePhase } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useElapsed, formatDuration } from '@/hooks/useElapsed';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { GamePhase } from '@/types';

type Ts = FirebaseFirestoreTypes.Timestamp | null;

export default function PlayerGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [gameName, setGameName] = useState('');
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [rules, setRules] = useState<string>('');
  const [startedAt, setStartedAt] = useState<Ts>(null);
  const [endedAt, setEndedAt] = useState<Ts>(null);

  const [displayName, setDisplayName] = useState('Player');
  const [out, setOut] = useState(false);
  const [outAt, setOutAt] = useState<Ts>(null);

  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Elapsed play time: ticks during play, freezes at outAt (if out) or endedAt.
  const frozenEnd = out ? outAt : phase === 'results' ? endedAt : null;
  const elapsed = useElapsed(startedAt, frozenEnd);

  // Subscribe to the game doc (phase, timing, rules) and own member doc.
  useEffect(() => {
    if (!gameId || !user) return;
    const unsubGame = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .onSnapshot(
        (snap) => {
          const d = snap.data();
          if (!d) return;
          setGameName(d.name ?? '');
          setPhase(gamePhase(d as any));
          setRules(d.rules ?? '');
          setStartedAt(d.startedAt ?? null);
          setEndedAt(d.endedAt ?? null);
        },
        (err) => console.error('[PlayerGame] game listener error', err)
      );

    const unsubMember = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .doc(user.uid)
      .onSnapshot(
        (snap) => {
          const d = snap.data();
          if (!d) return;
          setDisplayName(d.displayName ?? 'Player');
          setOut(!!d.out);
          setOutAt(d.outAt ?? null);
        },
        (err) => console.error('[PlayerGame] member listener error', err)
      );

    return () => { unsubGame(); unsubMember(); };
  }, [gameId, user]);

  // Show the intro tutorial once per game, while waiting in the lobby.
  useEffect(() => {
    if (!gameId || phase !== 'lobby') return;
    const key = `tutorial_seen_${gameId}`;
    AsyncStorage.getItem(key).then((seen) => {
      if (!seen) setShowTutorial(true);
    });
  }, [gameId, phase]);

  function dismissTutorial() {
    setShowTutorial(false);
    if (gameId) AsyncStorage.setItem(`tutorial_seen_${gameId}`, '1').catch(() => {});
  }

  // Track location only while actively playing and not out.
  useEffect(() => {
    if (!gameId || !displayName) return;
    const shouldTrack = phase === 'play' && !out;
    if (!shouldTrack) {
      setTracking(false);
      stopLocationTracking().catch(() => {});
      return;
    }
    let started = false;
    startLocationTracking(gameId, displayName)
      .then(() => { setTracking(true); started = true; })
      .catch((err: Error) => {
        if (err.message.startsWith('PERMISSION_DENIED:')) {
          setPermissionDenied(true);
          setError(err.message.replace('PERMISSION_DENIED:', ''));
        } else {
          setError(err.message);
        }
      });
    return () => { if (started) stopLocationTracking().catch(console.error); };
  }, [gameId, displayName, phase, out]);

  // Watch own location for the mini-map (only meaningful during play).
  useEffect(() => {
    if (phase !== 'play') return;
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
      (loc) => setMyLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude })
    )
      .then((s) => { sub = s; })
      .catch((err) => console.error('watchPositionAsync failed', err));
    return () => { sub?.remove(); };
  }, [phase]);

  useEffect(() => {
    return onForegroundMessage((title, body) => Alert.alert(title, body));
  }, []);

  function handleLeave() {
    Alert.alert('Leave Game?', 'Your location will stop being tracked.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          try {
            await stopLocationTracking();
          } catch (err) {
            console.error('stopLocationTracking failed', err);
          } finally {
            router.replace('/(app)/games');
          }
        },
      },
    ]);
  }

  function handleMarkOut() {
    Alert.alert(
      "Tap out?",
      'You will stop sharing your location and your time will be locked in. You cannot rejoin this round.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "I'm Out",
          style: 'destructive',
          onPress: async () => {
            if (!gameId || !user) return;
            try {
              await markPlayerOut(gameId, user.uid);
              await stopLocationTracking();
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  // --- Render per phase ---

  function renderWaiting() {
    return (
      <View style={styles.centerBody}>
        <View style={styles.waitIcon}>
          <Ionicons name="hourglass-outline" size={48} color={Colors.primary} />
        </View>
        <Text style={styles.waitTitle}>You're in, {displayName}!</Text>
        <Text style={styles.waitSub}>
          Waiting for your Game Master to start the game. Keep this screen open.
        </Text>
        <TouchableOpacity style={styles.howToBtn} onPress={() => setShowTutorial(true)}>
          <Ionicons name="help-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.howToText}>How to play</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderPlay() {
    return (
      <>
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>YOUR TIME</Text>
          <Text style={styles.timerValue}>{elapsed != null ? formatDuration(elapsed) : '0:00'}</Text>
        </View>

        <View style={styles.mapContainer}>
          {myLocation ? (
            <MapView
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              region={{ latitude: myLocation.latitude, longitude: myLocation.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
              showsUserLocation={false}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
            >
              <Marker coordinate={myLocation} anchor={{ x: 0.5, y: 0.5 }}>
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

        {out ? (
          <View style={[styles.statusCard, { borderColor: Colors.danger }]}>
            <View style={[styles.statusDot, styles.inactiveDot]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>You're out</Text>
              <Text style={styles.statusSub}>Your time is locked in. Hang tight for the results.</Text>
            </View>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <View style={[styles.statusDot, tracking ? styles.activeDot : styles.inactiveDot]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>{tracking ? 'Location Sharing Active' : 'Starting tracking…'}</Text>
              <Text style={styles.statusSub}>
                {tracking ? 'Your Game Master can see you in real time.' : 'Requesting location permission…'}
              </Text>
            </View>
          </View>
        )}

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            {permissionDenied && (
              <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.settingsBtn}>
                <Text style={styles.settingsBtnText}>Open Settings</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {!out && (
          <View style={styles.outBtnWrap}>
            <Button title="I'm Out" onPress={handleMarkOut} variant="danger" />
          </View>
        )}
      </>
    );
  }

  function renderResults() {
    return (
      <View style={styles.centerBody}>
        <View style={styles.waitIcon}>
          <Ionicons name="flag" size={44} color={Colors.primary} />
        </View>
        <Text style={styles.resultLabel}>{out ? 'YOU TAPPED OUT' : 'GAME OVER'}</Text>
        <Text style={styles.resultTime}>{elapsed != null ? formatDuration(elapsed) : '—'}</Text>
        <Text style={styles.waitSub}>That's how long you played, {displayName}. Nice work!</Text>
        <View style={{ height: 24 }} />
        <Button title="Back to My Games" onPress={() => router.replace('/(app)/games')} />
      </View>
    );
  }

  const isWaiting = phase === 'setup' || phase === 'lobby';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.gameName} numberOfLines={1}>{gameName || 'Game'}</Text>
          <Text style={styles.role}>Player · {displayName}</Text>
        </View>
        {phase !== 'results' && (
          <TouchableOpacity onPress={handleLeave} style={styles.leaveBtn}>
            <Ionicons name="exit-outline" size={20} color={Colors.danger} />
            <Text style={styles.leaveText}>Leave</Text>
          </TouchableOpacity>
        )}
      </View>

      {isWaiting && renderWaiting()}
      {phase === 'play' && renderPlay()}
      {phase === 'results' && renderResults()}

      <Tutorial visible={showTutorial} onDone={dismissTutorial} rules={rules} />
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

  // Waiting / results
  centerBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  waitIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 8,
  },
  waitTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  waitSub: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  howToBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, padding: 8 },
  howToText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  resultLabel: { color: Colors.textSecondary, fontWeight: '800', letterSpacing: 2, fontSize: 12, marginTop: 8 },
  resultTime: { color: Colors.text, fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] },

  // Play timer
  timerCard: {
    marginHorizontal: 16, marginTop: 4, alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  timerLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 1.5 },
  timerValue: { fontSize: 34, fontWeight: '800', color: Colors.text, fontVariant: ['tabular-nums'] },

  mapContainer: { flex: 1, margin: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  map: { flex: 1 },
  mapPlaceholder: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  locatingText: { color: Colors.textMuted, fontSize: 14 },
  myDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.playerDot, borderWidth: 3, borderColor: Colors.white },

  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  activeDot: { backgroundColor: Colors.success },
  inactiveDot: { backgroundColor: Colors.textMuted },
  statusTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  statusSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  errorBanner: {
    marginHorizontal: 16, marginBottom: 12, backgroundColor: Colors.danger + '22',
    borderRadius: 8, padding: 12, borderWidth: 1, borderColor: Colors.danger,
  },
  errorText: { color: Colors.danger, fontSize: 13, marginBottom: 8 },
  settingsBtn: {
    alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.danger,
  },
  settingsBtnText: { color: Colors.danger, fontSize: 13, fontWeight: '600' },
  outBtnWrap: { paddingHorizontal: 16, paddingBottom: 16 },
});
