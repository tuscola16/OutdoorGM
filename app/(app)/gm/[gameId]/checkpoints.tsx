import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Modal, Alert, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { GameMap } from '@/components/GameMap';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors } from '@/constants/colors';
import { addCheckpoint, updateCheckpoint, deleteCheckpoint } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { Checkpoint } from '@/types';

type Mode = 'list' | 'map';

const DEFAULT_RADIUS = 100;

export default function CheckpointsScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, checkpoints, loadGame, clearGame } = useGame();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('list');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpRadius, setCpRadius] = useState(String(DEFAULT_RADIUS));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
  }, [gameId]);

  function openAddFromMap(coord: { latitude: number; longitude: number }) {
    setPendingCoord(coord);
    setCpName(`Checkpoint ${checkpoints.length + 1}`);
    setCpRadius(String(DEFAULT_RADIUS));
    setEditTarget(null);
    setShowAddModal(true);
  }

  function openEdit(cp: Checkpoint) {
    setEditTarget(cp);
    setCpName(cp.name);
    setCpRadius(String(cp.radius));
    setPendingCoord({ latitude: cp.latitude, longitude: cp.longitude });
    setShowAddModal(true);
  }

  async function handleSave() {
    if (!cpName.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const radius = parseInt(cpRadius, 10);
    if (isNaN(radius) || radius < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }
    if (!pendingCoord) return;
    if (!gameId) return;

    setSaving(true);
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
      setShowAddModal(false);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(cp: Checkpoint) {
    Alert.alert(`Delete "${cp.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!gameId) return;
          try {
            await deleteCheckpoint(gameId, cp.id);
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
        <Text style={styles.title}>Checkpoints</Text>
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'list' && styles.activeModeBtn]}
            onPress={() => setMode('list')}
          >
            <Ionicons name="list" size={18} color={mode === 'list' ? Colors.primary : Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'map' && styles.activeModeBtn]}
            onPress={() => setMode('map')}
          >
            <Ionicons name="map" size={18} color={mode === 'map' ? Colors.primary : Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'list' ? (
        <>
          <FlatList
            data={checkpoints}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={styles.checkpointRow}>
                <Ionicons name="location" size={20} color={Colors.primary} style={{ marginRight: 10 }} />
                <View style={styles.cpInfo}>
                  <Text style={styles.cpName}>{item.name}</Text>
                  <Text style={styles.cpSub}>
                    {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)} · {item.radius}m radius
                  </Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn}>
                  <Ionicons name="pencil-outline" size={18} color={Colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleDelete(item)} style={styles.iconBtn}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>
                  No checkpoints yet.{'\n'}Switch to map view and long-press to add one.
                </Text>
              </View>
            }
          />
          <View style={styles.footer}>
            <Button title="Switch to Map to Add Checkpoints" onPress={() => setMode('map')} variant="ghost" />
          </View>
        </>
      ) : (
        <View style={styles.mapWrapper}>
          <GameMap
            checkpoints={checkpoints}
            playerLocations={[]}
            boundary={game?.boundary}
            onMapLongPress={openAddFromMap}
            onCheckpointPress={openEdit}
            editMode
          />
          <View style={styles.mapHint}>
            <Text style={styles.mapHintText}>Long-press on map to add a checkpoint</Text>
          </View>
        </View>
      )}

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
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
              <Button title="Cancel" onPress={() => setShowAddModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
              <Button title={editTarget ? 'Save' : 'Add'} onPress={handleSave} loading={saving} fullWidth={false} style={{ flex: 1 }} />
            </View>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  modeBtn: { padding: 8, paddingHorizontal: 12 },
  activeModeBtn: { backgroundColor: Colors.surfaceElevated },
  list: { paddingHorizontal: 16, paddingVertical: 8 },
  checkpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cpInfo: { flex: 1 },
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  footer: { padding: 16 },
  mapWrapper: { flex: 1, position: 'relative' },
  mapHint: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  mapHintText: { color: Colors.text, fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  coords: { fontSize: 12, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
