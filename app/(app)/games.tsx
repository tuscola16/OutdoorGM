import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  SafeAreaView, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { getMyGames } from '@/services/gameService';
import type { Game } from '@/types';

interface GameEntry {
  game: Game;
  role: 'player' | 'gm';
}

export default function GamesScreen() {
  const { user, profile, signOut } = useAuth();
  const router = useRouter();
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadGames() {
    if (!user) return;
    try {
      const result = await getMyGames(user.uid);
      setGames(result);
    } catch (err) {
      console.error('loadGames error', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { loadGames(); }, [user]);

  function openGame(entry: GameEntry) {
    if (entry.role === 'gm') {
      router.push(`/(app)/gm/${entry.game.id}`);
    } else {
      router.push({ pathname: '/(app)/player/game', params: { gameId: entry.game.id } });
    }
  }

  function renderGame({ item }: { item: GameEntry }) {
    const isGM = item.role === 'gm';
    return (
      <TouchableOpacity style={styles.gameCard} onPress={() => openGame(item)} activeOpacity={0.8}>
        <View style={[styles.roleTag, isGM ? styles.gmTag : styles.playerTag]}>
          <Text style={styles.roleText}>{isGM ? 'GM' : 'PLAYER'}</Text>
        </View>
        <View style={styles.gameInfo}>
          <Text style={styles.gameName}>{item.game.name}</Text>
          <Text style={styles.gameStatus}>
            {item.game.status === 'active' ? '● Active' : '○ Ended'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
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
        data={games}
        keyExtractor={(item) => item.game.id}
        renderItem={renderGame}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={() => { setRefreshing(true); loadGames(); }}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No games yet.{'\n'}Join or create one below.</Text>
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
});
