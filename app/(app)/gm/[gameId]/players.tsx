import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { updateMemberRole, removePlayer } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { GameMember } from '@/types';

export default function PlayersScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { members, loadGame, clearGame } = useGame();
  const router = useRouter();

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
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

  function renderMember({ item }: { item: GameMember }) {
    const isGM = item.role === 'gm';
    return (
      <View style={styles.row}>
        <View style={[styles.avatar, isGM ? styles.gmAvatar : styles.playerAvatar]}>
          <Text style={styles.avatarText}>
            {item.displayName.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View style={styles.info}>
          <Text style={styles.name}>{item.displayName}</Text>
          <Text style={styles.email}>{item.email}</Text>
        </View>

        <View style={[styles.badge, isGM ? styles.gmBadge : styles.playerBadge]}>
          <Text style={styles.badgeText}>{isGM ? 'GM' : 'PLAYER'}</Text>
        </View>

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
                {gms.length} GM{gms.length !== 1 ? 's' : ''} · {players.length} player{players.length !== 1 ? 's' : ''}
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
