import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Modal,
  Dimensions, Alert
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useGame } from '@/context/GameContext';
import { GameMap } from '@/components/GameMap';
import { AlertFeed } from '@/components/AlertFeed';
import { Colors } from '@/constants/colors';
import { onForegroundMessage } from '@/services/notificationService';
import { endGame } from '@/services/gameService';
import type { Checkpoint } from '@/types';

const { width } = Dimensions.get('window');

type Tab = 'map' | 'alerts';

export default function GMGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { user } = useAuth();
  const { game, checkpoints, playerLocations, arrivals, loadGame, clearGame, myRole } = useGame();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('map');
  const [showCodes, setShowCodes] = useState(false);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [lastSeenArrivals, setLastSeenArrivals] = useState(0);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
  }, [gameId]);

  // Track unseen alerts
  useEffect(() => {
    if (tab === 'alerts') {
      setLastSeenArrivals(arrivals.length);
      setNewAlertCount(0);
    } else {
      const newCount = arrivals.length - lastSeenArrivals;
      setNewAlertCount(Math.max(0, newCount));
    }
  }, [arrivals.length, tab]);

  // Handle foreground FCM alerts
  useEffect(() => {
    return onForegroundMessage((title, body) => {
      // Will show as local notification via notificationService
    });
  }, []);

  function handleCheckpointPress(checkpoint: Checkpoint) {
    Alert.alert(
      checkpoint.name,
      `Radius: ${checkpoint.radius}m\nLat: ${checkpoint.latitude.toFixed(6)}\nLng: ${checkpoint.longitude.toFixed(6)}`,
      [{ text: 'OK' }]
    );
  }

  async function handleEndGame() {
    Alert.alert(
      'End Game?',
      'This will stop the game for all players.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Game',
          style: 'destructive',
          onPress: async () => {
            if (gameId) await endGame(gameId);
            router.replace('/(app)/games');
          },
        },
      ]
    );
  }

  const players = playerLocations.filter(() => true); // all locations

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(app)/games')}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.gameName} numberOfLines={1}>{game?.name ?? '…'}</Text>
          <Text style={styles.gmBadge}>GAME MASTER</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowCodes(true)} style={styles.headerBtn}>
            <Ionicons name="qr-code-outline" size={22} color={Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(`/(app)/gm/${gameId}/checkpoints`)} style={styles.headerBtn}>
            <Ionicons name="map-outline" size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{playerLocations.length}</Text>
          <Text style={styles.statLabel}>Active Players</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{checkpoints.length}</Text>
          <Text style={styles.statLabel}>Checkpoints</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{arrivals.length}</Text>
          <Text style={styles.statLabel}>Arrivals</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, tab === 'map' && styles.activeTab]}
          onPress={() => setTab('map')}
        >
          <Ionicons name="map" size={18} color={tab === 'map' ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'map' && styles.activeTabText]}>Map</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'alerts' && styles.activeTab]}
          onPress={() => setTab('alerts')}
        >
          <Ionicons name="notifications" size={18} color={tab === 'alerts' ? Colors.primary : Colors.textSecondary} />
          <Text style={[styles.tabText, tab === 'alerts' && styles.activeTabText]}>Alerts</Text>
          {newAlertCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{newAlertCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {tab === 'map' ? (
          <GameMap
            checkpoints={checkpoints}
            playerLocations={playerLocations}
            onCheckpointPress={handleCheckpointPress}
          />
        ) : (
          <View style={styles.alertContainer}>
            <AlertFeed arrivals={arrivals} />
          </View>
        )}
      </View>

      {/* End Game button */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={handleEndGame} style={styles.endBtn}>
          <Text style={styles.endBtnText}>End Game</Text>
        </TouchableOpacity>
      </View>

      {/* Codes modal */}
      <Modal visible={showCodes} transparent animationType="slide" onRequestClose={() => setShowCodes(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Game Codes</Text>
            <Text style={styles.modalSub}>Share these codes for players and co-GMs to join.</Text>

            <View style={styles.codeBlock}>
              <Text style={styles.codeLabel}>PLAYER CODE</Text>
              <Text style={styles.codeValue}>{game?.playerCode ?? '…'}</Text>
              <Text style={styles.codeDesc}>Players join — they cannot see others or checkpoints</Text>
            </View>

            <View style={[styles.codeBlock, styles.gmCodeBlock]}>
              <Text style={styles.codeLabel}>GM CODE</Text>
              <Text style={styles.codeValue}>{game?.gmCode ?? '…'}</Text>
              <Text style={styles.codeDesc}>Co-GMs join — they see everything</Text>
            </View>

            <TouchableOpacity onPress={() => setShowCodes(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
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
  headerCenter: { flex: 1 },
  gameName: { fontSize: 18, fontWeight: '800', color: Colors.text },
  gmBadge: { fontSize: 11, color: Colors.secondary, fontWeight: '700', letterSpacing: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 4 },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  activeTab: { backgroundColor: Colors.surfaceElevated },
  tabText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  activeTabText: { color: Colors.primary },
  badge: {
    backgroundColor: Colors.danger,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: Colors.white, fontSize: 10, fontWeight: '700' },
  content: { flex: 1, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  alertContainer: { flex: 1, backgroundColor: Colors.surface, padding: 12 },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  endBtn: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.danger,
  },
  endBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 14 },
  // Modal
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
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  modalSub: { fontSize: 14, color: Colors.textSecondary, marginBottom: 24 },
  codeBlock: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  gmCodeBlock: { borderColor: Colors.secondary + '66' },
  codeLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  codeValue: { fontSize: 32, fontWeight: '800', color: Colors.text, letterSpacing: 8, marginBottom: 4 },
  codeDesc: { fontSize: 12, color: Colors.textSecondary },
  closeBtn: {
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
  },
  closeBtnText: { color: Colors.text, fontWeight: '600', fontSize: 16 },
});
