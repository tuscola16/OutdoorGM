import React, { createContext, useContext, useEffect, useState } from 'react';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { UserProfile } from '@/types';

interface AuthContextValue {
  user: FirebaseAuthTypes.User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserProfile, 'displayName' | 'fcmToken'>>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = auth().onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Ensure user profile document exists
        const profileRef = firestore().collection(Collections.USERS).doc(firebaseUser.uid);
        const snap = await profileRef.get();
        if (!snap.exists) {
          const newProfile: Omit<UserProfile, 'id'> = {
            email: firebaseUser.email ?? '',
            displayName: '',
            createdAt: firestore.FieldValue.serverTimestamp() as any,
          };
          await profileRef.set(newProfile);
          setProfile({ id: firebaseUser.uid, ...newProfile } as UserProfile);
        } else {
          setProfile({ id: snap.id, ...snap.data() } as UserProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
    return unsubscribeAuth;
  }, []);

  async function signOut() {
    await auth().signOut();
  }

  async function updateProfile(updates: Partial<Pick<UserProfile, 'displayName' | 'fcmToken'>>) {
    if (!user) return;
    await firestore().collection(Collections.USERS).doc(user.uid).update(updates);
    setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
