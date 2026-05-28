import { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSendCode() {
    setError('');
    const cleaned = phone.replace(/\s/g, '');
    if (!cleaned.startsWith('+') || cleaned.length < 8) {
      setError('Enter your number with country code, e.g. +1 555 123 4567');
      return;
    }
    setLoading(true);
    try {
      const confirmation = await auth().signInWithPhoneNumber(cleaned);
      router.push({ pathname: '/(auth)/verify', params: { phone: cleaned, verificationId: confirmation.verificationId } });
    } catch (err: any) {
      setError(err.message ?? 'Failed to send verification code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.flame}>🔥</Text>
          <Text style={styles.title}>HungerGames{'\n'}Locator</Text>
          <Text style={styles.subtitle}>Real-time location game</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>Enter your phone number to get started</Text>
          <Input
            label="Phone Number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+1 555 123 4567"
            error={error}
            autoFocus
          />
          <View style={styles.hint}>
            <Text style={styles.hintText}>We'll send a one-time verification code via SMS.</Text>
          </View>
          <Button title="Send Code" onPress={handleSendCode} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 56,
  },
  flame: {
    fontSize: 56,
    marginBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: -0.5,
    lineHeight: 40,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 8,
  },
  form: {
    gap: 16,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 4,
  },
  hint: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
  },
  hintText: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },
});
