import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections } from '@/services/firebase';
import { Colors } from '@/constants/colors';
import { iconFor, colorFor } from '@/components/broadcastVisuals';
import type { Broadcast } from '@/types';

/**
 * Player-facing feed of GM→player messages (Rule 24 player-count updates, checkpoint
 * events — hazards/boons/notifications, death/winner announcements). Self-subscribing so it can
 * drop into any player screen. Players see global messages (targetPlayerId == null)
 * plus ones targeted at them; Firestore can't OR those, so we run two listeners.
 */
export function BroadcastFeed({ gameId, max = 30 }: { gameId: string; max?: number }) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);

  useEffect(() => {
    if (!gameId) return;
    const col = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.BROADCASTS);
    const uid = auth().currentUser?.uid;
    const merged = new Map<string, Broadcast>();
    const emit = () =>
      setBroadcasts(
        [...merged.values()]
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
          .slice(0, max)
      );
    const handle = (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      snap.docChanges().forEach((c) => {
        if (c.type === 'removed') merged.delete(c.doc.id);
        else merged.set(c.doc.id, { id: c.doc.id, ...c.doc.data() } as Broadcast);
      });
      emit();
    };
    const unsubGlobal = col
      .where('targetPlayerId', '==', null)
      .onSnapshot(handle, (err) => console.error('[BroadcastFeed] global error', err));
    const unsubMine = uid
      ? col
          .where('targetPlayerId', '==', uid)
          .onSnapshot(handle, (err) => console.error('[BroadcastFeed] mine error', err))
      : () => {};
    return () => {
      unsubGlobal();
      unsubMine();
    };
  }, [gameId, max]);

  if (broadcasts.length === 0) {
    return (
      <View style={styles.empty}>
        <Ionicons name="radio-outline" size={18} color={Colors.textMuted} />
        <Text style={styles.emptyText}>No messages yet. The Game Master will reach you here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
      {broadcasts.map((b) => (
        <View key={b.id} style={[styles.item, b.targetPlayerId ? styles.targeted : null]}>
          <Ionicons name={iconFor(b)} size={16} color={colorFor(b)} style={{ marginTop: 1 }} />
          <Text style={styles.message}>{b.message}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 160, marginHorizontal: 16, marginBottom: 12 },
  listContent: { gap: 8 },
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
