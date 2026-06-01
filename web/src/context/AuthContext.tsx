import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, Collections } from '@/services/firebase';
import type { UserProfile } from '@shared/types';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<UserProfile, 'displayName'>>) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      try {
        if (firebaseUser) {
          // Ensure the user profile document exists (mirrors mobile AuthContext).
          const profileRef = doc(db, Collections.USERS, firebaseUser.uid);
          const snap = await getDoc(profileRef);
          if (!snap.exists()) {
            const newProfile = {
              email: firebaseUser.email ?? '',
              displayName: '',
              createdAt: serverTimestamp(),
            };
            await setDoc(profileRef, newProfile);
            setProfile({ id: firebaseUser.uid, ...newProfile } as unknown as UserProfile);
          } else {
            setProfile({ id: snap.id, ...snap.data() } as UserProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        // Don't block the app on a profile read failure — fall back to a minimal
        // profile so authenticated screens stay usable.
        console.error('Auth profile load failed', err);
        if (firebaseUser) {
          setProfile({
            id: firebaseUser.uid,
            email: firebaseUser.email ?? '',
            displayName: '',
          } as UserProfile);
        } else {
          setProfile(null);
        }
      } finally {
        setLoading(false);
      }
    });
  }, []);

  async function signOut() {
    await fbSignOut(auth);
  }

  async function updateProfile(updates: Partial<Pick<UserProfile, 'displayName'>>) {
    if (!user) return;
    await updateDoc(doc(db, Collections.USERS, user.uid), updates);
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
