import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { getMyGames, gamePhase, deleteGame, cloneGame, setGameArchived, type MyGameEntry } from '@/services/gameService';
import { getFcmToken } from '@/services/notificationService';
import { friendlyError } from '@/services/errorUtils';

const PHASE_TEXT: Record<string, string> = {
  setup: '● Setting up',
  lobby: '● Lobby open',
  play: '● In play',
  results: '○ Finished',
};

type GameEntry = MyGameEntry;

export default function GamesScreen() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<GameEntry | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);

  const loadGames = useCallback(async () => {
    if (!user) return;
    try {
      const result = await getMyGames(user.uid);
      setGames(result);
      setError('');
    } catch (err) {
      console.error('loadGames error', err);
      setError("Couldn't load your games. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Reload every time the screen regains focus (e.g. returning from creating or
  // joining a game), not just on first mount — the screen stays mounted in the
  // navigation stack, so a plain mount effect would show a stale list.
  useFocusEffect(
    useCallback(() => { loadGames(); }, [loadGames])
  );

  function openGame(entry: GameEntry) {
    if (entry.role === 'gm') {
      router.push(`/(app)/gm/${entry.game.id}`);
    } else {
      router.push({ pathname: '/(app)/player/game', params: { gameId: entry.game.id } });
    }
  }

  async function toggleArchive(entry: GameEntry) {
    if (!user) return;
    const next = !entry.archived;
    // Optimistically flip locally so the card moves between views immediately.
    setGames((prev) =>
      prev.map((g) => (g.game.id === entry.game.id ? { ...g, archived: next } : g))
    );
    try {
      await setGameArchived(entry.game.id, user.uid, next);
    } catch (err) {
      setGames((prev) =>
        prev.map((g) => (g.game.id === entry.game.id ? { ...g, archived: !next } : g))
      );
      Alert.alert('Error', friendlyError(err));
    }
  }

  function confirmDelete(entry: GameEntry) {
    Alert.alert(
      `Delete "${entry.game.name}"?`,
      'This permanently removes the game, its checkpoints, and all members for everyone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteGame(entry.game.id);
              setGames((prev) => prev.filter((g) => g.game.id !== entry.game.id));
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  function startClone(entry: GameEntry) {
    setCloneTarget(entry);
    setCloneName(`${entry.game.name} (copy)`);
  }

  async function confirmClone() {
    if (!cloneTarget) return;
    const name = cloneName.trim();
    if (!name) { Alert.alert('Name required', 'Enter a name for the new game.'); return; }
    const gmName = profile?.displayName?.trim() || 'GM';
    setCloneBusy(true);
    try {
      const fcmToken = await getFcmToken();
      const { id } = await cloneGame(cloneTarget.game.id, gmName, name, fcmToken ?? undefined);
      setCloneTarget(null);
      router.push(`/(app)/gm/${id}`);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setCloneBusy(false);
    }
  }

  function openActions(entry: GameEntry) {
    const phase = gamePhase(entry.game);
    const isGM = entry.role === 'gm';
    const canDelete = isGM && (phase === 'setup' || phase === 'lobby');
    const canArchive = phase === 'results';

    const options: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [];
    if (isGM) {
      options.push({ text: 'Clone game (setup only)', onPress: () => startClone(entry) });
    }
    if (canArchive) {
      options.push({
        text: entry.archived ? 'Unarchive' : 'Archive',
        onPress: () => toggleArchive(entry),
      });
    }
    if (canDelete) {
      options.push({ text: 'Delete game', style: 'destructive', onPress: () => confirmDelete(entry) });
    }
    if (options.length === 0) return;
    options.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(entry.game.name, undefined, options);
  }

  function renderGame({ item }: { item: GameEntry }) {
    const isGM = item.role === 'gm';
    const phase = gamePhase(item.game);
    const eventDate = item.game.gameDate?.toDate?.();
    // GM entries always have actions (Clone is available in any phase); players only when finished.
    const hasActions = isGM || phase === 'results';
    return (
      <TouchableOpacity style={styles.gameCard} onPress={() => openGame(item)} activeOpacity={0.8}>
        <View style={[styles.roleTag, isGM ? styles.gmTag : styles.playerTag]}>
          <Text style={styles.roleText}>{isGM ? 'GM' : 'PLAYER'}</Text>
        </View>
        <View style={styles.gameInfo}>
          <Text style={styles.gameName}>{item.game.name}</Text>
          <Text style={styles.gameStatus}>
            {PHASE_TEXT[phase]}{eventDate ? ` · ${eventDate.toLocaleDateString()}` : ''}
          </Text>
        </View>
        {hasActions ? (
          <TouchableOpacity
            onPress={() => openActions(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.actionsBtn}
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : (
          <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
        )}
      </TouchableOpacity>
    );
  }

  // Newest-first by the GM's event date when set, else the system createdAt (#36).
  // In-memory sort — no Firestore index needed.
  const sortKey = (e: GameEntry) =>
    e.game.gameDate?.toMillis?.() ?? e.game.createdAt?.toMillis?.() ?? 0;
  const byDateDesc = (a: GameEntry, b: GameEntry) => sortKey(b) - sortKey(a);
  const activeGames = games.filter((g) => !g.archived).sort(byDateDesc);
  const archivedGames = games.filter((g) => g.archived).sort(byDateDesc);
  const visibleGames = showArchived ? archivedGames : activeGames;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>My Games</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => router.push('/(app)/profile')} style={styles.headerIconBtn}>
            <Ionicons name="person-circle-outline" size={26} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Alert.alert('Sign out?', '', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign Out', onPress: signOut, style: 'destructive' },
            ])}
            style={styles.headerIconBtn}
          >
            <Ionicons name="log-out-outline" size={24} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={visibleGames}
        keyExtractor={(item) => item.game.id}
        renderItem={renderGame}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); loadGames(); }}
        ListHeaderComponent={
          archivedGames.length > 0 ? (
            <View style={styles.segmentRow}>
              <TouchableOpacity
                style={[styles.segment, !showArchived && styles.segmentActive]}
                onPress={() => setShowArchived(false)}
              >
                <Text style={[styles.segmentText, !showArchived && styles.segmentTextActive]}>
                  Active ({activeGames.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segment, showArchived && styles.segmentActive]}
                onPress={() => setShowArchived(true)}
              >
                <Text style={[styles.segmentText, showArchived && styles.segmentTextActive]}>
                  Archived ({archivedGames.length})
                </Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>
                {error
                  || (showArchived
                    ? 'No archived games.'
                    : 'No games yet.\nJoin or create one below.')}
              </Text>
            </View>
          ) : null
        }
      />

      <View style={styles.footer}>
        <Button
          title="Join a Game"
          onPress={() => router.push('/(app)/join')}
          variant="secondary"
          style={{ marginBottom: 12 }}
        />
        <Button
          title="Create a Game (GM)"
          onPress={() => router.push('/(app)/gm/create')}
          variant="primary"
        />
      </View>

      <Modal
        visible={cloneTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!cloneBusy) setCloneTarget(null); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Clone Game</Text>
            <Text style={styles.modalHint}>
              Creates a new game with this game's boundary, checkpoints, runbook, and settings.
              Players and play history aren't copied. You'll be the GM with fresh codes.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={cloneName}
              onChangeText={setCloneName}
              placeholder="New game name"
              placeholderTextColor={Colors.textMuted}
              autoFocus
              editable={!cloneBusy}
            />
            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setCloneTarget(null)} variant="secondary" style={{ flex: 1 }} disabled={cloneBusy} />
              <View style={{ width: 12 }} />
              {cloneBusy ? (
                <View style={[styles.cloneBusy, { flex: 1 }]}><ActivityIndicator color={Colors.primary} /></View>
              ) : (
                <Button title="Clone" onPress={confirmClone} variant="primary" style={{ flex: 1 }} />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
  },
  list: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  gameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  roleTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 12,
  },
  gmTag: { backgroundColor: Colors.secondary + '33' },
  playerTag: { backgroundColor: Colors.primary + '33' },
  roleText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: 0.5,
  },
  gameInfo: { flex: 1 },
  gameName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  gameStatus: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  actionsBtn: { padding: 4 },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: Colors.surfaceElevated },
  segmentText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  segmentTextActive: { color: Colors.primary },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn: { padding: 4 },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    gap: 14,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  modalHint: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  modalInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: Colors.text,
  },
  modalActions: { flexDirection: 'row', alignItems: 'center' },
  cloneBusy: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
});
