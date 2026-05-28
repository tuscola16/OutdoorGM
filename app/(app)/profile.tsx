import { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (!displayName.trim()) {
      Alert.alert('Enter your name');
      return;
    }
    setLoading(true);
    try {
      await updateProfile({ displayName: displayName.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
        <Text style={styles.title}>Profile</Text>

        <View style={styles.phoneRow}>
          <Text style={styles.phoneLabel}>PHONE NUMBER</Text>
          <Text style={styles.phoneValue}>{user?.phoneNumber ?? '—'}</Text>
        </View>

        <Input
          label="Display Name"
          value={displayName}
          onChangeText={(t) => { setDisplayName(t); setSaved(false); }}
          placeholder="e.g. Katniss Everdeen"
          maxLength={32}
          autoFocus
        />
        <Text style={styles.hint}>
          This name is shown to Game Masters and other players when you join a game.
        </Text>

        <Button
          title={saved ? '✓ Saved' : 'Save Name'}
          onPress={handleSave}
          loading={loading}
          disabled={saved}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  back: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backText: { color: Colors.primary, fontSize: 16 },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  phoneRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  phoneLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  phoneValue: { fontSize: 18, fontWeight: '600', color: Colors.text },
  hint: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginTop: -8 },
});
