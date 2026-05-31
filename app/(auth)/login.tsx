import { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView,
  Platform, ScrollView, TouchableOpacity, Linking, Image
} from 'react-native';
import { useRouter } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/constants';
import { friendlyError } from '@/services/errorUtils';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const router = useRouter();

  async function handleSubmit() {
    setError('');
    setNotice('');
    if (!email.trim() || !password) {
      setError('Enter your email and password');
      return;
    }
    if (isSignUp && password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      if (isSignUp) {
        await auth().createUserWithEmailAndPassword(email.trim(), password);
      } else {
        await auth().signInWithEmailAndPassword(email.trim(), password);
      }
      router.replace('/(app)/games');
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email first, then tap "Forgot password?"');
      return;
    }
    try {
      await auth().sendPasswordResetEmail(email.trim());
      setError('');
      setNotice('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Image
            source={require('@/assets/adaptive-icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Outdoor GM</Text>
          <Text style={styles.subtitle}>Real-time location game</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>
            {isSignUp ? 'Create an account to get started' : 'Sign in to your account'}
          </Text>
          <Input
            label="Email"
            value={email}
            onChangeText={(t) => { setEmail(t); setError(''); setNotice(''); }}
            keyboardType="email-address"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoFocus
          />
          <Input
            label="Password"
            value={password}
            onChangeText={(t) => { setPassword(t); setError(''); }}
            placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
            secureTextEntry
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Button
            title={isSignUp ? 'Create Account' : 'Sign In'}
            onPress={handleSubmit}
            loading={loading}
          />
          {!isSignUp && (
            <TouchableOpacity onPress={handleForgotPassword} style={styles.forgot}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity onPress={() => { setIsSignUp(!isSignUp); setError(''); setNotice(''); }} style={styles.toggle}>
          <Text style={styles.toggleText}>
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </Text>
        </TouchableOpacity>

        <View style={styles.legalLinks}>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.privacyText}>Privacy Policy</Text>
          </TouchableOpacity>
          <Text style={styles.privacyText}> · </Text>
          <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
            <Text style={styles.privacyText}>Terms</Text>
          </TouchableOpacity>
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
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    letterSpacing: -0.5,
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
  error: {
    color: Colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  notice: {
    color: Colors.success,
    fontSize: 13,
    textAlign: 'center',
  },
  forgot: {
    alignItems: 'center',
  },
  forgotText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  toggle: {
    marginTop: 24,
    alignItems: 'center',
  },
  toggleText: {
    color: Colors.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  legalLinks: {
    marginTop: 32,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  privacyText: {
    color: Colors.textMuted,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
