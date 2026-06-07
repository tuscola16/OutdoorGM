import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, TouchableOpacity, Linking, AppState, ScrollView, Keyboard,
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
import { AlertOverlay } from '@/components/AlertOverlay';
import { LobbyPermissions } from '@/components/LobbyPermissions';
import { RationPanel } from '@/components/RationPanel';
import { Tutorial } from '@/components/Tutorial';
import { BroadcastsProvider } from '@/context/BroadcastsContext';
import * as Location from 'expo-location';
import { startLocationTracking, stopLocationTracking, getTrackingDiagnostics } from '@/services/locationTask';
import { eliminatePlayer, raiseSos, setDeathLocation, gamePhase, gameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useElapsed, useRemaining, formatDuration } from '@/hooks/useElapsed';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { GameConfig, GamePhase, MapBoundary, RevealedMarker } from '@/types';

type Ts = FirebaseFirestoreTypes.Timestamp | null;

export default function PlayerGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [gameName, setGameName] = useState('');
  const [phase, setPhase] = useState<GamePhase>('setup');
  const [rules, setRules] = useState<string>('');
  const [boundary, setBoundary] = useState<MapBoundary | null>(null);
  // Revealed checkpoint markers (#48) this player is allowed to see — the only
  // checkpoint data a player ever gets (the `checkpoints` collection stays GM-only).
  const [markers, setMarkers] = useState<RevealedMarker[]>([]);
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
  // Play screen has two views — a full-screen Map and a Stats view — because the
  // map was unusably small when crammed in with everything else (#20).
  const [playTab, setPlayTab] = useState<'map' | 'stats'>('map');
  // Hide the pinned action bar while the keyboard is up, so the "I've been killed" /
  // SOS buttons don't float over the ration-card input (they're back the moment the
  // keyboard closes; the buttons also live at the end of the scrollable Stats view).
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardUp(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Tracking diagnostics — polled from the location service so a player (e.g. one
  // stuck on "Starting tracking…") can tap the status card to see exactly where
  // startup stalled: permission states, which source engaged, last upload, last error.
  const [diag, setDiag] = useState(getTrackingDiagnostics());
  const [showDiag, setShowDiag] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setDiag(getTrackingDiagnostics()), 2000);
    return () => clearInterval(id);
  }, []);

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

  // Subscribe to revealed checkpoint markers (#48) — global ones (audiencePlayerIds
  // null) plus ones aimed at this player (array-contains uid). Firestore can't OR those
  // in one query, so we run two listeners and merge (same shape as the broadcast feed).
  useEffect(() => {
    if (!gameId || !user) return;
    const col = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MARKERS);
    const merged = new Map<string, RevealedMarker>();
    const emit = () => setMarkers([...merged.values()]);
    const handle = (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      snap.docChanges().forEach((c) => {
        if (c.type === 'removed') merged.delete(c.doc.id);
        else merged.set(c.doc.id, { ...c.doc.data() } as RevealedMarker);
      });
      emit();
    };
    const unsubGlobal = col
      .where('audiencePlayerIds', '==', null)
      .onSnapshot(handle, (err) => console.error('[PlayerGame] global markers error', err));
    const unsubMine = col
      .where('audiencePlayerIds', 'array-contains', user.uid)
      .onSnapshot(handle, (err) => console.error('[PlayerGame] my markers error', err));
    return () => { unsubGlobal(); unsubMine(); };
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

  // Whether we should be sharing location: in the lobby *and* during play (#16), unless
  // out. A single stable boolean so the lifecycle effect below doesn't churn on unrelated
  // re-renders. Lobby fixes don't trigger checkpoints — the geofence fires only in `play`.
  const shouldTrack = !!gameId && (phase === 'lobby' || phase === 'play') && !out;

  // Latest tracking params, held in refs so the start/stop lifecycle effect can read them
  // without listing displayName/batterySaver as deps (#35) — a late-arriving displayName or
  // a battery-saver toggle re-asserts params (effect below) instead of tearing down and
  // restarting the background service, which left a window with no active tracker.
  const trackName = displayName || user?.email || 'Player';
  const trackParamsRef = useRef({ trackName, batterySaver });
  trackParamsRef.current = { trackName, batterySaver };
  const shouldTrackRef = useRef(shouldTrack);
  shouldTrackRef.current = shouldTrack;

  // Start/stop lifecycle — keyed only on gameId + shouldTrack (both stable), so it runs
  // exactly when tracking should begin or end, not on every param change.
  useEffect(() => {
    if (!shouldTrack || !gameId) {
      setTracking(false);
      stopLocationTracking().catch(() => {});
      return;
    }
    let active = true;
    startLocationTracking(gameId, trackParamsRef.current.trackName, {
      batterySaver: trackParamsRef.current.batterySaver,
    })
      .then(() => { if (active) setTracking(true); })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.startsWith('PERMISSION_DENIED:')) {
          setPermissionDenied(true);
          setError(msg.replace('PERMISSION_DENIED:', ''));
        } else {
          setError(msg || 'Could not start location tracking.');
        }
      });
    return () => { active = false; stopLocationTracking().catch(console.error); };
  }, [gameId, shouldTrack]);

  // Propagate param changes (displayName arriving, battery-saver toggle) to a running
  // tracker WITHOUT a stop/start — startLocationTracking refreshes the stored name/cadence
  // and is a no-op restart if the background service is already running. Skips the initial
  // render so it doesn't double-start alongside the lifecycle effect on mount.
  const paramsPrimed = useRef(false);
  useEffect(() => {
    if (!paramsPrimed.current) { paramsPrimed.current = true; return; }
    if (!shouldTrack || !gameId) return;
    startLocationTracking(gameId, trackName, { batterySaver })
      .then(() => setTracking(true))
      .catch(() => {});
    // shouldTrack/gameId read live; we only want to react to param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackName, batterySaver]);

  // Re-assert tracking every time the app returns to the foreground. Two reasons:
  // (1) if the player granted "Always" in Settings since we started, this upgrades
  // them from the foreground-only watcher to the always-on background service; and
  // (2) it restarts a background service the OS may have killed — so a player who
  // locks their phone keeps reporting and never silently drops off the GM's map.
  useEffect(() => {
    if (!gameId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !shouldTrackRef.current) return;
      startLocationTracking(gameId, trackParamsRef.current.trackName, {
        batterySaver: trackParamsRef.current.batterySaver,
      })
        .then(() => setTracking(true))
        .catch(() => {});
    });
    return () => sub.remove();
  }, [gameId]);

  // Foreground alerts surface via <AlertOverlay> (driven by the broadcasts feed),
  // which pops over the app instead of the easily-missed list. FCM heads-up
  // notifications cover the backgrounded/locked case.

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
          onPress: () => {
            if (!gameId || !user) return;
            // Fire-and-persist (#4): Firestore offline persistence durably queues the
            // write and delivers it on reconnect, so confirm immediately rather than
            // blocking on the network — a safety alert must feel instant in a dead zone.
            raiseSos(gameId, user.uid).catch((err) => console.error('[SOS] raiseSos failed', err));
            Alert.alert(
              'Alert sent',
              "The Game Master has been notified and can see your location. If you're offline, it sends the moment you reconnect."
            );
          },
        },
      ]
    );
  }

  // --- Render per phase ---

  function renderWaiting() {
    return (
      <ScrollView
        style={styles.waitScroll}
        contentContainerStyle={styles.waitContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.waitIcon}>
          <Ionicons name="hourglass-outline" size={48} color={Colors.primary} />
        </View>
        <Text style={styles.waitTitle}>You're in, {displayName || 'Player'}!</Text>
        <Text style={styles.waitSub}>
          Waiting for your Game Master to start the game. Keep this screen open.
        </Text>
        {phase === 'lobby' && (
          <View style={styles.locReadyRow}>
            <View style={[styles.statusDot, tracking ? styles.activeDot : styles.inactiveDot]} />
            <Text style={styles.locReadyText}>
              {tracking ? "Location ready — you're on your GM's map" : 'Getting your location ready…'}
            </Text>
          </View>
        )}
        <TouchableOpacity style={styles.howToBtn} onPress={() => setShowTutorial(true)}>
          <Ionicons name="help-circle-outline" size={18} color={Colors.primary} />
          <Text style={styles.howToText}>How to play</Text>
        </TouchableOpacity>
        {/* Ask for every permission now, in the lobby, instead of mid-game. */}
        {phase === 'lobby' && <LobbyPermissions rationsEnabled={config.rationsEnabled} />}
        {gameId ? (
          <View style={styles.waitFeed}>
            <BroadcastFeed max={10} scroll={false} />
          </View>
        ) : null}
      </ScrollView>
    );
  }

  function renderPlay() {
    // Tracking is "active" but only via the foreground watcher → the player drops
    // off the GM's map when their screen locks. Worth a loud, fixable warning.
    const fgOnly = tracking && diag.path === 'foreground-watch';
    return (
      <>
        {/* Tab bar: a full-screen Map view vs. a Stats view (#20). */}
        <View style={styles.tabBar}>
          <TouchableOpacity style={[styles.tab, playTab === 'map' && styles.activeTab]} onPress={() => setPlayTab('map')}>
            <Ionicons name="map" size={18} color={playTab === 'map' ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.tabText, playTab === 'map' && styles.activeTabText]}>Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, playTab === 'stats' && styles.activeTab]} onPress={() => setPlayTab('stats')}>
            <Ionicons name="stats-chart" size={18} color={playTab === 'stats' ? Colors.primary : Colors.textSecondary} />
            <Text style={[styles.tabText, playTab === 'stats' && styles.activeTabText]}>Stats</Text>
          </TouchableOpacity>
        </View>

        {/* Foreground-only warning + tracking error stay pinned above both tabs —
            they're safety-relevant and shouldn't hide behind the Stats tab. */}
        {!out && fgOnly && (
          <View style={styles.warnBanner}>
            <Ionicons name="warning" size={20} color={Colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>You'll vanish from the map when your screen locks</Text>
              <Text style={styles.warnSub}>
                Location is only shared while this app is open. Set location to “Allow all the
                time” so your Game Master can always see you.
              </Text>
            </View>
            <TouchableOpacity onPress={() => Linking.openSettings()} style={styles.warnBtn}>
              <Text style={styles.warnBtnText}>Fix</Text>
            </TouchableOpacity>
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

        <View style={styles.playContent}>
          {playTab === 'map' ? (
            <View style={styles.mapFull}>
              {boundary ? (
                // Players see the play area, their own blue dot, and any checkpoint
                // markers revealed to them (#48) — never other players or hidden sites.
                <GameMap checkpoints={[]} playerLocations={[]} markers={markers} boundary={boundary} showsUserLocation />
              ) : (
                <View style={[styles.map, styles.mapPlaceholder]}>
                  <Ionicons name="map-outline" size={40} color={Colors.textMuted} />
                  <Text style={styles.locatingText}>Your Game Master hasn't set a play area.</Text>
                </View>
              )}
              {/* Always-visible clock pill so the player keeps the timer on the map. */}
              <View style={styles.mapTimePill}>
                <Ionicons name="time-outline" size={15} color={remaining === 0 ? Colors.danger : Colors.text} />
                <Text style={[styles.mapTimeText, remaining === 0 && styles.timerValueDanger]}>
                  {remaining != null ? formatDuration(remaining) : '—'}
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView
              style={styles.statsBody}
              contentContainerStyle={styles.statsContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
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

              {!out && (
                <>
                  <TouchableOpacity style={styles.statusCard} activeOpacity={0.7} onPress={() => setShowDiag((v) => !v)}>
                    <View style={[styles.statusDot, !tracking ? styles.inactiveDot : fgOnly ? styles.warnDot : styles.activeDot]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.statusTitle}>
                        {!tracking ? 'Starting tracking…' : fgOnly ? 'Sharing only while app is open' : 'Location Sharing Active'}
                      </Text>
                      <Text style={styles.statusSub}>
                        {!tracking
                          ? 'Requesting location permission…'
                          : fgOnly
                            ? 'Your Game Master loses you when your screen locks. Tap Fix above.'
                            : 'Your Game Master can see you — even when your screen is locked.'}
                      </Text>
                    </View>
                    <Ionicons name={showDiag ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                  {showDiag && (
                    <View style={styles.diagCard}>
                      <Text style={styles.diagRow}>Foreground permission: <Text style={styles.diagVal}>{diag.foreground}</Text></Text>
                      <Text style={styles.diagRow}>Background permission: <Text style={styles.diagVal}>{diag.background}</Text></Text>
                      <Text style={styles.diagRow}>Source: <Text style={styles.diagVal}>{diag.path}</Text></Text>
                      <Text style={styles.diagRow}>
                        Last upload: <Text style={styles.diagVal}>
                          {diag.lastUploadAt ? `${Math.round((Date.now() - diag.lastUploadAt) / 1000)}s ago` : 'never'}
                        </Text>
                      </Text>
                      <Text style={styles.diagRow}>Last error: <Text style={styles.diagVal}>{diag.lastError ?? 'none'}</Text></Text>
                    </View>
                  )}
                </>
              )}

              <Text style={styles.feedHeading}>Messages</Text>
              <BroadcastFeed scroll={false} />
            </ScrollView>
          )}
        </View>

        {/* Pinned action bar — reachable from either tab, sitting below the (now
            scrollable) content so it never overlaps it. Hidden only while the keyboard
            is up so it can't float over the ration-card input; it returns the moment
            the keyboard closes (e.g. as soon as the camera launch dismisses it). */}
        {out ? (
          <View style={[styles.statusCard, styles.outCard]}>
            <View style={[styles.statusDot, styles.inactiveDot]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>You're out</Text>
              <Text style={styles.statusSub}>
                Wave your red bandana overhead as you exit the arena (Rule 2).
              </Text>
            </View>
          </View>
        ) : !keyboardUp ? (
          <View style={styles.outBtnWrap}>
            <Button title="I've been killed" onPress={handleMarkOut} variant="danger" />
            <TouchableOpacity style={styles.sosBtn} onPress={handleSos}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.danger} />
              <Text style={styles.sosText}>Safety alert — I need help</Text>
            </TouchableOpacity>
          </View>
        ) : null}
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
    <BroadcastsProvider gameId={gameId ?? ''}>
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

        {gameId && phase !== 'results' && <AlertOverlay />}
        <Tutorial visible={showTutorial} onDone={dismissTutorial} rules={rules} />
      </SafeAreaView>
    </BroadcastsProvider>
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
  waitScroll: { flex: 1 },
  waitContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 24, gap: 12 },
  waitIcon: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 8,
  },
  waitTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  waitSub: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  waitFeed: { alignSelf: 'stretch', marginTop: 16 },
  locReadyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  locReadyText: { color: Colors.textSecondary, fontSize: 13 },
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

  // Map / Stats tabs (#20)
  tabBar: {
    flexDirection: 'row', marginHorizontal: 16, marginTop: 4, marginBottom: 8,
    backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  activeTab: { backgroundColor: Colors.surfaceElevated },
  tabText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  activeTabText: { color: Colors.primary },
  playContent: { flex: 1 },
  statsBody: { flex: 1 },
  statsContent: { paddingBottom: 12 },
  feedHeading: { fontSize: 11, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 1.5, marginHorizontal: 16, marginBottom: 6 },

  mapFull: { flex: 1, marginHorizontal: 16, marginBottom: 8, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  mapTimePill: {
    position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface + 'E6', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  mapTimeText: { fontSize: 16, fontWeight: '800', color: Colors.text, fontVariant: ['tabular-nums'] },
  map: { flex: 1 },
  mapPlaceholder: { backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', gap: 8 },
  locatingText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center', paddingHorizontal: 16 },

  statusCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  outCard: { borderColor: Colors.danger, marginTop: 4 },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  activeDot: { backgroundColor: Colors.success },
  inactiveDot: { backgroundColor: Colors.textMuted },
  warnDot: { backgroundColor: Colors.warning },
  warnBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.warning + '22', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.warning,
  },
  warnTitle: { fontSize: 14, fontWeight: '800', color: Colors.text },
  warnSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 3, lineHeight: 17 },
  warnBtn: {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 8,
    backgroundColor: Colors.warning,
  },
  warnBtnText: { color: Colors.black, fontSize: 14, fontWeight: '800' },
  statusTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  statusSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  diagCard: {
    marginHorizontal: 16, marginTop: -4, marginBottom: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, gap: 4,
  },
  diagRow: { fontSize: 12, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  diagVal: { color: Colors.text, fontWeight: '600' },
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
  outBtnWrap: {
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 10,
    backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  sosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.danger,
    backgroundColor: Colors.background,
  },
  sosText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
});
