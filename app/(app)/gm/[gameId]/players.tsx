import { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { updateMemberRole, removePlayer, eliminatePlayer, clearSos } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import { stalenessLevel, stalenessColor, formatAgo } from '@/services/locationStatus';
import type { GameMember } from '@/types';

export default function PlayersScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { members, playerLocations, phase, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);

  // userId → last location fix (ms), for the stale-fix indicator. Outdoor GM is the
  // only tracker now, so a silent drop-off needs to be visible to the GM.
  const lastFixByUser = new Map<string, number>();
  for (const loc of playerLocations) {
    const ms = loc.updatedAt?.toMillis?.();
    if (ms) lastFixByUser.set(loc.userId, ms);
  }

  // Ensure the shared game subscription is active. We intentionally do NOT
  // clearGame() on unmount: the GM screen underneath stays mounted and relies on
  // the same singleton context, so clearing here would blank it out on return.
  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  function handleRoleToggle(member: GameMember) {
    const newRole = member.role === 'player' ? 'gm' : 'player';
    const label = newRole === 'gm' ? 'Promote to GM' : 'Demote to Player';
    Alert.alert(
      label,
      `${member.displayName} will ${newRole === 'gm' ? 'gain GM access and see all player locations.' : 'lose GM access.'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: label,
          onPress: async () => {
            if (!gameId) return;
            try {
              await updateMemberRole(gameId, member.userId, newRole);
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  function handleRemove(member: GameMember) {
    Alert.alert(
      `Remove ${member.displayName}?`,
      'They will be removed from the game and their location will no longer be tracked.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            if (!gameId) return;
            try {
              await removePlayer(gameId, member.userId);
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  function handleEliminate(member: GameMember) {
    Alert.alert(
      `Eliminate ${member.displayName}?`,
      'Marks this player as dead. Everyone is notified and, if they are the last one standing, the survivor is declared the winner.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Eliminate',
          style: 'destructive',
          onPress: async () => {
            if (!gameId) return;
            try {
              await eliminatePlayer(gameId, member.userId, 'gm-other');
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
            }
          },
        },
      ]
    );
  }

  async function handleClearSos(member: GameMember) {
    if (!gameId) return;
    try {
      await clearSos(gameId, member.userId);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  function renderMember({ item }: { item: GameMember }) {
    const isGM = item.role === 'gm';
    const isOut = !!item.out;
    // Stale-fix indicator: only meaningful for a living player during active play
    // (out players intentionally stop reporting; GMs aren't tracked).
    const showFix = !isGM && !isOut && phase === 'play';
    const fixMs = lastFixByUser.get(item.userId) ?? null;
    const level = showFix ? stalenessLevel(fixMs == null ? null : now - fixMs) : 'none';
    return (
      <View style={[styles.row, item.sos ? styles.sosRow : null]}>
        <View style={[styles.avatar, isGM ? styles.gmAvatar : styles.playerAvatar, isOut ? styles.outAvatar : null]}>
          <Text style={styles.avatarText}>
            {item.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.info}>
          <Text style={[styles.name, isOut ? styles.outName : null]}>{item.displayName}</Text>
          {item.sos ? (
            <Text style={styles.sosLabel}>🆘 Needs assistance — tap the alert icon to clear</Text>
          ) : showFix ? (
            <View style={styles.fixRow}>
              <View style={[styles.fixDot, { backgroundColor: stalenessColor(level) }]} />
              <Text style={[styles.fixText, level === 'stale' && styles.fixTextStale]}>
                {fixMs == null ? 'No signal yet' : `Last fix ${formatAgo(now - fixMs)}`}
              </Text>
            </View>
          ) : (
            <Text style={styles.email}>{item.email}</Text>
          )}
        </View>

        {isOut ? (
          <View style={[styles.badge, styles.deadBadge]}>
            <Text style={styles.badgeText}>DEAD</Text>
          </View>
        ) : (
          <View style={[styles.badge, isGM ? styles.gmBadge : styles.playerBadge]}>
            <Text style={styles.badgeText}>{isGM ? 'GM' : 'PLAYER'}</Text>
          </View>
        )}

        {item.sos && (
          <TouchableOpacity onPress={() => handleClearSos(item)} style={styles.iconBtn}>
            <Ionicons name="alert-circle" size={24} color={Colors.danger} />
          </TouchableOpacity>
        )}

        {/* Eliminate is only meaningful for a living player. */}
        {!isGM && !isOut && (
          <TouchableOpacity onPress={() => handleEliminate(item)} style={styles.iconBtn}>
            <Ionicons name="skull-outline" size={22} color={Colors.danger} />
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={() => handleRoleToggle(item)} style={styles.iconBtn}>
          <Ionicons
            name={isGM ? 'arrow-down-circle-outline' : 'arrow-up-circle-outline'}
            size={22}
            color={Colors.textSecondary}
          />
        </TouchableOpacity>

        <TouchableOpacity onPress={() => handleRemove(item)} style={styles.iconBtn}>
          <Ionicons name="person-remove-outline" size={22} color={Colors.danger} />
        </TouchableOpacity>
      </View>
    );
  }

  const players = members.filter((m) => m.role === 'player');
  const gms = members.filter((m) => m.role === 'gm');
  const livingPlayers = players.filter((m) => !m.out).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Players</Text>
        <Text style={styles.count}>{members.length} total</Text>
      </View>

      <FlatList
        data={[...gms, ...players]}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.list}
        renderItem={renderMember}
        ListHeaderComponent={
          members.length > 0 ? (
            <View style={styles.legend}>
              <Text style={styles.legendText}>
                {gms.length} GM{gms.length !== 1 ? 's' : ''} · {players.length} player{players.length !== 1 ? 's' : ''} · {livingPlayers} alive
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No members yet.{'\n'}Share the game code to invite players.</Text>
          </View>
        }
      />
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
  count: { fontSize: 14, color: Colors.textSecondary },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  legend: { paddingVertical: 8, paddingHorizontal: 4 },
  legendText: { fontSize: 13, color: Colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  sosRow: { borderColor: Colors.danger, backgroundColor: Colors.danger + '14' },
  outAvatar: { opacity: 0.5 },
  outName: { textDecorationLine: 'line-through', color: Colors.textSecondary },
  sosLabel: { fontSize: 12, color: Colors.danger, marginTop: 1, fontWeight: '600' },
  deadBadge: { backgroundColor: Colors.danger + '33' },
  fixRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  fixDot: { width: 8, height: 8, borderRadius: 4 },
  fixText: { fontSize: 12, color: Colors.textSecondary },
  fixTextStale: { color: Colors.danger, fontWeight: '600' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gmAvatar: { backgroundColor: Colors.secondary + '33' },
  playerAvatar: { backgroundColor: Colors.primary + '33' },
  avatarText: { fontSize: 16, fontWeight: '800', color: Colors.text },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.text },
  email: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  gmBadge: { backgroundColor: Colors.secondary + '33' },
  playerBadge: { backgroundColor: Colors.primary + '22' },
  badgeText: { fontSize: 10, fontWeight: '800', color: Colors.text, letterSpacing: 0.5 },
  iconBtn: { padding: 4 },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 12,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
