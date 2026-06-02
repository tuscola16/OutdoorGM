import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
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
 * Player-facing ration-card capture for the current eat window (Rules 6–9). Shows
 * a countdown to the window's close, the submission status, and — when nothing
 * valid is in for this window — a "photograph your card" flow. The photo is taken
 * live with the camera (anti-cheat: no library picks), uploaded to Storage, then
 * recorded via submitRation(). The GM reviews and marks it valid/rejected.
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

  if (!interval || !interval.isPlaying || intervalIndex == null) return null;

  const remainingSecs = Math.max(0, Math.floor((interval.windowEndsAt - now) / 1000));
  const requireCard = config.enforceUniqueRationCards;

  async function handleSubmit() {
    if (requireCard && !cardNumber.trim()) {
      Alert.alert('Card number required', 'Enter the number printed on your ration card before submitting.');
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Camera needed',
          'Outdoor GM needs camera access to photograph your ration card. Enable it in Settings.'
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
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.text },
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
