import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { sendBroadcast, eliminatePlayer, clearSos, ackSos } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import { stalenessLevel, stalenessColor, formatAgo } from '@/services/locationStatus';

const CAUSE_LABEL: Record<string, string> = {
  self: 'self-reported', starvation: 'starvation', 'bad-sport': 'bad sport',
  'stole-drop': 'stole a drop', comms: 'comms violation', 'cold-tapout': 'cold tap-out',
  'gm-other': 'GM elimination',
};

/**
 * GM per-player detail screen (#49). The home for player-specific actions; the first
 * is targeted GM→player messaging (a `gm-message` broadcast scoped to this player via
 * `targetPlayerId`, which the player feed already filters on). Keeps the whole game in
 * the app instead of bouncing to a separate messaging app.
 */
export default function PlayerDetailScreen() {
  const { gameId, playerId } = useLocalSearchParams<{ gameId: string; playerId: string }>();
  const { members, playerLocations, phase, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const member = members.find((m) => m.userId === playerId);
  const loc = playerLocations.find((l) => l.userId === playerId);
  const fixMs = loc?.updatedAt?.toMillis?.() ?? null;
  const level = !member?.out && phase === 'play' ? stalenessLevel(fixMs == null ? null : now - fixMs) : 'none';

  async function handleSend() {
    const text = message.trim();
    if (!text || !gameId || !playerId) return;
    setSending(true);
    try {
      await sendBroadcast(gameId, text, playerId);
      setMessage('');
      Alert.alert('Sent', `Your message was sent to ${member?.displayName ?? 'this player'}.`);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSending(false);
    }
  }

  function handleEliminate() {
    if (!member || !gameId) return;
    Alert.alert(
      `Eliminate ${member.displayName}?`,
      'Marks this player as dead. Everyone is notified and, if they are the last one standing, the survivor wins.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Eliminate', style: 'destructive', onPress: () => eliminatePlayer(gameId, member.userId, 'gm-other').catch((e) => Alert.alert('Error', friendlyError(e))) },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{member?.displayName ?? 'Player'}</Text>
        <View style={{ width: 24 }} />
      </View>

      {!member ? (
        <View style={styles.empty}>
          <Ionicons name="person-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>This player is no longer in the game.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* Status card */}
          <View style={styles.card}>
            <View style={styles.statusRow}>
              <Text style={styles.statusLabel}>Status</Text>
              <Text style={[styles.statusValue, member.out && styles.dead]}>
                {member.out ? `Out — ${CAUSE_LABEL[member.cause ?? 'gm-other'] ?? member.cause ?? 'eliminated'}` : 'Alive'}
              </Text>
            </View>
            {member.district != null && String(member.district).trim() !== '' && (
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>District</Text>
                <Text style={styles.statusValue}>{String(member.district)}</Text>
              </View>
            )}
            {!member.out && phase === 'play' && (
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Last fix</Text>
                <View style={styles.fixRow}>
                  <View style={[styles.fixDot, { backgroundColor: stalenessColor(level) }]} />
                  <Text style={[styles.statusValue, level === 'stale' && styles.dead]}>
                    {fixMs == null ? 'No signal yet' : formatAgo(now - fixMs)}
                  </Text>
                </View>
              </View>
            )}
            {member.sos && (
              <View style={styles.sosBanner}>
                <Ionicons name="alert-circle" size={18} color={member.sosAckAt ? Colors.warning : Colors.danger} />
                <Text style={[styles.sosText, member.sosAckAt ? styles.sosAckedText : null]}>
                  {member.sosAckAt ? 'Acknowledged' : 'Needs assistance'}
                </Text>
                {!member.sosAckAt && (
                  <TouchableOpacity onPress={() => ackSos(gameId!, member.userId).catch(() => {})}>
                    <Text style={styles.ackSos}>Acknowledge</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => clearSos(gameId!, member.userId).catch(() => {})}>
                  <Text style={styles.clearSos}>Clear</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Targeted message composer (#49) */}
          <Text style={styles.sectionLabel}>Message this player</Text>
          <Text style={styles.hint}>
            A private one-way message only {member.displayName} sees — it lands in their alerts
            over the app. They can't reply (Rule 23).
          </Text>
          <Input
            value={message}
            onChangeText={setMessage}
            placeholder="e.g. Head to the north ridge — a sponsor drop is waiting."
            multiline
            style={styles.messageInput}
          />
          <Button title="Send to player" onPress={handleSend} loading={sending} />

          {!member.out && (
            <TouchableOpacity onPress={handleEliminate} style={styles.eliminateRow}>
              <Ionicons name="skull-outline" size={18} color={Colors.danger} />
              <Text style={styles.eliminateText}>Eliminate {member.displayName}</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  body: { padding: 16, gap: 12 },
  card: { backgroundColor: Colors.surface, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  statusValue: { fontSize: 14, color: Colors.text, fontWeight: '700' },
  dead: { color: Colors.danger },
  fixRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fixDot: { width: 8, height: 8, borderRadius: 4 },
  sosBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, paddingTop: 10,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  sosText: { flex: 1, color: Colors.danger, fontWeight: '700', fontSize: 14 },
  sosAckedText: { color: Colors.warning },
  ackSos: { color: Colors.warning, fontWeight: '700', fontSize: 13, marginRight: 14 },
  clearSos: { color: Colors.textSecondary, fontWeight: '700', fontSize: 13 },
  sectionLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  hint: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  messageInput: { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' },
  eliminateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 12 },
  eliminateText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },
});
