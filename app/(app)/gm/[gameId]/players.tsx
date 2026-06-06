import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  FlatList, Alert, Modal, TextInput
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { updateMemberRole, removePlayer, eliminatePlayer, clearSos, setMemberDistrict } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import { stalenessLevel, stalenessColor, formatAgo } from '@/services/locationStatus';
import type { GameMember } from '@/types';

export default function PlayersScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { members, playerLocations, phase, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);

  // District editor — the GM assigns tribute pairings (ROADMAP #10). Players can't
  // set their own district (firestore.rules), so this lives only on the GM roster.
  const [districtEditor, setDistrictEditor] = useState<GameMember | null>(null);
  const [districtInput, setDistrictInput] = useState('');

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

  function openDistrictEditor(member: GameMember) {
    setDistrictInput(member.district != null ? String(member.district) : '');
    setDistrictEditor(member);
  }

  async function saveDistrict() {
    if (!gameId || !districtEditor) return;
    const target = districtEditor;
    setDistrictEditor(null);
    try {
      await setMemberDistrict(gameId, target.userId, districtInput);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  async function clearDistrict() {
    if (!gameId || !districtEditor) return;
    const target = districtEditor;
    setDistrictEditor(null);
    try {
      await setMemberDistrict(gameId, target.userId, null);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  /** A game must always keep ≥ 1 GM (#50). True when this member is the only GM. */
  function isLastGM(member: GameMember): boolean {
    return member.role === 'gm' && members.filter((m) => m.role === 'gm').length <= 1;
  }

  function handleRoleToggle(member: GameMember) {
    const newRole = member.role === 'player' ? 'gm' : 'player';
    // Block demoting the last GM — a game with no GM is unwatched and unwinnable (#50).
    if (newRole === 'player' && isLastGM(member)) {
      Alert.alert('Can’t demote the last GM', 'Promote another player to GM first — every game needs at least one Game Master.');
      return;
    }
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
    // Block removing the last GM — it would orphan the game (#50).
    if (isLastGM(member)) {
      Alert.alert('Can’t remove the last GM', 'Promote another player to GM first — every game needs at least one Game Master.');
      return;
    }
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
    const hasDistrict = item.district != null && String(item.district).trim() !== '';
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
          <View style={styles.nameRow}>
            <Text style={[styles.name, isOut ? styles.outName : null]}>{item.displayName}</Text>
            {!isGM && (
              <TouchableOpacity
                onPress={() => openDistrictEditor(item)}
                style={[styles.districtChip, hasDistrict ? styles.districtChipSet : null]}
              >
                <Text style={[styles.districtChipText, hasDistrict ? styles.districtChipTextSet : null]}>
                  {hasDistrict ? `District ${item.district}` : '+ District'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
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

        {/* Open the per-player detail screen (status + targeted message, #49). */}
        {!isGM && (
          <TouchableOpacity
            onPress={() => router.push(`/(app)/gm/${gameId}/player/${item.userId}`)}
            style={styles.iconBtn}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={22} color={Colors.secondary} />
          </TouchableOpacity>
        )}

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

  // Tributes sharing a district sit adjacent so the GM can see the pairing at a
  // glance; unassigned players ('~' sorts last). Numeric collation keeps "2" before "10".
  const districtKey = (m: GameMember) =>
    m.district != null && String(m.district).trim() !== '' ? String(m.district).trim() : '~';
  const gms = members.filter((m) => m.role === 'gm');
  const players = members
    .filter((m) => m.role === 'player')
    .sort((a, b) => {
      const ka = districtKey(a);
      const kb = districtKey(b);
      if (ka !== kb) return ka.localeCompare(kb, undefined, { numeric: true });
      return a.displayName.localeCompare(b.displayName);
    });
  const livingPlayers = players.filter((m) => !m.out).length;
  const districtCount = new Set(players.map(districtKey).filter((k) => k !== '~')).size;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Players</Text>
        <Text style={styles.count}>{players.length} player{players.length !== 1 ? 's' : ''}</Text>
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
                {players.length} player{players.length !== 1 ? 's' : ''} · {livingPlayers} alive{districtCount > 0 ? ` · ${districtCount} district${districtCount !== 1 ? 's' : ''}` : ''}
              </Text>
              <Text style={styles.legendGm}>
                Staff: {gms.length} GM{gms.length !== 1 ? 's' : ''}
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

      <Modal
        visible={districtEditor != null}
        transparent
        animationType="fade"
        onRequestClose={() => setDistrictEditor(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>District for {districtEditor?.displayName}</Text>
            <Text style={styles.modalHint}>
              Tributes who share a district are paired — a trap is withheld if both arrive at a
              site together.
            </Text>
            <TextInput
              style={styles.modalInput}
              value={districtInput}
              onChangeText={setDistrictInput}
              placeholder="e.g. 1"
              placeholderTextColor={Colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveDistrict}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={clearDistrict} style={styles.modalBtn}>
                <Text style={styles.modalBtnClear}>Clear</Text>
              </TouchableOpacity>
              <View style={styles.modalActionsRight}>
                <TouchableOpacity onPress={() => setDistrictEditor(null)} style={styles.modalBtn}>
                  <Text style={styles.modalBtnCancel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveDistrict} style={[styles.modalBtn, styles.modalBtnSave]}>
                  <Text style={styles.modalBtnSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
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
  count: { fontSize: 14, color: Colors.textSecondary },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  legend: { paddingVertical: 8, paddingHorizontal: 4, gap: 2 },
  legendText: { fontSize: 13, color: Colors.textSecondary },
  // GM count is kept on its own line, separate from the player counts (GM-only roster).
  legendGm: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
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
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 15, fontWeight: '700', color: Colors.text },
  districtChip: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  districtChipSet: {
    borderStyle: 'solid',
    borderColor: Colors.secondary,
    backgroundColor: Colors.secondary + '22',
  },
  districtChipText: { fontSize: 11, fontWeight: '700', color: Colors.textMuted },
  districtChipTextSet: { color: Colors.text },
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  modalHint: { fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },
  modalInput: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: Colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  modalActionsRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  modalBtnClear: { color: Colors.danger, fontWeight: '700', fontSize: 14 },
  modalBtnCancel: { color: Colors.textSecondary, fontWeight: '700', fontSize: 14 },
  modalBtnSave: { backgroundColor: Colors.primary },
  modalBtnSaveText: { color: Colors.background, fontWeight: '800', fontSize: 14 },
});
