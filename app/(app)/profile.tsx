import { useState } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { deleteAccount } from '@/services/gameService';
import { stopLocationTracking } from '@/services/locationTask';
import { friendlyError } from '@/services/errorUtils';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, profile, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account?',
      'This permanently deletes your account and removes you from all games. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await stopLocationTracking();
              await deleteAccount(user!.uid);
              // AuthContext listener handles redirect to /(auth)/phone
            } catch (err) {
              Alert.alert('Error', friendlyError(err));
              setDeleting(false);
            }
          },
        },
      ]
    );
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
          placeholder="e.g. Ranger"
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

        <View style={styles.divider} />

        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>DANGER ZONE</Text>
          <Button
            title="Delete My Account"
            onPress={handleDeleteAccount}
            variant="danger"
            loading={deleting}
          />
          <Text style={styles.dangerHint}>
            Permanently deletes your account and all associated data. You will be removed from every game.
          </Text>
        </View>
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
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 8,
  },
  dangerZone: { gap: 10 },
  dangerLabel: {
    fontSize: 11,
    color: Colors.danger,
    fontWeight: '700',
    letterSpacing: 1,
  },
  dangerHint: {
    fontSize: 12,
    color: Colors.textMuted,
    lineHeight: 18,
  },
});
