import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, FlatList, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Circle, Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import firestore from '@react-native-firebase/firestore';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_TILE_SIZE, TOPO_MAX_ZOOM, TOPO_MAX_NATIVE_ZOOM } from '@/constants/map';
import {
  updateGameConfig, addCheckpoint, updateCheckpoint, deleteCheckpoint,
  openCheckpointNow, closeCheckpointNow, clearCheckpointWindow, checkpointWindowState,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import type { MapBoundary, Checkpoint, CheckpointEvent, CheckpointKind, EventAudience } from '@/types';

// Fractions of the screen the framing reticle insets from each edge. The saved
// boundary is the area *inside* the reticle, so it matches what the GM frames.
const RETICLE = { vertical: 0.15, horizontal: 0.08 };
const DEFAULT_RADIUS = 100;
// Center-of-US fallback view, used only if we can't get the GM's location.
const DEFAULT_REGION: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const USER_DELTA = 0.02;

// Per-kind presentation: chip label/icon, map pin color, and a message placeholder.
const KIND_META: Record<
  CheckpointKind,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; placeholder: string }
> = {
  hazard: {
    label: 'Hazard', icon: 'warning', color: Colors.danger,
    placeholder: 'e.g. A beast attacks! Defend or flee.',
  },
  boon: {
    label: 'Boon', icon: 'sparkles', color: Colors.success,
    placeholder: 'e.g. You found a hidden cache. Claim it.',
  },
  'player-notify': {
    label: 'Notify', icon: 'megaphone', color: Colors.playerDot,
    placeholder: 'e.g. The storm is closing in — head for high ground.',
  },
  'gm-only': {
    label: 'GM only', icon: 'eye-off', color: Colors.textSecondary,
    placeholder: '',
  },
};
const KIND_ORDER: CheckpointKind[] = ['hazard', 'boon', 'player-notify', 'gm-only'];

/** The kind that determines a checkpoint's map-pin color (single event, or first queued). */
function checkpointKind(cp: Checkpoint): CheckpointKind {
  return cp.event?.kind ?? cp.eventQueue?.[0]?.kind ?? 'gm-only';
}

/** #RRGGBB → rgba(...) with the given alpha, for translucent geofence circles. */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Build a clean event with no undefined fields (Firestore rejects undefined). */
function buildEvent(kind: CheckpointKind, message: string, audience: EventAudience): CheckpointEvent {
  const e: CheckpointEvent = { kind };
  if (kind !== 'gm-only' && message.trim()) e.message = message.trim();
  if (kind === 'player-notify' && audience === 'all-players') e.audience = 'all-players';
  return e;
}

