import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import auth from '@react-native-firebase/auth';
import { Colors } from '@/constants/colors';
import { iconFor, colorFor } from '@/components/broadcastVisuals';
import { useBroadcasts } from '@/context/BroadcastsContext';
import { dismissBroadcast } from '@/services/gameService';

/**
 * Player-facing feed of GM→player messages (Rule 24 player-count updates, checkpoint
 * events — hazards/boons/notifications, death/winner announcements). Reads from the shared
 * {@link BroadcastsProvider} subscription (#32) rather than opening its own listeners, so
 * the player screen holds a single broadcast subscription no matter how many feeds render.
 *
 * Each row carries an ✕ to dismiss it from this player's list (#71). Dismissal writes the
 * player's uid to the broadcast's `dismissedBy`, so it stays gone on reopen and across the
 * player's devices; other players are unaffected.
 */
export function BroadcastFeed({
  gameId,
  max = 30,
  scroll = true,
}: {
  /** The current game — needed to write a dismissal (#71). */
  gameId: string;
  max?: number;
  /** When false, render the items inline (no internal ScrollView) so the feed can
   * live inside a parent ScrollView without nesting two vertical scrollers. */
  scroll?: boolean;
}) {
  const uid = auth().currentUser?.uid;
  // Hide broadcasts this player already dismissed (#71), then cap. The provider keeps
  // them sorted newest-first.
  const broadcasts = useBroadcasts()
    .broadcasts.filter((b) => !(uid && b.dismissedBy?.includes(uid)))
    .slice(0, max);

  if (broadcasts.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="radio-outline" size={18} color={Colors.textMuted} />
        <Text style={styles.emptyText}>No messages yet. The Game Master will reach you here.</Text>
      </View>
    );
  }

  const items = broadcasts.map((b) => (
    <View key={b.id} style={[styles.item, b.targetPlayerId ? styles.targeted : null]}>
      <Ionicons name={iconFor(b)} size={16} color={colorFor(b)} style={{ marginTop: 1 }} />
      <Text style={styles.message}>{b.message}</Text>
      <TouchableOpacity
        onPress={() => dismissBroadcast(gameId, b.id).catch(() => {})}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={styles.dismiss}
        accessibilityLabel="Dismiss message"
      >
        <Ionicons name="close" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  ));

  // Inline (no own scroll) when embedded in a parent ScrollView.
  if (!scroll) return <View style={styles.inlineList}>{items}</View>;

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {items}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 160, marginHorizontal: 16, marginBottom: 12 },
  listContent: { gap: 8 },
  inlineList: { marginHorizontal: 16, marginBottom: 12, gap: 8 },
  item: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  targeted: { borderColor: Colors.primary },
  message: { flex: 1, color: Colors.text, fontSize: 14, lineHeight: 20 },
  dismiss: { marginTop: -2, marginRight: -2, padding: 2 },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
  },
  emptyText: { flex: 1, color: Colors.textMuted, fontSize: 13 },
});
