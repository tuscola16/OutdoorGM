import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/context/AuthContext';
import { Colors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { GameMap } from '@/components/GameMap';
import { BroadcastFeed } from '@/components/BroadcastFeed';
import { RationPanel } from '@/components/RationPanel';
import { Tutorial } from '@/components/Tutorial';
import * as Location from 'expo-location';
import { startLocationTracking, stopLocationTracking } from '@/services/locationTask';
import { onForegroundMessage } from '@/services/notificationService';
import { eliminatePlayer, raiseSos, setDeathLocation, gamePhase, gameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useElapsed, useRemaining, formatDuration } from '@/hooks/useElapsed';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { GameConfig, GamePhase, MapBoundary } from '@/types';

type Ts = FirebaseFirestoreTypes.Timestamp | null;

export default function PlayerGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [gameName, setGameName] = useState('');
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [rules, setRules] = useState<string>('');
  const [boundary, setBoundary] = useState<MapBoundary | null>(null);
  const [startedAt, setStartedAt] = useState<Ts>(null);
  const [endedAt, setEndedAt] = useState<Ts>(null);
  const [durationMinutes, setDurationMinutes] = useState(gameConfig(null).durationMinutes);
  const [batterySaver, setBatterySaver] = useState(gameConfig(null).batterySaver);
  const [config, setConfig] = useState<GameConfig>(gameConfig(null));

  // Empty until the member doc loads, so location tracking starts with the real
  // name rather than the "Player" placeholder. The tracking effect gates on it.
  const [displayName, setDisplayName] = useState('');
  const [out, setOut] = useState(false);
  const [outAt, setOutAt] = useState<Ts>(null);

  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);

  // Tracks whether we've ever observed our own membership doc, so we only treat a
  // *disappearing* doc (GM removed us) as a removal — not a not-yet-loaded one.
  const sawMemberRef = useRef(false);

  // Elapsed play time: ticks during play, freezes at outAt (if out) or endedAt.
  const frozenEnd = out ? outAt : phase === 'results' ? endedAt : null;
  const elapsed = useElapsed(startedAt, frozenEnd);
  const remaining = useRemaining(startedAt, durationMinutes, frozenEnd);

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
          setBoundary(d.boundary ?? null);
          setStartedAt(d.startedAt ?? null);
          setEndedAt(d.endedAt ?? null);
          setDurationMinutes(gameConfig(d as any).durationMinutes);
          setBatterySaver(gameConfig(d as any).batterySaver);
          setConfig(gameConfig(d as any));
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
          // The membership doc vanishing means the GM removed us from the game.
          // Stop sharing location immediately and leave — without this, the
          // background task keeps uploading our position even after removal.
          if (!snap.exists) {
            if (sawMemberRef.current) {
              stopLocationTracking().catch(() => {});
              Alert.alert('Removed from game', 'The Game Master has removed you from this game.');
              router.replace('/(app)/games');
            }
            return;
          }
          sawMemberRef.current = true;
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
    startLocationTracking(gameId, displayName, { batterySaver })
      .then(() => { setTracking(true); started = true; })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('PERMISSION_DENIED:')) {
          setPermissionDenied(true);
          setError(msg.replace('PERMISSION_DENIED:', ''));
        } else {
          setError(msg || 'Could not start location tracking.');
        }
      });
    return () => { if (started) stopLocationTracking().catch(console.error); };
  }, [gameId, displayName, phase, out, batterySaver]);

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
      'Mark yourself out?',
      'Honor system (Rule 16): if you were struck, remove yourself. You will stop sharing your location and your time will be locked in. You cannot rejoin this round.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: "I've been killed",
          style: 'destructive',
          onPress: async () => {
            if (!gameId || !user) return;
            try {
              await eliminatePlayer(gameId, user.uid, 'self');
              // Drop a pin where the player fell so the GM can recover their pack
              // and weapons (Rules 19, 20). Best-effort — never block elimination.
              try {
                const pos = await Location.getLastKnownPositionAsync();
                if (pos) {
                  await setDeathLocation(gameId, user.uid, {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                  });
                }
              } catch {
                /* location unavailable — skip the pin */
              }
              await stopLocationTracking();
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  function handleSos() {
    Alert.alert(
      'Send safety alert?',
      'This notifies the Game Master that you need assistance (Rule 22). Use it if you feel unsafe, are injured, or are too cold to continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send alert',
          style: 'destructive',
          onPress: async () => {
            if (!gameId || !user) return;
            try {
              await raiseSos(gameId, user.uid);
              Alert.alert('Alert sent', 'The Game Master has been notified and can see your location.');
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
        <Text style={styles.waitTitle}>You're in, {displayName || 'Player'}!</Text>
        <Text style={styles.waitSub}>
          Waiting for your Game Master to start the game. Keep this screen open.
        </Text>
        <TouchableOpacity style={styles.howToBtn} onPress={() => setShowTutorial(true)}>
          <Ionicons name="help-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.howToText}>How to play</Text>
        </TouchableOpacity>
        {gameId ? (
          <View style={styles.waitFeed}>
            <BroadcastFeed gameId={gameId} max={10} />
          </View>
        ) : null}
      </View>
    );
  }

  function renderPlay() {
    return (
      <>
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>TIME LEFT</Text>
          <Text style={[styles.timerValue, remaining === 0 && styles.timerValueDanger]}>
            {remaining != null ? formatDuration(remaining) : '—'}
          </Text>
          <Text style={styles.timerSub}>
            You've played {elapsed != null ? formatDuration(elapsed) : '0:00'}
          </Text>
        </View>

        {config.rationsEnabled && !out && user && (
          <RationPanel
            gameId={gameId!}
            player={{ userId: user.uid, displayName: displayName || 'Player' }}
            startedAt={startedAt}
            config={config}
          />
        )}

        <View style={styles.mapContainer}>
          {boundary ? (
            // Players see the play area and trails, but never their own position.
            <GameMap checkpoints={[]} playerLocations={[]} boundary={boundary} />
          ) : (
            <View style={[styles.map, styles.mapPlaceholder]}>
              <Ionicons name="map-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.locatingText}>Your Game Master hasn't set a play area.</Text>
            </View>
          )}
        </View>

        <BroadcastFeed gameId={gameId!} />

        {out ? (
          <View style={[styles.statusCard, { borderColor: Colors.danger }]}>
            <View style={[styles.statusDot, styles.inactiveDot]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>You're out</Text>
              <Text style={styles.statusSub}>
                Wave your red bandana overhead as you exit the arena (Rule 2).
              </Text>
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
            <Button title="I've been killed" onPress={handleMarkOut} variant="danger" />
            <TouchableOpacity style={styles.sosBtn} onPress={handleSos}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.sosText}>Safety alert — I need help</Text>
            </TouchableOpacity>
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
        <Text style={styles.waitSub}>That's how long you played, {displayName || 'Player'}. Nice work!</Text>
        <View style={{ height: 24 }} />
        <Button title="Back to My Games" onPress={() => router.replace('/(app)/games')} />
      </View>
    );
  }

  const isWaiting = phase === 'setup' || phase === 'lobby';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.gameName} numberOfLines={1}>{gameName || 'Game'}</Text>
          <Text style={styles.role}>Player · {displayName || 'Player'}</Text>
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
  waitFeed: { alignSelf: 'stretch', marginTop: 16 },
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
  timerValueDanger: { color: Colors.danger },
  timerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  mapContainer: { flex: 1, margin: 16, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  map: { flex: 1 },
  mapPlaceholder: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  locatingText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },

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
  outBtnWrap: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
  sosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.danger,
  },
  sosText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
});
