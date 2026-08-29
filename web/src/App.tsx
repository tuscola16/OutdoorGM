import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { LoginScreen } from '@/screens/LoginScreen';
import { GamesScreen } from '@/screens/GamesScreen';
import { GameScreen } from '@/screens/GameScreen';
import { RunbookScreen } from '@/screens/RunbookScreen';
import { DemoScreen } from '@/screens/DemoScreen';
import { PrivacyScreen, SupportScreen, TermsScreen } from '@/screens/LegalScreens';

function FullScreenMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      {text}
    </div>
  );
}

/** Gate authenticated routes; bounce to /login when signed out. */
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenMessage text="Loading…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

export function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          loading ? (
            <FullScreenMessage text="Loading…" />
          ) : user ? (
            <Navigate to="/games" replace />
          ) : (
            <LoginScreen />
          )
        }
      />
      <Route
        path="/games"
        element={
          <RequireAuth>
            <GamesScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/games/:gameId"
        element={
          <RequireAuth>
            <GameScreen />
          </RequireAuth>
        }
      />
      <Route
        path="/games/:gameId/runbook"
        element={
          <RequireAuth>
            <RunbookScreen />
          </RequireAuth>
        }
      />
      <Route path="/demo" element={<DemoScreen />} />
      {/* Required by App Store Connect and the Play Console; public, no auth. `/terms`
          also backs the sign-in screen's Terms link (constants/index.ts). These must stay
          above the `*` catch-all, which would otherwise bounce them to /games. */}
      <Route path="/privacy" element={<PrivacyScreen />} />
      <Route path="/terms" element={<TermsScreen />} />
      <Route path="/support" element={<SupportScreen />} />
      <Route path="/" element={<Navigate to="/games" replace />} />
      <Route path="*" element={<Navigate to="/games" replace />} />
    </Routes>
  );
}
