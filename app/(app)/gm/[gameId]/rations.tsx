import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { reviewRation, rationInterval, gameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import type { RationSubmission } from '@/types';

export default function RationsScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, rations, members, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(15000);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const cfg = gameConfig(game);
  const interval = rationInterval(game, now);
  const currentIndex = interval?.index ?? null;
  const windowOpen = interval?.isOpen ?? false; // #66

  // Card numbers in use (valid or pending) — for the uniqueness flag (Rule 6).
  // Manual enforcement: the GM sees the dupe and rejects it.
  const cardCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rations) {
      const c = r.cardNumber?.trim();
      if (c && r.status !== 'rejected') counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return counts;
  }, [rations]);

  // Pending first, then most recent. The GM works the top of the list.
  const ordered = useMemo(() => {
    const rank = (s: RationSubmission['status']) => (s === 'pending' ? 0 : s === 'rejected' ? 1 : 2);
    return [...rations].sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0)
    );
  }, [rations]);

  // Alive players with no valid/pending submission for the current window. #66: only once
  // the eat-window is actually open — before then nobody is late, so the list stays empty.
  const notEaten = useMemo(() => {
    if (currentIndex == null || !windowOpen) return [];
    const fed = new Set(
      rations
        .filter((r) => r.intervalIndex === currentIndex && r.status !== 'rejected')
        .map((r) => r.playerId)
    );
    return members.filter((m) => m.role === 'player' && !m.out && !fed.has(m.userId));
  }, [rations, members, currentIndex, windowOpen]);

  async function review(r: RationSubmission, status: 'valid' | 'rejected') {
    if (!gameId) return;
    setBusyId(r.id);
    try {
      await reviewRation(gameId, r.id, status);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = rations.filter((r) => r.status === 'pending').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Ration review</Text>
          <Text style={styles.sub}>
            {pendingCount > 0 ? `${pendingCount} awaiting review` : 'All caught up'}
            {currentIndex != null ? ` · window ${currentIndex + 1}/${interval?.total ?? '—'}` : ''}
          </Text>
        </View>
      </View>

      {!cfg.rationsEnabled && (
        <View style={styles.banner}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.bannerText}>Rations are turned off in Game settings.</Text>
        </View>
      )}

      {/* Who hasn't eaten this window — the GM's glance view. */}
      {currentIndex != null && notEaten.length > 0 && (
        <View style={styles.notEatenCard}>
          <Text style={styles.notEatenTitle}>
            Not eaten this window ({notEaten.length})
          </Text>
          <Text style={styles.notEatenNames}>
            {notEaten.map((m) => m.displayName).join(', ')}
          </Text>
          <Text style={styles.notEatenHint}>
            Eliminate from the Players list if they miss the window (starvation).
          </Text>
        </View>
      )}

      <FlatList
        data={ordered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const dup =
            cfg.enforceUniqueRationCards &&
            !!item.cardNumber?.trim() &&
            (cardCounts.get(item.cardNumber.trim()) ?? 0) > 1 &&
            item.status !== 'rejected';
          return (
            <View style={styles.row}>
              <TouchableOpacity onPress={() => setLightbox(item.photoUrl)} activeOpacity={0.8}>
                <Image source={{ uri: item.photoUrl }} style={styles.thumb} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.playerName}>{item.playerName}</Text>
                <Text style={styles.meta}>
                  Window {item.intervalIndex + 1}
                  {item.cardNumber ? ` · card #${item.cardNumber}` : ''}
                </Text>
                {dup && (
                  <View style={styles.dupTag}>
                    <Ionicons name="warning" size={12} color={Colors.danger} />
                    <Text style={styles.dupText}>Card number reused</Text>
                  </View>
                )}
                {item.status === 'valid' && <Text style={styles.statusValid}>✓ Accepted</Text>}
                {item.status === 'rejected' && <Text style={styles.statusRejected}>✕ Rejected</Text>}
              </View>
              {item.status === 'pending' && (
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn]}
                    disabled={busyId === item.id}
                    onPress={() => review(item, 'rejected')}
                  >
                    <Ionicons name="close" size={20} color={Colors.danger} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.validBtn]}
                    disabled={busyId === item.id}
                    onPress={() => review(item, 'valid')}
                  >
                    <Ionicons name="checkmark" size={20} color={Colors.success} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="restaurant-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No ration cards submitted yet.</Text>
          </View>
        }
      />

      <Modal visible={!!lightbox} transparent animationType="fade" onRequestClose={() => setLightbox(null)}>
        <TouchableOpacity style={styles.lightboxOverlay} activeOpacity={1} onPress={() => setLightbox(null)}>
          {lightbox && <Image source={{ uri: lightbox }} style={styles.lightboxImage} resizeMode="contain" />}
          <Text style={styles.lightboxHint}>Tap to close</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { padding: 4 },
  title: { fontSize: 20, fontWeight: '800', color: Colors.text },
  sub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8,
    padding: 12, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border,
  },
  bannerText: { color: Colors.textSecondary, fontSize: 13 },
  notEatenCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: 12,
    backgroundColor: Colors.danger + '14', borderWidth: 1, borderColor: Colors.danger,
  },
  notEatenTitle: { color: Colors.danger, fontWeight: '700', fontSize: 14 },
  notEatenNames: { color: Colors.text, fontSize: 14, marginTop: 4, lineHeight: 20 },
  notEatenHint: { color: Colors.textSecondary, fontSize: 12, marginTop: 6 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: Colors.surfaceElevated },
  playerName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  meta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  dupTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  dupText: { color: Colors.danger, fontSize: 12, fontWeight: '600' },
  statusValid: { color: Colors.success, fontSize: 12, fontWeight: '600', marginTop: 4 },
  statusRejected: { color: Colors.danger, fontSize: 12, fontWeight: '600', marginTop: 4 },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  rejectBtn: { borderColor: Colors.danger },
  validBtn: { borderColor: Colors.success },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 64 },
  emptyText: { color: Colors.textMuted, fontSize: 14 },
  lightboxOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  lightboxImage: { width: '92%', height: '80%' },
  lightboxHint: { color: Colors.textSecondary, fontSize: 14 },
});
