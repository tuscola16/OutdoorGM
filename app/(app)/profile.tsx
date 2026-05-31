import { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

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
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDeleteAccount() {
    setDeletePassword('');
    setDeleteError('');
    setShowDeleteModal(true);
  }

  async function confirmDelete() {
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm.');
      return;
    }
    setDeleting(true);
    setDeleteError('');
    try {
      await stopLocationTracking();
      await deleteAccount(user!.uid, deletePassword);
      // AuthContext listener handles redirect to /(auth)/login
    } catch (err) {
      setDeleteError(friendlyError(err));
      setDeleting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <View style={styles.container}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.emailRow}>
          <Text style={styles.emailLabel}>EMAIL</Text>
          <Text style={styles.emailValue}>{user?.email ?? '—'}</Text>
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

      {/* Delete confirmation — requires password to re-authenticate */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="slide"
        onRequestClose={() => !deleting && setShowDeleteModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Delete Account</Text>
            <Text style={styles.modalSub}>
              This permanently deletes your account and removes you from all games. It cannot be undone.
              Enter your password to confirm.
            </Text>
            <Input
              label="Password"
              value={deletePassword}
              onChangeText={(t) => { setDeletePassword(t); setDeleteError(''); }}
              placeholder="Your password"
              secureTextEntry
              autoFocus
            />
            {deleteError ? <Text style={styles.modalError}>{deleteError}</Text> : null}
            <View style={styles.modalActions}>
              <Button
                title="Cancel"
                onPress={() => setShowDeleteModal(false)}
                variant="ghost"
                disabled={deleting}
                fullWidth={false}
                style={{ flex: 1 }}
              />
              <Button
                title="Delete"
                onPress={confirmDelete}
                variant="danger"
                loading={deleting}
                fullWidth={false}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  back: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backText: { color: Colors.primary, fontSize: 16 },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 16, gap: 16 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  emailRow: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emailLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  emailValue: { fontSize: 16, fontWeight: '600', color: Colors.text },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text },
  modalSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  modalError: { color: Colors.danger, fontSize: 13 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
