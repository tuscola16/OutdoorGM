import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Circle, Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_TILE_SIZE, TOPO_MAX_ZOOM, TOPO_MAX_NATIVE_ZOOM } from '@/constants/map';
import { addCheckpoint, updateCheckpoint, deleteCheckpoint } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { KIND_META, checkpointKind, hexToRgba } from '@/components/checkpointForm';
import { CHECKPOINT_ICONS, checkpointIcon, DEFAULT_CHECKPOINT_ICON } from '@/constants/checkpointIcons';
import type { MapBoundary, Checkpoint } from '@/types';

const DEFAULT_RADIUS = 100;
const DEFAULT_REGION: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const USER_DELTA = 0.02;

// Polygon vertices when present (≥ 3), else the min/max rectangle corners.
function corners(b: MapBoundary) {
  if (b.polygon && b.polygon.length >= 3) return b.polygon;
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

/** One-line summary of what a checkpoint does, for the list. */
function behaviorSummary(cp: Checkpoint): string {
  if (cp.transitions && cp.transitions.length > 0) {
    return `Scheduled · ${cp.transitions.length} change${cp.transitions.length === 1 ? '' : 's'}`;
  }
  const steps = cp.eventQueue?.length ?? 0;
  if (steps > 0) return `By arrival · ${steps} step${steps === 1 ? '' : 's'}`;
  return KIND_META[checkpointKind(cp)].label;
}

export default function CheckpointsScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, checkpoints, loadGame } = useGame();
  const router = useRouter();
  const boundary: MapBoundary | undefined = game?.boundary;

  const [displayRegion, setDisplayRegion] = useState<Region | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const gotInitialFix = useRef(false);
  const mapMountedRef = useRef(false);
  const regionRef = useRef<Region | null>(DEFAULT_REGION);
  const mapRef = useRef<MapView>(null);

  const showRegion = useCallback((region: Region) => {
    regionRef.current = region;
    if (mapMountedRef.current) setRenderKey((k) => k + 1);
    mapMountedRef.current = true;
    setDisplayRegion(region);
  }, []);

  const regionFromCoords = (c: { latitude: number; longitude: number }): Region => ({
    latitude: c.latitude, longitude: c.longitude, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA,
  });

  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [locating, setLocating] = useState(false);

  // Quick add/rename modal — placement only (name + icon + radius). Behavior is authored on
  // the full-screen editor (the run sheet), reached via "Configure behavior" (#53).
  const [showCpModal, setShowCpModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpIcon, setCpIcon] = useState<string>(DEFAULT_CHECKPOINT_ICON);
  const [cpRadius, setCpRadius] = useState(String(DEFAULT_RADIUS));
  const [savingCp, setSavingCp] = useState(false);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const centerOnUser = useCallback(async (showPromptOnDenied = false) => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (showPromptOnDenied) {
          Alert.alert('Location off', 'Enable location access for Outdoor GM in Settings to center the map on you.');
        }
        return;
      }
      const pos = (await Location.getLastKnownPositionAsync())
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!pos) return;
      showRegion(regionFromCoords(pos.coords));
    } catch {
      /* location unavailable */
    } finally {
      setLocating(false);
    }
  }, [showRegion]);

  // Frame on the boundary if set, else the GM's location.
  useEffect(() => {
    if (gotInitialFix.current) return;
    if (boundary) {
      gotInitialFix.current = true;
      showRegion({
        latitude: (boundary.minLat + boundary.maxLat) / 2,
        longitude: (boundary.minLng + boundary.maxLng) / 2,
        latitudeDelta: Math.max(0.01, boundary.maxLat - boundary.minLat),
        longitudeDelta: Math.max(0.01, boundary.maxLng - boundary.minLng),
      });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') { if (!gotInitialFix.current) showRegion(DEFAULT_REGION); return; }
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last && !gotInitialFix.current) { gotInitialFix.current = true; showRegion(regionFromCoords(last.coords)); }
      } catch {
        if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION);
      }
    })();
    const fallback = setTimeout(() => { if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION); }, 9000);
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [boundary, showRegion]);

  function openAddCheckpoint(coord: { latitude: number; longitude: number }) {
    setPendingCoord(coord);
    setEditTarget(null);
    setCpName(`Checkpoint ${checkpoints.length + 1}`);
    setCpIcon(DEFAULT_CHECKPOINT_ICON);
    setCpRadius(String(DEFAULT_RADIUS));
    setShowCpModal(true);
  }

  function openRenameCheckpoint(cp: Checkpoint) {
    setEditTarget(cp);
    setPendingCoord({ latitude: cp.latitude, longitude: cp.longitude });
    setCpName(cp.name);
    setCpIcon(cp.icon ?? DEFAULT_CHECKPOINT_ICON);
    setCpRadius(String(cp.radius));
    setShowCpModal(true);
  }

  function goToEditor(checkpointId: string) {
    router.push(`/(app)/gm/${gameId}/checkpoint/${checkpointId}`);
  }

  /** Save name/icon/radius. `andConfigure` jumps to the behavior editor afterward. */
  async function handleSaveCheckpoint(andConfigure = false) {
    if (!cpName.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const radius = parseInt(cpRadius, 10);
    if (isNaN(radius) || radius < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }
    if (!pendingCoord || !gameId) return;

    setSavingCp(true);
    try {
      let checkpointId = editTarget?.id;
      if (editTarget) {
        await updateCheckpoint(gameId, editTarget.id, { name: cpName.trim(), radius, icon: cpIcon });
      } else {
        const created = await addCheckpoint(gameId, {
          name: cpName.trim(),
          latitude: pendingCoord.latitude,
          longitude: pendingCoord.longitude,
          radius,
          icon: cpIcon,
        });
        checkpointId = created.id;
      }
      setShowCpModal(false);
      if (andConfigure && checkpointId) goToEditor(checkpointId);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSavingCp(false);
    }
  }

  function confirmDeleteCheckpoint(cp: Checkpoint) {
    if (!gameId) return;
    Alert.alert(`Delete "${cp.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteCheckpoint(gameId, cp.id); setShowCpModal(false); }
          catch (err) { Alert.alert('Error', friendlyError(err)); }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Checkpoints</Text>
        <View style={styles.headerRight}>
          <View style={styles.cpCount}>
            <Ionicons name="location" size={14} color={Colors.primary} />
            <Text style={styles.cpCountText}>{checkpoints.length}</Text>
          </View>
          <View style={styles.modeToggle}>
            <TouchableOpacity style={[styles.modeBtn, mode === 'map' && styles.activeModeBtn]} onPress={() => setMode('map')}>
              <Ionicons name="map" size={18} color={mode === 'map' ? Colors.primary : Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, mode === 'list' && styles.activeModeBtn]} onPress={() => setMode('list')}>
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
              checkpoints.length > 0
                ? <Text style={styles.listHeading}>Tap a checkpoint to set what it does</Text>
                : null
            }
            renderItem={({ item }) => {
              const color = KIND_META[checkpointKind(item)].color;
              const vis = item.visibility ?? 'gm-only';
              return (
                <TouchableOpacity style={styles.checkpointRow} onPress={() => goToEditor(item.id)}>
                  <View style={[styles.listIcon, { borderColor: color }]}>
                    <Ionicons name={checkpointIcon(item.icon)} size={18} color={color} />
                  </View>
                  <View style={styles.cpInfo}>
                    <Text style={styles.cpName}>{item.name}</Text>
                    <Text style={styles.cpSub}>
                      {behaviorSummary(item)} · {item.radius}m{vis !== 'gm-only' ? ' · shown to players' : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  <TouchableOpacity onPress={() => confirmDeleteCheckpoint(item)} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No checkpoints yet.{'\n'}Switch to the map and long-press to add one.</Text>
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
                onRegionChangeComplete={(r) => { regionRef.current = r; }}
                onLongPress={(e) => openAddCheckpoint(e.nativeEvent.coordinate)}
              >
                <UrlTile urlTemplate={TOPO_TILE_URL} tileSize={TOPO_TILE_SIZE} maximumZ={TOPO_MAX_ZOOM} maximumNativeZ={TOPO_MAX_NATIVE_ZOOM} zIndex={-1} />
                {boundary && (
                  <Polygon coordinates={corners(boundary)} strokeColor={Colors.secondary} strokeWidth={2} fillColor="rgba(212, 137, 63, 0.08)" />
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
                {checkpoints.map((cp) => {
                  const color = KIND_META[checkpointKind(cp)].color;
                  return (
                    <Marker
                      key={`m-${cp.id}`}
                      coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
                      anchor={{ x: 0.5, y: 0.5 }}
                      onPress={() => openRenameCheckpoint(cp)}
                    >
                      <View style={[styles.pin, { borderColor: color }]}>
                        <Ionicons name={checkpointIcon(cp.icon)} size={16} color={color} />
                      </View>
                    </Marker>
                  );
                })}
              </MapView>
            )}

            <TouchableOpacity style={styles.locateBtn} onPress={() => centerOnUser(true)} disabled={locating}>
              <Ionicons name={locating ? 'ellipsis-horizontal' : 'locate'} size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.hint}>
              {boundary ? 'Long-press the map to drop a checkpoint. Tap a pin to rename or configure it.' : 'No boundary set yet — set it from the previous screen. Long-press to drop a checkpoint.'}
            </Text>
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </>
      )}

      {/* Quick add / rename modal — name + icon + radius only */}
      <Modal visible={showCpModal} transparent animationType="slide" onRequestClose={() => setShowCpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{editTarget ? 'Edit Checkpoint' : 'New Checkpoint'}</Text>
              {pendingCoord && (
                <Text style={styles.coords}>📍 {pendingCoord.latitude.toFixed(5)}, {pendingCoord.longitude.toFixed(5)}</Text>
              )}
              <Input label="Name" value={cpName} onChangeText={setCpName} placeholder="e.g. Cornucopia" />
              <Input label="Detection Radius (meters)" value={cpRadius} onChangeText={setCpRadius} keyboardType="number-pad" placeholder="100" />

              <Text style={styles.sectionLabel}>Map icon</Text>
              <View style={styles.iconGrid}>
                {CHECKPOINT_ICONS.map((opt) => {
                  const active = opt.key === cpIcon;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setCpIcon(opt.key)}
                      style={[styles.iconChip, active && styles.iconChipActive]}
                    >
                      <Ionicons name={opt.icon} size={20} color={active ? Colors.primary : Colors.textSecondary} />
                    </TouchableOpacity>
                  );
                })}
              </View>

              {editTarget ? (
                <>
                  <View style={styles.modalActions}>
                    <Button title="Cancel" onPress={() => setShowCpModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
                    <Button title="Save" onPress={() => handleSaveCheckpoint(false)} loading={savingCp} fullWidth={false} style={{ flex: 1 }} />
                  </View>
                  <TouchableOpacity
                    onPress={() => { setShowCpModal(false); goToEditor(editTarget.id); }}
                    style={styles.configureRow}
                  >
                    <Ionicons name="options-outline" size={18} color={Colors.primary} />
                    <Text style={styles.configureText}>Configure behavior</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDeleteCheckpoint(editTarget)} style={styles.deleteRow}>
                    <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                    <Text style={styles.deleteText}>Delete checkpoint</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.hintSmall}>Set what this checkpoint does next, or add it now and configure later.</Text>
                  <Button title="Add & configure" onPress={() => handleSaveCheckpoint(true)} loading={savingCp} />
                  <View style={styles.modalActions}>
                    <Button title="Cancel" onPress={() => setShowCpModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
                    <Button title="Add" onPress={() => handleSaveCheckpoint(false)} loading={savingCp} variant="secondary" fullWidth={false} style={{ flex: 1 }} />
                  </View>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text, marginLeft: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpCount: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpCountText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  modeToggle: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  modeBtn: { padding: 8, paddingHorizontal: 12 },
  activeModeBtn: { backgroundColor: Colors.surfaceElevated },
  list: { paddingHorizontal: 16, paddingVertical: 8, flexGrow: 1 },
  listHeading: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  checkpointRow: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  listIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, backgroundColor: Colors.surfaceElevated, marginRight: 10,
  },
  cpInfo: { flex: 1 },
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  mapWrapper: { flex: 1, position: 'relative' },
  mapLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.surface },
  mapLoadingText: { color: Colors.textSecondary, fontSize: 14 },
  pin: {
    width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: 2,
  },
  locateBtn: {
    position: 'absolute', right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  footer: { padding: 16, gap: 10 },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalContent: { padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  coords: { fontSize: 12, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  configureRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4,
  },
  configureText: { flex: 1, color: Colors.primary, fontSize: 15, fontWeight: '700' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },

  sectionLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: {
    width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  iconChipActive: { borderColor: Colors.primary, backgroundColor: hexToRgba(Colors.primary, 0.15) },
  hintSmall: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
});
