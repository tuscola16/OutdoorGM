import { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { createGame, joinGame } from '@/services/gameService';
import { getFcmToken } from '@/services/notificationService';
import { friendlyError } from '@/services/errorUtils';

export default function CreateGameScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [gameName, setGameName] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setError('');
    if (!gameName.trim()) { setError('Enter a game name'); return; }
    if (!displayName.trim()) { setError('Enter your GM name'); return; }
    if (!user) return;

    setLoading(true);
    try {
      const game = await createGame(gameName, user.uid);
      const fcmToken = await getFcmToken();
      await joinGame(game.id, user.uid, 'gm', displayName.trim(), user.email ?? '', fcmToken ?? undefined);
      router.replace(`/(app)/gm/${game.id}`);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Create Game</Text>
        <Text style={styles.subtitle}>
          You'll be the Game Master. Share the player code with your players and the GM code with co-GMs.
        </Text>
        <View style={styles.form}>
          <Input label="Game Name" value={gameName} onChangeText={setGameName} placeholder="e.g. Arena 2025" autoFocus />
          <Input label="Your GM Name" value={displayName} onChangeText={setDisplayName} placeholder="e.g. Gamemaker Snow" maxLength={32} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Create Game" onPress={handleCreate} loading={loading} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  back: { paddingHorizontal: 24, paddingTop: 16 },
  backText: { color: Colors.primary, fontSize: 16 },
  container: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 32, lineHeight: 22 },
  form: { gap: 16 },
  error: { color: Colors.danger, fontSize: 14, textAlign: 'center' },
});
