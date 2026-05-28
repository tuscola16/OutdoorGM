import { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, TextInput, TouchableOpacity, Alert
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';

export default function VerifyScreen() {
  const router = useRouter();
  const { phone, verificationId } = useLocalSearchParams<{ phone: string; verificationId: string }>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleVerify() {
    if (code.length !== 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const credential = auth.PhoneAuthProvider.credential(verificationId, code);
      await auth().signInWithCredential(credential);
      // Auth state listener in AuthContext will handle navigation
    } catch (err: any) {
      setError('Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    router.back();
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.container}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>Verification</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to{'\n'}
            <Text style={styles.phone}>{phone}</Text>
          </Text>
        </View>

        <View style={styles.codeContainer}>
          <TextInput
            style={styles.codeInput}
            value={code}
            onChangeText={(t) => {
              setCode(t.replace(/\D/g, '').slice(0, 6));
              setError('');
            }}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            placeholder="— — — — — —"
            placeholderTextColor={Colors.textMuted}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>

        <Button
          title="Verify Code"
          onPress={handleVerify}
          loading={loading}
          disabled={code.length !== 6}
        />

        <TouchableOpacity onPress={handleResend} style={styles.resend}>
          <Text style={styles.resendText}>Didn't get a code? Go back to resend</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  back: {
    marginBottom: 32,
  },
  backText: {
    color: Colors.primary,
    fontSize: 16,
  },
  header: {
    marginBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSecondary,
    lineHeight: 24,
  },
  phone: {
    color: Colors.text,
    fontWeight: '600',
  },
  codeContainer: {
    marginBottom: 24,
  },
  codeInput: {
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 18,
    fontSize: 28,
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: 16,
    marginBottom: 8,
  },
  error: {
    color: Colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  resend: {
    marginTop: 24,
    alignItems: 'center',
  },
  resendText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
});
