import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections } from '@/services/firebase';
import { Colors } from '@/constants/colors';
import { iconFor, colorFor, titleFor, isCritical } from '@/components/broadcastVisuals';
import type { Broadcast } from '@/types';

/** Non-critical alerts clear themselves after this long if the player doesn't tap. */
const AUTO_DISMISS_MS = 7000;

/**
 * Heads-up alert that surfaces **over the front of the app** the moment a new
 * broadcast lands (hazard/boon hit, GM message, death, winner, player count) —
 * so the crossing player actually sees the hazard text instead of it quietly
 * appending to the easily-missed {@link BroadcastFeed} list (#17).
 *
 * Self-subscribing (same global + targeted query as the feed). Only *newly
 * arrived* broadcasts pop — the backlog present when the screen mounts is marked
 * seen and ignored, so re-entering a game doesn't replay old alerts.
 */
export function AlertOverlay({ gameId }: { gameId: string }) {
  const [queue, setQueue] = useState<Broadcast[]>([]);
  // Every broadcast id we've already accounted for (initial backlog + ones we've
  // queued), so a doc never pops twice across the two listeners / re-renders.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!gameId) return;
    seen.current = new Set();
    setQueue([]);

    const col = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.BROADCASTS);
    const uid = auth().currentUser?.uid;

    // Each listener's first snapshot is the existing backlog — record those ids as
    // seen without popping. Only docs added afterwards surface as heads-up alerts.
    const makeHandler = () => {
      let primed = false;
      return (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
        if (!primed) {
          snap.docs.forEach((d) => seen.current.add(d.id));
          primed = true;
          return;
        }
        const fresh: Broadcast[] = [];
        snap.docChanges().forEach((c) => {
          if (c.type !== 'added' || seen.current.has(c.doc.id)) return;
          seen.current.add(c.doc.id);
          fresh.push({ id: c.doc.id, ...c.doc.data() } as Broadcast);
        });
        if (fresh.length) setQueue((q) => [...q, ...fresh]);
      };
    };

    const unsubGlobal = col
      .where('targetPlayerId', '==', null)
      .onSnapshot(makeHandler(), (err) => console.error('[AlertOverlay] global error', err));
    const unsubMine = uid
      ? col
          .where('targetPlayerId', '==', uid)
          .onSnapshot(makeHandler(), (err) => console.error('[AlertOverlay] mine error', err))
      : () => {};
    return () => {
      unsubGlobal();
      unsubMine();
    };
  }, [gameId]);

  const current = queue[0] ?? null;

  // Buzz on show, and auto-dismiss non-critical alerts after a beat.
  useEffect(() => {
    if (!current) return;
    Haptics.notificationAsync(
      isCritical(current)
        ? Haptics.NotificationFeedbackType.Error
        : Haptics.NotificationFeedbackType.Warning
    ).catch(() => {});
    if (isCritical(current)) return; // critical alerts must be tapped to clear
    const t = setTimeout(() => setQueue((q) => q.slice(1)), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [current]);

  if (!current) return null;

  const accent = colorFor(current);
  const dismiss = () => setQueue((q) => q.slice(1));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={isCritical(current) ? undefined : dismiss}>
        <View style={[styles.card, { borderColor: accent }]}>
          <View style={[styles.iconWrap, { backgroundColor: accent + '22', borderColor: accent }]}>
            <Ionicons name={iconFor(current)} size={40} color={accent} />
          </View>
          <Text style={[styles.title, { color: accent }]}>{titleFor(current)}</Text>
          <Text style={styles.message}>{current.message}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: accent }]} onPress={dismiss}>
            <Text style={styles.btnText}>{queue.length > 1 ? `Next (${queue.length - 1} more)` : 'Got it'}</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    alignSelf: 'stretch',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 2,
    paddingVertical: 28,
    paddingHorizontal: 24,
    gap: 14,
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '800', textAlign: 'center' },
  message: { fontSize: 17, color: Colors.text, textAlign: 'center', lineHeight: 24 },
  btn: {
    marginTop: 8,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
  },
  btnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '800' },
});
