import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_TILE_SIZE, TOPO_MAX_ZOOM, TOPO_MAX_NATIVE_ZOOM } from '@/constants/map';
import { updateGameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { MapBoundary } from '@/types';

// Fractions of the screen the framing reticle insets from each edge. The saved
// boundary is the area *inside* the reticle, so it matches what the GM frames.
const RETICLE = { vertical: 0.15, horizontal: 0.08 };
// Center-of-US fallback view, used only if we can't get the GM's location.
const DEFAULT_REGION: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const USER_DELTA = 0.02;

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

// Polygon vertices when present (≥ 3), else the min/max rectangle corners. The
// reticle editor here only authors rectangles; a polygon (authored on web) is
// still rendered read-only.
function corners(b: MapBoundary) {
  if (b.polygon && b.polygon.length >= 3) return b.polygon;
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

export default function BoundaryScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, loadGame } = useGame();
  const router = useRouter();
  const boundary: MapBoundary | undefined = game?.boundary;
  // A polygon boundary is authored on the web dashboard; this rectangle reticle
  // can't represent one, so saving here would silently replace it with a box.
  const hasPolygon = !!boundary?.polygon && boundary.polygon.length >= 3;
  const mapRef = useRef<MapView>(null);
  // The map opens framed on `displayRegion`. animateToRegion is a no-op on this
  // mapType="none" + Google setup, so to recenter we *remount* the MapView (bump
  // `renderKey`) — that lets a late GPS fix and the manual "locate" button recenter.
  const [displayRegion, setDisplayRegion] = useState<Region | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const gotInitialFix = useRef(false);
  const mapMountedRef = useRef(false);
  const regionRef = useRef<Region | null>(DEFAULT_REGION);
  const [locating, setLocating] = useState(false);
  const [savingBoundary, setSavingBoundary] = useState(false);

  const showRegion = useCallback((region: Region) => {
    regionRef.current = region;
    if (mapMountedRef.current) setRenderKey((k) => k + 1);
    mapMountedRef.current = true;
    setDisplayRegion(region);
  }, []);

  const regionFromCoords = (c: { latitude: number; longitude: number }): Region => ({
    latitude: c.latitude, longitude: c.longitude, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA,
  });

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

  // Otherwise frame on the GM's current location.
  useEffect(() => {
    if (boundary) return;
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
        if (status !== 'granted') { if (!gotInitialFix.current) showRegion(DEFAULT_REGION); return; }
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
    const fallback = setTimeout(() => { if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION); }, 9000);
    return () => { cancelled = true; clearTimeout(fallback); sub?.remove(); };
  }, [boundary, showRegion]);

  async function saveRectBoundary() {
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

  function handleSaveBoundary() {
    // Replacing a web-drawn polygon with a rectangle is destructive — confirm first.
    if (hasPolygon) {
      Alert.alert(
        'Replace polygon boundary?',
        'This game has a custom polygon play area drawn on the web dashboard. Saving here ' +
          'replaces it with a rectangle. Edit the polygon on the web dashboard instead to keep it.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace with rectangle', style: 'destructive', onPress: () => { void saveRectBoundary(); } },
        ]
      );
      return;
    }
    void saveRectBoundary();
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Play Boundary</Text>
        <View style={{ width: 24 }} />
      </View>

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
            onUserLocationChange={(e) => {
              if (boundary || gotInitialFix.current) return;
              const c = e.nativeEvent?.coordinate;
              if (!c) return;
              gotInitialFix.current = true;
              showRegion(regionFromCoords(c));
            }}
            onRegionChangeComplete={(r) => { regionRef.current = r; }}
          >
            <UrlTile urlTemplate={TOPO_TILE_URL} tileSize={TOPO_TILE_SIZE} maximumZ={TOPO_MAX_ZOOM} maximumNativeZ={TOPO_MAX_NATIVE_ZOOM} zIndex={-1} />
            {boundary && (
              <Polygon coordinates={corners(boundary)} strokeColor={Colors.secondary} strokeWidth={2} fillColor="rgba(212, 137, 63, 0.08)" />
            )}
          </MapView>
        )}

        {/* Reticle showing the area that will be captured as the boundary */}
        <View pointerEvents="none" style={styles.reticle} />

        <TouchableOpacity style={styles.locateBtn} onPress={() => centerOnUser(true)} disabled={locating}>
          <Ionicons name={locating ? 'ellipsis-horizontal' : 'locate'} size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.hint}>
          {hasPolygon
            ? 'This game uses a custom polygon play area drawn on the web dashboard. ' +
              'Edit it there; saving a rectangle here would replace the polygon.'
            : 'Frame the play area inside the box and tap below to set the boundary. Add ' +
              'checkpoints separately from the Checkpoints screen.'}
        </Text>
        <Button
          title={
            hasPolygon
              ? 'Replace Polygon with This Rectangle'
              : boundary
                ? 'Update Boundary to This View'
                : 'Set Boundary to This View'
          }
          onPress={handleSaveBoundary}
          loading={savingBoundary}
        />
        <Button title="Done" onPress={() => router.back()} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text, marginLeft: 12 },
  mapWrapper: { flex: 1, position: 'relative' },
  mapLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.surface },
  mapLoadingText: { color: Colors.textSecondary, fontSize: 14 },
  reticle: {
    position: 'absolute', top: '15%', left: '8%', right: '8%', bottom: '15%',
    borderWidth: 2, borderColor: Colors.primary, borderRadius: 8, backgroundColor: 'rgba(212, 137, 63, 0.05)',
  },
  locateBtn: {
    position: 'absolute', right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  footer: { padding: 16, gap: 10 },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
