import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { iconFor, colorFor, titleFor, isCritical } from '@/components/broadcastVisuals';
import { useBroadcasts } from '@/context/BroadcastsContext';
import type { Broadcast } from '@/types';

/** Non-critical alerts clear themselves after this long if the player doesn't tap. */
const AUTO_DISMISS_MS = 7000;
/** Cap on remembered-dismissed ids per game, so a long game's set can't grow unbounded. */
const MAX_ACKED = 500;

/**
 * Heads-up alert that surfaces **over the front of the app** the moment a broadcast lands
 * (hazard/boon hit, GM message, death, winner, player count) — so the crossing player
 * actually sees the hazard text instead of it quietly appending to the easily-missed
 * {@link BroadcastFeed} list (#17).
 *
 * Reads from the shared {@link BroadcastsProvider} subscription (#32). Dismissals are
 * **persisted per game** (AsyncStorage), so an event that arrived while the app was
 * backgrounded/closed (the player dismissed or ignored the OS push) still pops the modal
 * when they next open the app, and is only suppressed once they actually clear it in-app
 * (#70). The very first time a game is opened on this device, the existing backlog is
 * recorded as already-handled so prior history isn't replayed.
 */
export function AlertOverlay({ gameId }: { gameId: string }) {
  const { broadcasts, initialized } = useBroadcasts();
  const [queue, setQueue] = useState<Broadcast[]>([]);
  // Ids the player has dismissed in-app (persisted) — never pop these again.
  const acked = useRef<Set<string>>(new Set());
  // Ids accounted for this session (acked ∪ already-queued), so nothing pops twice.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const firstRun = useRef(false);
  const [ackedReady, setAckedReady] = useState(false);
  const storageKey = `acked_broadcasts_${gameId}`;

  function persistAcked() {
    // Keep only the most recent ids if the set gets large.
    let ids = [...acked.current];
    if (ids.length > MAX_ACKED) ids = ids.slice(ids.length - MAX_ACKED);
    AsyncStorage.setItem(storageKey, JSON.stringify(ids)).catch(() => {});
  }

  function ack(id: string) {
    acked.current.add(id);
    seen.current.add(id);
    persistAcked();
  }

  // Load the persisted dismissed set once per game.
  useEffect(() => {
    let cancelled = false;
    setAckedReady(false);
    primed.current = false;
    firstRun.current = false;
    acked.current = new Set();
    seen.current = new Set();
    setQueue([]);
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try { acked.current = new Set(JSON.parse(raw) as string[]); } catch { /* ignore */ }
        } else {
          firstRun.current = true; // never opened on this device → don't replay history
        }
        setAckedReady(true);
      })
      .catch(() => { if (!cancelled) { firstRun.current = true; setAckedReady(true); } });
    return () => { cancelled = true; };
  }, [storageKey]);

  useEffect(() => {
    if (!initialized || !ackedReady) return;
    if (!primed.current) {
      // Already-dismissed ids never pop.
      acked.current.forEach((id) => seen.current.add(id));
      if (firstRun.current) {
        // First open on this device: treat the existing backlog as already handled so prior
        // history isn't replayed, and remember it so later launches agree.
        broadcasts.forEach((b) => { seen.current.add(b.id); acked.current.add(b.id); });
        persistAcked();
      }
      primed.current = true;
      // Fall through: on a returning device, pop any backlog the player hasn't acked yet
      // (events that landed while the app was closed).
    }
    const fresh = broadcasts.filter((b) => !seen.current.has(b.id));
    if (fresh.length) {
      fresh.forEach((b) => seen.current.add(b.id));
      setQueue((q) => [...q, ...fresh]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcasts, initialized, ackedReady]);

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
    const id = current.id;
    const t = setTimeout(() => { ack(id); setQueue((q) => q.slice(1)); }, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!current) return null;

  const accent = colorFor(current);
  const dismiss = () => { ack(current.id); setQueue((q) => q.slice(1)); };

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
