import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_MAX_ZOOM } from '@/constants/map';
import { updateGameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { MapBoundary } from '@/types';

// Fractions of the screen the framing reticle insets from each edge. The saved
// boundary is the area *inside* the reticle, so it matches what the GM frames.
const RETICLE = { vertical: 0.15, horizontal: 0.08 };

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

export default function BoundaryScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, loadGame, clearGame } = useGame();
  const router = useRouter();
  const boundary: MapBoundary | undefined = game?.boundary;
  const mapRef = useRef<MapView>(null);
  const initialRegion: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  // Default the captured region to the initial view so saving works even if the
  // GM doesn't pan; onRegionChangeComplete keeps it current as they move.
  const regionRef = useRef<Region | null>(initialRegion);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
  }, [gameId]);

  // On first open (no boundary yet), center the map on the GM's current location so
  // they start framing where they actually are instead of the middle of the country.
  useEffect(() => {
    if (boundary) return; // editing an existing boundary — handled below
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (cancelled) return;
        const region: Region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        regionRef.current = region;
        mapRef.current?.animateToRegion(region, 600);
      } catch {
        // Location unavailable — leave the default region in place.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // When editing an existing boundary, recenter the map on it once it loads.
  useEffect(() => {
    if (!boundary || !mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: (boundary.minLat + boundary.maxLat) / 2,
      longitude: (boundary.minLng + boundary.maxLng) / 2,
      latitudeDelta: Math.max(0.005, boundary.maxLat - boundary.minLat),
      longitudeDelta: Math.max(0.005, boundary.maxLng - boundary.minLng),
    }, 500);
  }, [boundary?.minLat, boundary?.maxLat, boundary?.minLng, boundary?.maxLng]);

  async function handleSave() {
    if (!gameId || !regionRef.current) {
      Alert.alert('Move the map', 'Pan and zoom so the play area fills the screen, then save.');
      return;
    }
    setSaving(true);
    try {
      await updateGameConfig(gameId, { boundary: regionToBoundary(regionRef.current) });
      router.back();
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSaving(false);
    }
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
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType="none"
          initialRegion={initialRegion}
          onRegionChangeComplete={(r) => { regionRef.current = r; }}
        >
          <UrlTile urlTemplate={TOPO_TILE_URL} maximumZ={TOPO_MAX_ZOOM} zIndex={-1} />
          {boundary && (
            <Polygon
              coordinates={corners(boundary)}
              strokeColor={Colors.secondary}
              strokeWidth={2}
              fillColor="rgba(212, 137, 63, 0.08)"
            />
          )}
        </MapView>

        {/* Reticle showing the area that will be captured */}
        <View pointerEvents="none" style={styles.reticle} />
      </View>

      <View style={styles.footer}>
        <Text style={styles.hint}>
          Pan and zoom so the play area fills the framed box, then save. The current
          view becomes the boundary.
        </Text>
        <Button title="Set Boundary to Current View" onPress={handleSave} loading={saving} />
      </View>
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
  title: { fontSize: 20, fontWeight: '800', color: Colors.text },
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
  footer: { padding: 16, gap: 12 },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
