import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, FlatList,
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
import {
  updateGameConfig, addCheckpoint, updateCheckpoint, deleteCheckpoint,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { MapBoundary, Checkpoint } from '@/types';

// Fractions of the screen the framing reticle insets from each edge. The saved
// boundary is the area *inside* the reticle, so it matches what the GM frames.
const RETICLE = { vertical: 0.15, horizontal: 0.08 };
const DEFAULT_RADIUS = 100;

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

export default function PlayAreaScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, checkpoints, loadGame } = useGame();
  const router = useRouter();
  const boundary: MapBoundary | undefined = game?.boundary;
  const mapRef = useRef<MapView>(null);
  const initialRegion: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  // Default the captured region to the initial view so saving works even if the
  // GM doesn't pan; onRegionChangeComplete keeps it current as they move.
  const regionRef = useRef<Region | null>(initialRegion);
  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [locating, setLocating] = useState(false);
  const didAutoCenter = useRef(false);
  const [savingBoundary, setSavingBoundary] = useState(false);

  // Checkpoint add/edit modal state
  const [showCpModal, setShowCpModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpRadius, setCpRadius] = useState(String(DEFAULT_RADIUS));
  const [savingCp, setSavingCp] = useState(false);

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
      const region: Region = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      };
      regionRef.current = region;
      mapRef.current?.animateToRegion(region, 600);
    } catch {
      // Location unavailable — leave the current view in place.
    } finally {
      setLocating(false);
    }
  }, []);

  // Auto-center on the GM's location for a fresh (boundary-less) game.
  //
  // Earlier approaches were unreliable: gating on `onMapReady` (which is flaky
  // with mapType="none") and a one-shot getCurrentPositionAsync (which often
  // hangs on Android cold start), with an onUserLocationChange fallback that only
  // fires when the device actually *moves* — so a stationary GM with a cached fix
  // saw their pin but the map never recentered.
  //
  // watchPositionAsync is the reliable trigger: it delivers the current fix
  // shortly after subscribing even when the device is still, and that ~1s delay
  // means the map is already laid out, so animateToRegion isn't dropped. We jump
  // on the first fix, then stop watching so we don't yank the map while the GM
  // frames the play area. The manual "locate me" button still uses centerOnUser.
  useEffect(() => {
    if (boundary) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 },
          (pos) => {
            if (cancelled || didAutoCenter.current) return;
            didAutoCenter.current = true;
            const region: Region = {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              latitudeDelta: 0.02,
              longitudeDelta: 0.02,
            };
            regionRef.current = region;
            // Double-fire: on Android the first animateToRegion right after layout
            // is occasionally dropped, so re-issue it a beat later.
            mapRef.current?.animateToRegion(region, 600);
            setTimeout(() => { mapRef.current?.animateToRegion(region, 600); }, 350);
            sub?.remove();
            sub = null;
          }
        );
      } catch {
        // Location unavailable — leave the default view in place.
      }
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [boundary]);

  // When a boundary already exists, recenter the map on it once it loads.
  useEffect(() => {
    if (!boundary || !mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: (boundary.minLat + boundary.maxLat) / 2,
      longitude: (boundary.minLng + boundary.maxLng) / 2,
      latitudeDelta: Math.max(0.005, boundary.maxLat - boundary.minLat),
      longitudeDelta: Math.max(0.005, boundary.maxLng - boundary.minLng),
    }, 500);
  }, [boundary?.minLat, boundary?.maxLat, boundary?.minLng, boundary?.maxLng]);

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

  function openAddCheckpoint(coord: { latitude: number; longitude: number }) {
    setPendingCoord(coord);
    setEditTarget(null);
    setCpName(`Checkpoint ${checkpoints.length + 1}`);
    setCpRadius(String(DEFAULT_RADIUS));
    setShowCpModal(true);
  }

  function openEditCheckpoint(cp: Checkpoint) {
    setEditTarget(cp);
    setPendingCoord({ latitude: cp.latitude, longitude: cp.longitude });
    setCpName(cp.name);
    setCpRadius(String(cp.radius));
    setShowCpModal(true);
  }

  async function handleSaveCheckpoint() {
    if (!cpName.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const radius = parseInt(cpRadius, 10);
    if (isNaN(radius) || radius < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }
    if (!pendingCoord || !gameId) return;

    setSavingCp(true);
    try {
      if (editTarget) {
        await updateCheckpoint(gameId, editTarget.id, { name: cpName.trim(), radius });
      } else {
        await addCheckpoint(gameId, {
          name: cpName.trim(),
          latitude: pendingCoord.latitude,
          longitude: pendingCoord.longitude,
          radius,
        });
      }
      setShowCpModal(false);
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
            renderItem={({ item }) => (
              <View style={styles.checkpointRow}>
                <Ionicons name="location" size={20} color={Colors.primary} style={{ marginRight: 10 }} />
                <View style={styles.cpInfo}>
                  <Text style={styles.cpName}>{item.name}</Text>
                  <Text style={styles.cpSub}>
                    {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)} · {item.radius}m radius
                  </Text>
                </View>
                <TouchableOpacity onPress={() => openEditCheckpoint(item)} style={styles.iconBtn}>
                  <Ionicons name="pencil-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => confirmDeleteCheckpoint(item)} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            )}
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
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType="none"
          initialRegion={initialRegion}
          showsUserLocation
          showsMyLocationButton={false}
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

          {checkpoints.map((cp) => (
            <Circle
              key={`c-${cp.id}`}
              center={{ latitude: cp.latitude, longitude: cp.longitude }}
              radius={cp.radius}
              fillColor="rgba(232, 64, 42, 0.15)"
              strokeColor={Colors.primary}
              strokeWidth={2}
            />
          ))}
          {checkpoints.map((cp) => (
            <Marker
              key={`m-${cp.id}`}
              coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
              title={cp.name}
              description={`Radius: ${cp.radius}m — tap to edit`}
              pinColor={Colors.secondary}
              onPress={() => openEditCheckpoint(cp)}
            />
          ))}
        </MapView>

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
          <View style={styles.modalContent}>
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
              autoFocus
            />
            <Input
              label="Detection Radius (meters)"
              value={cpRadius}
              onChangeText={setCpRadius}
              keyboardType="number-pad"
              placeholder="100"
            />
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
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  mapWrapper: { flex: 1, position: 'relative' },
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
  modalContent: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  coords: { fontSize: 12, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
});
