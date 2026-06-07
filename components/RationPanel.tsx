import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator, Keyboard, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import { submitRation, rationInterval } from '@/services/gameService';
import { uploadRationPhoto } from '@/services/storage';
import { enqueueRation, flushRationQueue } from '@/services/rationQueue';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import { formatDuration } from '@/hooks/useElapsed';
import { Button } from '@/components/ui/Button';
import { CameraCapture } from '@/components/CameraCapture';
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
  const [showCamera, setShowCamera] = useState(false);
  // The interval whose capture is sitting in the offline retry queue (#4) — drives the
  // "saved offline" interim state until the flush succeeds (status then becomes pending).
  const [offlineForInterval, setOfflineForInterval] = useState<number | null>(null);
  // On-screen diagnostics so a field tester can see what the camera + reminder
  // scheduling actually did, without needing a logcat. Surfaced as muted lines.
  const [camDebug, setCamDebug] = useState('');

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

  // Flush any ration captures queued while offline (#4): once on mount and whenever the
  // app returns to the foreground (the most likely moment signal has come back). A
  // successful flush writes the submission doc, so the listener above flips status to
  // 'pending' and the panel leaves its "saved offline" state on its own.
  useEffect(() => {
    flushRationQueue().catch(() => {});
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') flushRationQueue().catch(() => {});
    });
    return () => sub.remove();
  }, []);

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

  // Open the in-app camera (CameraCapture). Using our own camera view instead of
  // ImagePicker.launchCameraAsync avoids the external-activity result loss that left
  // the old flow stuck on "opening camera…".
  function openCamera() {
    if (busy || showCamera) return;
    if (requireCard && !cardNumber.trim()) {
      Alert.alert('Card number required', 'Enter the number printed on your ration card before submitting.');
      return;
    }
    Keyboard.dismiss();
    setCamDebug('opening camera…');
    setShowCamera(true);
  }

  // A photo came back from the in-app camera → upload + record the submission.
  async function onCaptured(uri: string) {
    setShowCamera(false);
    setBusy(true);
    setCamDebug('uploading…');
    const card = requireCard ? cardNumber.trim() : cardNumber.trim() || undefined;
    try {
      const url = await uploadRationPhoto(gameId, player.userId, intervalIndex!, uri);
      await submitRation(gameId, player, intervalIndex!, url, card);
      setCardNumber('');
      setOfflineForInterval(null);
      setCamDebug('submitted ✓');
    } catch (err) {
      // Offline / poor signal (#4): the Storage upload isn't SDK-queued, so persist the
      // capture durably and flush on reconnect/foreground — a dead zone shouldn't cost
      // the player a ration (= wrongful starvation).
      try {
        await enqueueRation({
          gameId,
          userId: player.userId,
          displayName: player.displayName,
          intervalIndex: intervalIndex!,
          localUri: uri,
          cardNumber: card,
          queuedAt: Date.now(),
        });
        setCardNumber('');
        setOfflineForInterval(intervalIndex!);
        setCamDebug('saved offline — will upload when you reconnect');
        Alert.alert(
          'Saved offline',
          "No signal right now — your ration photo is saved and uploads automatically when you're back online."
        );
      } catch (qerr) {
        setCamDebug(`error: ${err instanceof Error ? err.message : String(err)}`);
        Alert.alert('Could not submit', friendlyError(err));
      }
    } finally {
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
      ) : offlineForInterval === intervalIndex ? (
        <View style={styles.statusRow}>
          <Ionicons name="cloud-offline-outline" size={20} color={Colors.warning} />
          <Text style={styles.statusPending}>
            Saved offline — your ration photo uploads automatically when you reconnect.
          </Text>
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
            onPress={openCamera}
            loading={busy}
          />
          {camDebug ? <Text style={styles.debug}>camera: {camDebug}</Text> : null}
        </>
      )}
      <CameraCapture
        visible={showCamera}
        onClose={() => { setShowCamera(false); setCamDebug('camera closed'); }}
        onCapture={onCaptured}
      />
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
  debug: { color: Colors.textMuted, fontSize: 11, fontStyle: 'italic' },
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