/** "1st arriver", "2nd arriver", … for the arrival-order queue rows. */
function ordinalLabel(i: number): string {
  const n = i + 1;
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix} arriver`;
}

function regionToBoundary(r: Region): MapBoundary {
  const latSpan = r.latitudeDelta * (1 - RETICLE.vertical * 2);
  const lngSpan = r.longitudeDelta * (1 - RETICLE.horizontal * 2);
  return {
    minLat: r.latitude - latSpan / 2,
    maxLat: r.latitude + latSpan / 2,
    minLng: r.longitude - lngSpan / 2,
    maxLng: r.longitude + lngSpan / 2,
  };
}

function corners(b: MapBoundary) {
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

/** Row of selectable kind chips (Hazard / Boon / Notify / GM only). */
function KindChips({ value, onChange }: { value: CheckpointKind; onChange: (k: CheckpointKind) => void }) {
  return (
    <View style={styles.chips}>
      {KIND_ORDER.map((k) => {
        const meta = KIND_META[k];
        const active = k === value;
        return (
          <TouchableOpacity
            key={k}
            onPress={() => onChange(k)}
            style={[styles.chip, active && { borderColor: meta.color, backgroundColor: hexToRgba(meta.color, 0.15) }]}
          >
            <Ionicons name={meta.icon} size={14} color={active ? meta.color : Colors.textSecondary} />
            <Text style={[styles.chipText, active && { color: meta.color }]}>{meta.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Crossing-player vs all-players toggle (player-notify only). */
function AudienceToggle({ value, onChange }: { value: EventAudience; onChange: (a: EventAudience) => void }) {
  const opts: { v: EventAudience; label: string }[] = [
    { v: 'crossing-player', label: 'Crossing player' },
    { v: 'all-players', label: 'All players' },
  ];
  return (
    <View style={styles.segment}>
      {opts.map((o) => (
        <TouchableOpacity
          key={o.v}
          onPress={() => onChange(o.v)}
          style={[styles.segBtn, value === o.v && styles.segBtnActive]}
        >
          <Text style={[styles.segText, value === o.v && styles.segTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function PlayAreaScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, checkpoints, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);
  const boundary: MapBoundary | undefined = game?.boundary;
  const mapRef = useRef<MapView>(null);
  // The map opens framed on `displayRegion` (the GM's location for a new game, or
  // the saved boundary when editing). animateToRegion/animateCamera are no-ops on
  // this mapType="none" + Google setup, so we can't move the camera after render —
  // instead, to recenter we *remount* the MapView by bumping `renderKey`. That's
  // what lets a GPS fix that arrives late (e.g. after the permission prompt) still
  // recenter the map, and what makes the manual "locate" button work.
  const [displayRegion, setDisplayRegion] = useState<Region | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const gotInitialFix = useRef(false); // a real source (boundary or GPS) resolved
  const mapMountedRef = useRef(false);  // map has been shown at least once
  const regionRef = useRef<Region | null>(DEFAULT_REGION);

  // Show a region on the map. The first call mounts the map; later calls remount
  // it (key bump) to recenter, since the camera can't be moved imperatively here.
  const showRegion = useCallback((region: Region) => {
    regionRef.current = region;
    if (mapMountedRef.current) setRenderKey((k) => k + 1);
    mapMountedRef.current = true;
    setDisplayRegion(region);
  }, []);

  const regionFromCoords = (c: { latitude: number; longitude: number }): Region => ({
    latitude: c.latitude,
    longitude: c.longitude,
    latitudeDelta: USER_DELTA,
    longitudeDelta: USER_DELTA,
  });
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [locating, setLocating] = useState(false);
  const [savingBoundary, setSavingBoundary] = useState(false);

  // Checkpoint add/edit modal state
  const [showCpModal, setShowCpModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpRadius, setCpRadius] = useState(String(DEFAULT_RADIUS));
  const [savingCp, setSavingCp] = useState(false);
  // What the checkpoint does. Single mode edits cpKind/cpMessage/cpAudience; queue mode
  // edits cpQueue (one event per arrival ordinal).
  const [cpMode, setCpMode] = useState<'single' | 'queue'>('single');
  const [cpKind, setCpKind] = useState<CheckpointKind>('gm-only');
  const [cpMessage, setCpMessage] = useState('');
  const [cpAudience, setCpAudience] = useState<EventAudience>('crossing-player');
  const [cpQueue, setCpQueue] = useState<CheckpointEvent[]>([]);

  // Keep the shared game subscription alive (no clearGame on unmount — the GM
  // screen underneath relies on the same singleton context).
  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  // Request permission, find the GM, and recenter the map on them. Used both for
  // the one-time auto-center and the manual "locate me" button. Tries the cached
  // last-known position first (instant) before waiting on a fresh GPS fix.
  const centerOnUser = useCallback(async (showPromptOnDenied = false) => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (showPromptOnDenied) {
          Alert.alert(
            'Location off',
            'Enable location access for Outdoor GM in Settings to center the map on you.',
          );
        }
        return;
      }
      const pos =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!pos) return;
      // Remount the map centered on the user (camera can't be moved imperatively).
      showRegion(regionFromCoords(pos.coords));
    } catch {
      // Location unavailable — leave the current view in place.
    } finally {
      setLocating(false);
    }
  }, [showRegion]);

  // Frame on an existing boundary as soon as it's known (editing an existing game).
  useEffect(() => {
    if (!boundary || gotInitialFix.current) return;
    gotInitialFix.current = true;
    showRegion({
      latitude: (boundary.minLat + boundary.maxLat) / 2,
      longitude: (boundary.minLng + boundary.maxLng) / 2,
      latitudeDelta: Math.max(0.01, boundary.maxLat - boundary.minLat),
      longitudeDelta: Math.max(0.01, boundary.maxLng - boundary.minLng),
    });
  }, [boundary, showRegion]);

  // Otherwise frame on the GM's current location. getLastKnownPositionAsync is
  // instant when a fix is cached (the same fix that draws the blue dot); otherwise
  // watch for the first live fix. A generous fallback shows the default view so the
  // map never spins forever — and because we can remount to recenter, a fix that
  // arrives *after* the fallback (e.g. once the permission prompt is answered)
  // still recenters the map rather than being stuck on the default.
  useEffect(() => {
    if (boundary) return; // boundary path handles framing
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    const applyFix = (coords: { latitude: number; longitude: number }) => {
      if (cancelled || gotInitialFix.current) return;
      gotInitialFix.current = true;
      showRegion(regionFromCoords(coords));
      sub?.remove();
      sub = null;
    };
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          if (!gotInitialFix.current) showRegion(DEFAULT_REGION);
          return;
        }
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last) { applyFix(last.coords); return; }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
          (pos) => applyFix(pos.coords)
        );
      } catch {
        if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION);
      }
    })();
    // Show *something* if no fix after a while; a later fix still recenters.
    const fallback = setTimeout(() => {
      if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION);
    }, 9000);
    return () => { cancelled = true; clearTimeout(fallback); sub?.remove(); };
  }, [boundary, showRegion]);

  async function handleSaveBoundary() {
    if (!gameId || !regionRef.current) return;
    setSavingBoundary(true);
    try {
      await updateGameConfig(gameId, { boundary: regionToBoundary(regionRef.current) });
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSavingBoundary(false);
    }
  }

  function resetEventFields() {
    setCpMode('single');
    setCpKind('gm-only');
    setCpMessage('');
    setCpAudience('crossing-player');
    setCpQueue([]);
  }

  function openAddCheckpoint(coord: { latitude: number; longitude: number }) {
    setPendingCoord(coord);
    setEditTarget(null);
    setCpName(`Checkpoint ${checkpoints.length + 1}`);
    setCpRadius(String(DEFAULT_RADIUS));
    resetEventFields();
    setShowCpModal(true);
  }

  function openEditCheckpoint(cp: Checkpoint) {
    setEditTarget(cp);
    setPendingCoord({ latitude: cp.latitude, longitude: cp.longitude });
    setCpName(cp.name);
    setCpRadius(String(cp.radius));
    if (cp.eventQueue && cp.eventQueue.length > 0) {
      setCpMode('queue');
      setCpQueue(cp.eventQueue);
      setCpKind('gm-only');
      setCpMessage('');
      setCpAudience('crossing-player');
    } else {
      setCpMode('single');
      const e = cp.event;
      setCpKind(e?.kind ?? 'gm-only');
      setCpMessage(e?.message ?? '');
      setCpAudience(e?.audience ?? 'crossing-player');
      setCpQueue([]);
    }
    setShowCpModal(true);
  }

  // Arrival-order queue editing
  function updateQueueItem(index: number, patch: Partial<CheckpointEvent>) {
    setCpQueue((q) => q.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }
  function addQueueItem() {
    setCpQueue((q) => [...q, { kind: 'hazard' }]);
  }
  function removeQueueItem(index: number) {
    setCpQueue((q) => q.filter((_, i) => i !== index));
  }

  async function handleSaveCheckpoint() {
    if (!cpName.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const radius = parseInt(cpRadius, 10);
    if (isNaN(radius) || radius < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }
    if (!pendingCoord || !gameId) return;

    // Resolve what the checkpoint does into either a single `event` or an `eventQueue`.
    let event: CheckpointEvent | undefined;
    let eventQueue: CheckpointEvent[] | undefined;
    if (cpMode === 'queue') {
      const cleaned = cpQueue.map((e) =>
        buildEvent(e.kind, e.message ?? '', e.audience ?? 'crossing-player')
      );
      if (cleaned.length === 0) {
        Alert.alert('Add at least one step, or switch to “Same for everyone”.');
        return;
      }
      eventQueue = cleaned;
    } else {
      event = buildEvent(cpKind, cpMessage, cpAudience);
    }

    setSavingCp(true);
    try {
      if (editTarget) {
        // Clear whichever payload field isn't in use so a checkpoint never carries both.
        await updateCheckpoint(gameId, editTarget.id, {
          name: cpName.trim(),
          radius,
          event: (eventQueue ? firestore.FieldValue.delete() : event) as never,
          eventQueue: (eventQueue ?? firestore.FieldValue.delete()) as never,
        });
      } else {
        await addCheckpoint(gameId, {
          name: cpName.trim(),
          latitude: pendingCoord.latitude,
          longitude: pendingCoord.longitude,
          radius,
          ...(eventQueue ? { eventQueue } : { event }),
        });
      }
      setShowCpModal(false);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSavingCp(false);
    }
  }

  // Timed site window (#12): the buttons write immediately by id (an existing
  // checkpoint), so they don't go through the staged Save like the rest of the form.
  async function handleWindowAction(action: 'open' | 'close' | 'clear') {
    if (!gameId || !editTarget) return;
    try {
      if (action === 'open') await openCheckpointNow(gameId, editTarget.id);
      else if (action === 'close') await closeCheckpointNow(gameId, editTarget.id);
      else await clearCheckpointWindow(gameId, editTarget.id);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  function confirmDeleteCheckpoint(cp: Checkpoint) {
    if (!gameId) return;
    Alert.alert(`Delete "${cp.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCheckpoint(gameId, cp.id);
            setShowCpModal(false);
          } catch (err) {
            Alert.alert('Error', friendlyError(err));
          }
        },
      },
    ]);
  }

  // Live window state of the checkpoint being edited (re-derived from context so it
  // updates after an open/close write), plus the status copy shown in the modal.
  const editCp = editTarget ? checkpoints.find((c) => c.id === editTarget.id) ?? editTarget : null;
  const windowState = editCp ? checkpointWindowState(editCp, now) : 'always';
  const windowStatusText = {
    always: 'Always live — fires whenever a player crosses.',
    open: 'Open — firing now.',
    pending: 'Scheduled — not open yet.',
    closed: 'Closed — not firing.',
  }[windowState];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Play Area</Text>
        <View style={styles.headerRight}>
          <View style={styles.cpCount}>
            <Ionicons name="location" size={14} color={Colors.primary} />
            <Text style={styles.cpCountText}>{checkpoints.length}</Text>
          </View>
          <View style={styles.modeToggle}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'map' && styles.activeModeBtn]}
              onPress={() => setMode('map')}
            >
              <Ionicons name="map" size={18} color={mode === 'map' ? Colors.primary : Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'list' && styles.activeModeBtn]}
              onPress={() => setMode('list')}
            >
              <Ionicons name="list" size={18} color={mode === 'list' ? Colors.primary : Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {mode === 'list' ? (
        <>
          <FlatList
            data={checkpoints}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              checkpoints.length > 0 ? (
                <Text style={styles.listHeading}>
                  {checkpoints.length} checkpoint{checkpoints.length === 1 ? '' : 's'}
                </Text>
              ) : null
            }
            renderItem={({ item }) => {
              const kind = checkpointKind(item);
              const meta = KIND_META[kind];
              const steps = item.eventQueue?.length ?? 0;
              const w = checkpointWindowState(item, now);
              const wLabel = w === 'open' ? 'OPEN' : w === 'closed' ? 'CLOSED' : w === 'pending' ? 'SCHEDULED' : '';
              const wColor = w === 'open' ? Colors.success : w === 'closed' ? Colors.danger : Colors.textSecondary;
              return (
              <View style={styles.checkpointRow}>
                <Ionicons name={meta.icon} size={20} color={meta.color} style={{ marginRight: 10 }} />
                <View style={styles.cpInfo}>
                  <View style={styles.cpNameRow}>
                    <Text style={styles.cpName}>{item.name}</Text>
                    {wLabel ? (
                      <View style={[styles.windowBadge, { borderColor: wColor }]}>
                        <Text style={[styles.windowBadgeText, { color: wColor }]}>{wLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.cpSub}>
                    {meta.label}{steps > 1 ? ` · ${steps} steps` : ''} · {item.radius}m radius
                  </Text>
                </View>
                <TouchableOpacity onPress={() => openEditCheckpoint(item)} style={styles.iconBtn}>
                  <Ionicons name="pencil-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDeleteCheckpoint(item)} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>
                  No checkpoints yet.{'\n'}Switch to the map and long-press to add one.
                </Text>
              </View>
            }
          />
          <View style={styles.footer}>
            <Button title="Add Checkpoints on Map" onPress={() => setMode('map')} variant="ghost" />
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </>
      ) : (
        <>
        <View style={styles.mapWrapper}>
        {!displayRegion ? (
          <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.mapLoadingText}>Finding your location…</Text>
          </View>
        ) : (
        <MapView
          key={String(renderKey)}
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType="none"
          initialRegion={displayRegion}
          showsUserLocation
          showsMyLocationButton={false}
          // Backup centering source: the native map's own user-location stream
          // (what draws the blue dot). If expo-location is slow to deliver a fix
          // and we've rendered the default view, this recenters us once — using
          // the exact source that's clearly already working on the device.
          onUserLocationChange={(e) => {
            if (boundary || gotInitialFix.current) return;
            const c = e.nativeEvent?.coordinate;
            if (!c) return;
            gotInitialFix.current = true;
            showRegion(regionFromCoords(c));
          }}
          onRegionChangeComplete={(r) => { regionRef.current = r; }}
          onLongPress={(e) => openAddCheckpoint(e.nativeEvent.coordinate)}
        >
          <UrlTile
            urlTemplate={TOPO_TILE_URL}
            tileSize={TOPO_TILE_SIZE}
            maximumZ={TOPO_MAX_ZOOM}
            maximumNativeZ={TOPO_MAX_NATIVE_ZOOM}
            zIndex={-1}
          />

          {boundary && (
            <Polygon
              coordinates={corners(boundary)}
              strokeColor={Colors.secondary}
              strokeWidth={2}
              fillColor="rgba(212, 137, 63, 0.08)"
            />
          )}

          {checkpoints.map((cp) => {
            const color = KIND_META[checkpointKind(cp)].color;
            return (
              <Circle
                key={`c-${cp.id}`}
                center={{ latitude: cp.latitude, longitude: cp.longitude }}
                radius={cp.radius}
                fillColor={hexToRgba(color, 0.15)}
                strokeColor={color}
                strokeWidth={2}
              />
            );
          })}
          {checkpoints.map((cp) => (
            <Marker
              key={`m-${cp.id}`}
              coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
              title={cp.name}
              description={`${KIND_META[checkpointKind(cp)].label} · ${cp.radius}m — tap to edit`}
              pinColor={KIND_META[checkpointKind(cp)].color}
              onPress={() => openEditCheckpoint(cp)}
            />
          ))}
        </MapView>
        )}

        {/* Reticle showing the area that will be captured as the boundary */}
        <View pointerEvents="none" style={styles.reticle} />

        {/* Recenter the map on the GM's current location */}
        <TouchableOpacity
          style={styles.locateBtn}
          onPress={() => centerOnUser(true)}
          disabled={locating}
        >
          <Ionicons
            name={locating ? 'ellipsis-horizontal' : 'locate'}
            size={22}
            color={Colors.text}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.hint}>
          Frame the play area in the box and tap below to set the boundary.
          Long-press anywhere on the map to drop a checkpoint.
        </Text>
        <Button
          title={boundary ? 'Update Boundary to This View' : 'Set Boundary to This View'}
          onPress={handleSaveBoundary}
          loading={savingBoundary}
        />
        <Button title="Done" onPress={() => router.back()} variant="ghost" />
      </View>
        </>
      )}

      {/* Add / edit checkpoint modal */}
      <Modal visible={showCpModal} transparent animationType="slide" onRequestClose={() => setShowCpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            <Text style={styles.modalTitle}>{editTarget ? 'Edit Checkpoint' : 'New Checkpoint'}</Text>
            {pendingCoord && (
              <Text style={styles.coords}>
                📍 {pendingCoord.latitude.toFixed(5)}, {pendingCoord.longitude.toFixed(5)}
              </Text>
            )}
            <Input
              label="Name"
              value={cpName}
              onChangeText={setCpName}
              placeholder="e.g. Cornucopia"
            />
            <Input
              label="Detection Radius (meters)"
              value={cpRadius}
              onChangeText={setCpRadius}
              keyboardType="number-pad"
              placeholder="100"
            />

            {/* What the checkpoint does when a player crosses it */}
            <Text style={styles.sectionLabel}>What happens here?</Text>
            <View style={styles.segment}>
              <TouchableOpacity
                onPress={() => setCpMode('single')}
                style={[styles.segBtn, cpMode === 'single' && styles.segBtnActive]}
              >
                <Text style={[styles.segText, cpMode === 'single' && styles.segTextActive]}>Same for everyone</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setCpMode('queue')}
                style={[styles.segBtn, cpMode === 'queue' && styles.segBtnActive]}
              >
                <Text style={[styles.segText, cpMode === 'queue' && styles.segTextActive]}>By arrival order</Text>
              </TouchableOpacity>
            </View>

            {cpMode === 'single' ? (
              <>
                <KindChips value={cpKind} onChange={setCpKind} />
                {cpKind !== 'gm-only' && (
                  <Input
                    label="Message"
                    value={cpMessage}
                    onChangeText={setCpMessage}
                    placeholder={KIND_META[cpKind].placeholder}
                    multiline
                    style={styles.messageInput}
                  />
                )}
                {cpKind === 'player-notify' && <AudienceToggle value={cpAudience} onChange={setCpAudience} />}
                {cpKind === 'gm-only' && (
                  <Text style={styles.hintSmall}>Only you (the GM) are alerted. The player sees nothing.</Text>
                )}
              </>
            ) : (
              <>
                <Text style={styles.hintSmall}>
                  Each arriver, in order, triggers the next step. Once the steps run out, later arrivers just ping you.
                </Text>
                {cpQueue.map((e, i) => (
                  <View key={i} style={styles.queueRow}>
                    <View style={styles.queueRowHead}>
                      <Text style={styles.queueLabel}>{ordinalLabel(i)}</Text>
                      <TouchableOpacity onPress={() => removeQueueItem(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <KindChips value={e.kind} onChange={(k) => updateQueueItem(i, { kind: k })} />
                    {e.kind !== 'gm-only' && (
                      <Input
                        value={e.message ?? ''}
                        onChangeText={(t) => updateQueueItem(i, { message: t })}
                        placeholder={KIND_META[e.kind].placeholder}
                        multiline
                        style={styles.messageInput}
                      />
                    )}
                    {e.kind === 'player-notify' && (
                      <AudienceToggle
                        value={e.audience ?? 'crossing-player'}
                        onChange={(a) => updateQueueItem(i, { audience: a })}
                      />
                    )}
                  </View>
                ))}
                <TouchableOpacity onPress={addQueueItem} style={styles.addStep}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                  <Text style={styles.addStepText}>Add step</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Timed site window (#12) — only for an existing checkpoint, since the
                buttons write immediately. New sites are always-live until opened. */}
            {editTarget && (
              <>
                <Text style={styles.sectionLabel}>Timed site window</Text>
                <Text style={styles.hintSmall}>{windowStatusText}</Text>
                <View style={styles.chips}>
                  <TouchableOpacity
                    onPress={() => handleWindowAction('open')}
                    style={[styles.chip, windowState === 'open' && { borderColor: Colors.success, backgroundColor: hexToRgba(Colors.success, 0.15) }]}
                  >
                    <Ionicons name="lock-open-outline" size={14} color={windowState === 'open' ? Colors.success : Colors.textSecondary} />
                    <Text style={[styles.chipText, windowState === 'open' && { color: Colors.success }]}>Open now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleWindowAction('close')}
                    style={[styles.chip, windowState === 'closed' && { borderColor: Colors.danger, backgroundColor: hexToRgba(Colors.danger, 0.15) }]}
                  >
                    <Ionicons name="lock-closed-outline" size={14} color={windowState === 'closed' ? Colors.danger : Colors.textSecondary} />
                    <Text style={[styles.chipText, windowState === 'closed' && { color: Colors.danger }]}>Close now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleWindowAction('clear')}
                    style={[styles.chip, windowState === 'always' && { borderColor: Colors.primary, backgroundColor: hexToRgba(Colors.primary, 0.15) }]}
                  >
                    <Ionicons name="infinite-outline" size={14} color={windowState === 'always' ? Colors.primary : Colors.textSecondary} />
                    <Text style={[styles.chipText, windowState === 'always' && { color: Colors.primary }]}>Always live</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setShowCpModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
              <Button title={editTarget ? 'Save' : 'Add'} onPress={handleSaveCheckpoint} loading={savingCp} fullWidth={false} style={{ flex: 1 }} />
            </View>
            {editTarget && (
              <TouchableOpacity onPress={() => confirmDeleteCheckpoint(editTarget)} style={styles.deleteRow}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                <Text style={styles.deleteText}>Delete checkpoint</Text>
              </TouchableOpacity>
            )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text, marginLeft: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpCount: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpCountText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  modeToggle: {
    flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  modeBtn: { padding: 8, paddingHorizontal: 12 },
  activeModeBtn: { backgroundColor: Colors.surfaceElevated },
  list: { paddingHorizontal: 16, paddingVertical: 8, flexGrow: 1 },
  listHeading: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  checkpointRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpInfo: { flex: 1 },
  cpNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  windowBadge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  windowBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  mapWrapper: { flex: 1, position: 'relative' },
  mapLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.surface },
  mapLoadingText: { color: Colors.textSecondary, fontSize: 14 },
  reticle: {
    position: 'absolute',
    top: '15%',
    left: '8%',
    right: '8%',
    bottom: '15%',
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 8,
    backgroundColor: 'rgba(212, 137, 63, 0.05)',
  },
  locateBtn: {
    position: 'absolute', right: 16, bottom: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  footer: { padding: 16, gap: 10 },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '88%',
  },
  modalContent: { padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  coords: { fontSize: 12, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },

  // Checkpoint event editor
  sectionLabel: {
    color: Colors.textSecondary, fontSize: 13, fontWeight: '500',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4,
  },
  segment: {
    flexDirection: 'row', backgroundColor: Colors.surfaceElevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.primary },
  segText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: Colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  messageInput: { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' },
  hintSmall: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  queueRow: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 12, padding: 12, gap: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  queueRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  addStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  addStepText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
});
