import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth } from '@/services/firebase';
import { friendlyError } from '@/services/errorUtils';

export function LoginScreen() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
      navigate('/games', { replace: true });
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    setNotice('');
    if (!email.trim()) {
      setError('Enter your email first, then click "Forgot password?"');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setError('');
      setNotice('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>
            Outdoor GM
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8 }}>
            Game Master dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
            {isSignUp ? 'Create an account to get started' : 'Sign in to your account'}
          </p>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              autoFocus
              onChange={(e) => { setEmail(e.target.value); setError(''); setNotice(''); }}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder={isSignUp ? 'At least 6 characters' : 'Your password'}
            />
          </div>
          {error && <div className="error-text" style={{ textAlign: 'center' }}>{error}</div>}
          {notice && <div className="notice-text" style={{ textAlign: 'center' }}>{notice}</div>}
          <button type="submit" className="btn btn--block" disabled={loading}>
            {loading ? 'Please wait…' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
          {!isSignUp && (
            <button
              type="button"
              onClick={handleForgotPassword}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 14 }}
            >
              Forgot password?
            </button>
          )}
        </form>

        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setError(''); setNotice(''); }}
          style={{
            display: 'block',
            margin: '20px auto 0',
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>
      </div>
    </div>
  );
}
