import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import { submitRation, rationInterval } from '@/services/gameService';
import { uploadRationPhoto } from '@/services/storage';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import { formatDuration } from '@/hooks/useElapsed';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import type { GameConfig, RationStatus } from '@/types';

type Ts = FirebaseFirestoreTypes.Timestamp | null;

/**
 * Player-facing ration-card capture (Rules 6–9). The eat-window is only **open** for
 * the last `rationWindowMinutes` of each interval (#21) — before that the panel shows a
 * muted "opens in …" countdown rather than nagging for a card, and the player gets a
 * scheduled local notification the moment the window opens (fires even backgrounded /
 * locked). When open, the player photographs their numbered card live (anti-cheat: no
 * library picks); it uploads to Storage and is recorded via submitRation() for GM review.
 */
export function RationPanel({
  gameId,
  player,
  startedAt,
  config,
}: {
  gameId: string;
  player: { userId: string; displayName: string };
  startedAt: Ts;
  config: GameConfig;
}) {
  const now = useNow(1000);
  const interval = useMemo(
    () => rationInterval({ startedAt, config } as any, now),
    [startedAt, config, now]
  );

  const [cardNumber, setCardNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<RationStatus | null>(null);
  // Synchronous re-entry guard: the camera permission prompt + launch are async, and
  // without this a second tap before the camera opens fires a *concurrent*
  // launchCameraAsync, which wedges the picker so it never opens (the field-test bug).
  const launchingRef = useRef(false);

  const intervalIndex = interval?.index ?? null;

  // Watch this player's submission for the current window. The doc id is
  // deterministic (`${uid}_${intervalIndex}`), so it resets as the window rolls.
  useEffect(() => {
    if (!gameId || intervalIndex == null) {
      setStatus(null);
      return;
    }
    setStatus(null);
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.RATIONS)
      .doc(`${player.userId}_${intervalIndex}`)
      .onSnapshot(
        (snap) => setStatus((snap.data()?.status as RationStatus) ?? null),
        (err) => console.error('[RationPanel] submission listener error', err)
      );
  }, [gameId, player.userId, intervalIndex]);

  // Alert the player the moment each future eat-window opens — scheduled as local
  // notifications so they fire even when the app is backgrounded or the phone is locked.
  // Deterministic ids (`ration-<game>-<i>`) so a remount/relaunch replaces rather than
  // duplicates; we cancel them when the panel unmounts (player out / game over / leave).
  const startedMs = startedAt?.toMillis?.() ?? null;
  useEffect(() => {
    if (!gameId || !startedMs || !config.rationsEnabled) return;
    let cancelled = false;
    const scheduled: string[] = [];
    (async () => {
      const windowMs = config.rationIntervalMinutes * 60_000;
      const total = Math.ceil(config.durationMinutes / config.rationIntervalMinutes);
      const openMs =
        Math.min(Math.max(config.rationWindowMinutes, 0), config.rationIntervalMinutes) * 60_000;
      const nowMs = Date.now();
      for (let i = 0; i < total; i++) {
        const opensAt = startedMs + (i + 1) * windowMs - openMs;
        if (opensAt <= nowMs + 1000) continue; // already open or past — skip
        try {
          const id = await Notifications.scheduleNotificationAsync({
            identifier: `ration-${gameId}-${i}`,
            content: {
              title: '🍖 Ration window open',
              body: 'Photograph your ration card before the window closes — or you starve.',
              sound: true,
            },
            trigger: { date: new Date(opensAt), channelId: 'broadcasts' },
          });
          if (cancelled) {
            Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
            return;
          }
          scheduled.push(id);
        } catch {
          /* best effort — a failed schedule shouldn't break the panel */
        }
      }
    })();
    return () => {
      cancelled = true;
      scheduled.forEach((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}));
    };
  }, [
    gameId,
    startedMs,
    config.rationsEnabled,
    config.rationIntervalMinutes,
    config.rationWindowMinutes,
    config.durationMinutes,
  ]);

  if (!interval || !interval.isPlaying || intervalIndex == null) return null;

  const requireCard = config.enforceUniqueRationCards;

  // Before the eat-window opens: a muted, non-actionable heads-up so the player knows
  // a ration check is coming — not the capture UI (the panel isn't "open at all times").
  if (!interval.isOpen) {
    const opensInSecs = Math.max(0, Math.floor((interval.windowStartsAt - now) / 1000));
    return (
      <View style={[styles.card, styles.cardClosed]}>
        <View style={styles.headerRow}>
          <Ionicons name="restaurant-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.titleMuted}>Ration check</Text>
          <View style={{ flex: 1 }} />
          <Text style={styles.countdown}>opens in {formatDuration(opensInSecs)}</Text>
        </View>
        <Text style={styles.hint}>
          No card needed yet. When the window opens you'll be alerted to photograph your ration card.
        </Text>
      </View>
    );
  }

  const remainingSecs = Math.max(0, Math.floor((interval.windowEndsAt - now) / 1000));

  async function handleSubmit() {
    if (launchingRef.current || busy) return; // already capturing/uploading
    if (requireCard && !cardNumber.trim()) {
      Alert.alert('Card number required', 'Enter the number printed on your ration card before submitting.');
      return;
    }
    launchingRef.current = true;
    try {
      // Resolve permission deterministically before launching: check current state,
      // ask only if we still can, and route to Settings if it's been hard-denied —
      // rather than re-prompting on every tap.
      let perm = await ImagePicker.getCameraPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) {
        perm = await ImagePicker.requestCameraPermissionsAsync();
      }
      if (!perm.granted) {
        Alert.alert(
          'Camera access needed',
          perm.canAskAgain
            ? 'Outdoor GM needs the camera to photograph your ration card.'
            : 'Camera access is blocked. Enable it in Settings to photograph your ration card.',
          perm.canAskAgain
            ? [{ text: 'OK' }]
            : [{ text: 'Cancel', style: 'cancel' }, { text: 'Open Settings', onPress: () => Linking.openSettings() }]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets?.[0]?.uri) return;

      setBusy(true);
      const url = await uploadRationPhoto(gameId, player.userId, intervalIndex!, result.assets[0].uri);
      await submitRation(
        gameId,
        player,
        intervalIndex!,
        url,
        requireCard ? cardNumber.trim() : cardNumber.trim() || undefined
      );
      setCardNumber('');
    } catch (err) {
      Alert.alert('Could not submit', friendlyError(err));
    } finally {
      launchingRef.current = false;
      setBusy(false);
    }
  }

  const submitted = status === 'pending' || status === 'valid';
  const danger = remainingSecs <= 5 * 60 && !submitted;

  return (
    <View style={[styles.card, danger && styles.cardDanger]}>
      <View style={styles.headerRow}>
        <Ionicons name="restaurant" size={18} color={Colors.primary} />
        <Text style={styles.title}>Ration check</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.countdown, danger && styles.countdownDanger]}>
          {submitted ? 'next window' : `eat within ${formatDuration(remainingSecs)}`}
        </Text>
      </View>

      {status === 'valid' ? (
        <View style={styles.statusRow}>
          <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
          <Text style={styles.statusValid}>Ration accepted — you're fed this window.</Text>
        </View>
      ) : status === 'pending' ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.statusPending}>Sent — waiting for your Game Master to verify.</Text>
        </View>
      ) : (
        <>
          {status === 'rejected' && (
            <Text style={styles.rejected}>
              Your last card was rejected. Photograph a valid card before the window closes.
            </Text>
          )}
          <Text style={styles.hint}>
            Photograph your numbered ration card to prove you ate. Miss the window and you starve.
          </Text>
          <TextInput
            style={styles.input}
            value={cardNumber}
            onChangeText={setCardNumber}
            placeholder={requireCard ? 'Ration card number (required)' : 'Ration card number (optional)'}
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            editable={!busy}
          />
          <Button
            title={busy ? 'Submitting…' : 'Take ration photo'}
            onPress={handleSubmit}
            loading={busy}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  cardDanger: { borderColor: Colors.danger },
  cardClosed: { opacity: 0.85 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
  titleMuted: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  countdown: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  countdownDanger: { color: Colors.danger },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusValid: { color: Colors.success, fontSize: 14, fontWeight: '600', flex: 1 },
  statusPending: { color: Colors.textSecondary, fontSize: 14, flex: 1 },
  rejected: { color: Colors.danger, fontSize: 13, fontWeight: '600' },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 16,
    padding: 12,
  },
});
