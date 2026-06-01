import React, { useRef, useEffect, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { Marker, Circle, Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_TILE_SIZE, TOPO_MAX_ZOOM, TOPO_MAX_NATIVE_ZOOM } from '@/constants/map';
import type { Checkpoint, PlayerLocation, MapBoundary } from '@/types';

// Whole-US fallback, used only when there's no boundary/checkpoints/players to frame.
const DEFAULT_REGION: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 30, longitudeDelta: 30 };

/** Region framing a rectangular boundary, with ~30% padding so it isn't edge-to-edge. */
function regionFromBoundary(b: MapBoundary): Region {
  const latSpan = Math.max(0.005, b.maxLat - b.minLat);
  const lngSpan = Math.max(0.005, b.maxLng - b.minLng);
  return {
    latitude: (b.minLat + b.maxLat) / 2,
    longitude: (b.minLng + b.maxLng) / 2,
    latitudeDelta: latSpan * 1.3,
    longitudeDelta: lngSpan * 1.3,
  };
}

/** Region covering a set of points (bounding box + padding), or null if empty. */
function regionFromCoords(coords: { latitude: number; longitude: number }[]): Region | null {
  if (coords.length === 0) return null;
  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.005, (maxLat - minLat) * 1.3),
    longitudeDelta: Math.max(0.005, (maxLng - minLng) * 1.3),
  };
}

interface GameMapProps {
  checkpoints: Checkpoint[];
  playerLocations: PlayerLocation[];
  boundary?: MapBoundary | null;
  onMapLongPress?: (coord: { latitude: number; longitude: number }) => void;
  onCheckpointPress?: (checkpoint: Checkpoint) => void;
  editMode?: boolean;
  initialRegion?: Region;
}

/** The four corners of a rectangular boundary, for a map Polygon. */
function boundaryCorners(b: MapBoundary) {
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

function PlayerMarker({ player }: { player: PlayerLocation }) {
  const initials = player.displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <Marker
      coordinate={{ latitude: player.latitude, longitude: player.longitude }}
      anchor={{ x: 0.5, y: 0.5 }}
      title={player.displayName}
    >
      <View style={styles.playerMarker}>
        <Text style={styles.playerInitials}>{initials}</Text>
      </View>
    </Marker>
  );
}

function CheckpointMarker({
  checkpoint,
  onPress,
  editMode,
}: {
  checkpoint: Checkpoint;
  onPress?: () => void;
  editMode?: boolean;
}) {
  return (
    <>
      <Circle
        center={{ latitude: checkpoint.latitude, longitude: checkpoint.longitude }}
        radius={checkpoint.radius}
        fillColor="rgba(232, 64, 42, 0.15)"
        strokeColor={Colors.primary}
        strokeWidth={2}
      />
      <Marker
        coordinate={{ latitude: checkpoint.latitude, longitude: checkpoint.longitude }}
        title={checkpoint.name}
        description={`Radius: ${checkpoint.radius}m`}
        onPress={onPress}
        pinColor={editMode ? Colors.secondary : Colors.checkpointPin}
      />
    </>
  );
}

export function GameMap({
  checkpoints,
  playerLocations,
  boundary,
  onMapLongPress,
  onCheckpointPress,
  editMode = false,
  initialRegion,
}: GameMapProps) {
  const mapRef = useRef<MapView>(null);

  // Frame the map on mount. animateToRegion/fitToCoordinates are no-ops on this
  // mapType="none" + Google setup, so we can't reliably zoom *after* render —
  // instead we compute the opening region (boundary first, else the checkpoints/
  // players bounding box) and pass it as initialRegion so the map *opens* framed.
  // This is what zooms the player's map to the boundary when the game starts.
  const computedInitialRegion = useMemo<Region>(() => {
    if (initialRegion) return initialRegion;
    // Frame everything we know about at mount: the boundary plus any checkpoints
    // and live player pins. For the GM this keeps players in view (not just the
    // play area); for the player (who gets only the boundary) it frames the area.
    const coords = [
      ...(boundary ? boundaryCorners(boundary) : []),
      ...checkpoints.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
      ...playerLocations.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    ];
    return regionFromCoords(coords) ?? (boundary ? regionFromBoundary(boundary) : DEFAULT_REGION);
    // Intentionally computed once for the initial mount; MapView ignores later
    // initialRegion changes.
  }, [initialRegion, boundary, checkpoints, playerLocations]);

  // Best-effort dynamic re-fit as live data changes (e.g. players spreading out).
  // Harmless if it no-ops; initialRegion already gives a correct starting frame.
  useEffect(() => {
    if (!mapRef.current) return;
    const coords = [
      ...(boundary ? boundaryCorners(boundary) : []),
      ...checkpoints.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
      ...playerLocations.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    ];
    if (coords.length > 0) {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    }
  }, [checkpoints.length, playerLocations.length, boundary?.minLat, boundary?.maxLat, boundary?.minLng, boundary?.maxLng]);

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      mapType="none"
      initialRegion={computedInitialRegion}
      onLongPress={
        onMapLongPress ? (e) => onMapLongPress(e.nativeEvent.coordinate) : undefined
      }
      showsUserLocation={false}
      showsMyLocationButton={false}
    >
      {/* Outdoors basemap (trails + terrain) in place of satellite imagery */}
      <UrlTile
        urlTemplate={TOPO_TILE_URL}
        tileSize={TOPO_TILE_SIZE}
        maximumZ={TOPO_MAX_ZOOM}
        maximumNativeZ={TOPO_MAX_NATIVE_ZOOM}
        zIndex={-1}
      />
      {boundary && (
        <Polygon
          coordinates={boundaryCorners(boundary)}
          strokeColor={Colors.secondary}
          strokeWidth={2}
          fillColor="rgba(212, 137, 63, 0.08)"
        />
      )}
      {checkpoints.map((cp) => (
        <CheckpointMarker
          key={cp.id}
          checkpoint={cp}
          onPress={onCheckpointPress ? () => onCheckpointPress(cp) : undefined}
          editMode={editMode}
        />
      ))}
      {playerLocations.map((pl) => (
        <PlayerMarker key={pl.userId} player={pl} />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    flex: 1,
    width: '100%',
  },
  playerMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.playerDot,
    borderWidth: 2,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 5,
  },
  playerInitials: {
    color: Colors.black,
    fontWeight: '800',
    fontSize: 12,
  },
});
