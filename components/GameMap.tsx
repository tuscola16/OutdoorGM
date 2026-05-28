import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { Colors } from '@/constants/colors';
import type { Checkpoint, PlayerLocation } from '@/types';

interface GameMapProps {
  checkpoints: Checkpoint[];
  playerLocations: PlayerLocation[];
  onMapLongPress?: (coord: { latitude: number; longitude: number }) => void;
  onCheckpointPress?: (checkpoint: Checkpoint) => void;
  editMode?: boolean;
  initialRegion?: Region;
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
  onMapLongPress,
  onCheckpointPress,
  editMode = false,
  initialRegion,
}: GameMapProps) {
  const mapRef = useRef<MapView>(null);

  // Auto-fit map to show all markers when data loads
  useEffect(() => {
    if (!mapRef.current) return;
    const coords = [
      ...checkpoints.map((c) => ({ latitude: c.latitude, longitude: c.longitude })),
      ...playerLocations.map((p) => ({ latitude: p.latitude, longitude: p.longitude })),
    ];
    if (coords.length > 0) {
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 80, bottom: 80, left: 80 },
        animated: true,
      });
    }
  }, [checkpoints.length, playerLocations.length]);

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      mapType="hybrid"
      initialRegion={
        initialRegion ?? {
          latitude: 37.0902,
          longitude: -95.7129,
          latitudeDelta: 30,
          longitudeDelta: 30,
        }
      }
      onLongPress={
        onMapLongPress ? (e) => onMapLongPress(e.nativeEvent.coordinate) : undefined
      }
      showsUserLocation={false}
      showsMyLocationButton={false}
    >
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
