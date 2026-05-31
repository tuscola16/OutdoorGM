import { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { findGameByCode, joinGame, updateFcmToken } from '@/services/gameService';
import { getFcmToken } from '@/services/notificationService';
import { friendlyError } from '@/services/errorUtils';

export default function JoinScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    setError('');
    if (code.trim().length < 6) {
      setError('Enter the 6-character game code');
      return;
    }
    if (!displayName.trim()) {
      setError('Enter your name');
      return;
    }
    if (!user) return;

    setLoading(true);
    try {
      const result = await findGameByCode(code);
      if (!result) {
        setError('No active game found with that code');
        return;
      }

      const fcmToken = await getFcmToken();
      await joinGame(
        result.game.id,
        user.uid,
        result.role,
        displayName.trim(),
        user.email ?? '',
        fcmToken ?? undefined
      );

      router.replace('/(app)/games');
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

      <View style={styles.container}>
        <Text style={styles.title}>Join a Game</Text>
        <Text style={styles.subtitle}>
          Get the game code from your Game Master and enter it below.
        </Text>

        <View style={styles.form}>
          <Input
            label="Game Code"
            value={code}
            onChangeText={(t) => { setCode(t.toUpperCase()); setError(''); }}
            placeholder="ABCDEF"
            maxLength={6}
            autoCapitalize="characters"
            autoFocus
          />
          <Input
            label="Your Name (shown to the GM)"
            value={displayName}
            onChangeText={(t) => { setDisplayName(t); setError(''); }}
            placeholder="e.g. Katniss"
            maxLength={32}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Join Game" onPress={handleJoin} loading={loading} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  back: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backText: { color: Colors.primary, fontSize: 16 },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 32, lineHeight: 22 },
  form: { gap: 16 },
  error: { color: Colors.danger, fontSize: 14, textAlign: 'center' },
});
