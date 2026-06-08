import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  getMyGames,
  gamePhase,
  createGame,
  cloneGame,
  joinGameByCode,
  deleteGame,
  setGameArchived,
  type MyGameEntry,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { Modal } from '@/components/Modal';

const PHASE_TEXT: Record<string, string> = {
  setup: '● Setting up',
  lobby: '● Lobby open',
  play: '● In play',
  results: '○ Finished',
};

type GameEntry = MyGameEntry;

export function GamesScreen() {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<GameEntry | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    if (!user) return;
    try {
      const result = await getMyGames(user.uid);
      setGames(result);
      setError('');
    } catch (err) {
      console.error('loadGames error', err);
      setError("Couldn't load your games. Try refreshing.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadGames(); }, [loadGames]);

  function openGame(entry: GameEntry) {
    if (entry.role !== 'gm') return; // web dashboard is GM-only
    navigate(`/games/${entry.game.id}`);
  }

  async function toggleArchive(entry: GameEntry) {
    if (!user) return;
    const next = !entry.archived;
    setBusyId(entry.game.id);
    setGames((prev) =>
      prev.map((g) => (g.game.id === entry.game.id ? { ...g, archived: next } : g))
    );
    try {
      await setGameArchived(entry.game.id, user.uid, next);
    } catch (err) {
      setGames((prev) =>
        prev.map((g) => (g.game.id === entry.game.id ? { ...g, archived: !next } : g))
      );
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(entry: GameEntry) {
    if (
      !window.confirm(
        `Delete "${entry.game.name}"? This permanently removes the game, its checkpoints, and all members. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(entry.game.id);
    try {
      await deleteGame(entry.game.id);
      setGames((prev) => prev.filter((g) => g.game.id !== entry.game.id));
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  }

  // Newest-first by the GM's event date when set, else createdAt (#36). In-memory.
  const sortKey = (e: GameEntry) =>
    e.game.gameDate?.toMillis?.() ?? e.game.createdAt?.toMillis?.() ?? 0;
  const byDateDesc = (a: GameEntry, b: GameEntry) => sortKey(b) - sortKey(a);
  const gmGames = games.filter((g) => g.role === 'gm');
  const activeGames = gmGames.filter((g) => !g.archived).sort(byDateDesc);
  const archivedGames = gmGames.filter((g) => g.archived).sort(byDateDesc);
  const visibleGames = showArchived ? archivedGames : activeGames;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 24px 48px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>My Games</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)' }}>
          {profile?.email && <span style={{ fontSize: 13 }}>{profile.email}</span>}
          <button className="btn btn--ghost" onClick={signOut} style={{ padding: '8px 14px' }}>
            Sign out
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 12, margin: '20px 0' }}>
        <button className="btn" onClick={() => setShowCreate(true)}>Create a Game</button>
        <button className="btn btn--secondary" onClick={() => setShowJoin(true)}>
          Join with GM code
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)' }}>Loading…</p>
      ) : (
        <>
          {error && <p className="error-text">{error}</p>}

          {archivedGames.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <button
                className={showArchived ? 'btn btn--ghost' : 'btn btn--secondary'}
                style={{ padding: '6px 14px' }}
                onClick={() => setShowArchived(false)}
              >
                Active ({activeGames.length})
              </button>
              <button
                className={showArchived ? 'btn btn--secondary' : 'btn btn--ghost'}
                style={{ padding: '6px 14px' }}
                onClick={() => setShowArchived(true)}
              >
                Archived ({archivedGames.length})
              </button>
            </div>
          )}

          {visibleGames.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)' }}>
              {showArchived
                ? 'No archived games.'
                : "No games where you're the GM yet. Create one, or join an existing game with its GM code."}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleGames.map((entry) => {
                const phase = gamePhase(entry.game);
                const canDelete = phase === 'setup' || phase === 'lobby';
                const canArchive = phase === 'results';
                const busy = busyId === entry.game.id;
                return (
                  <div
                    key={entry.game.id}
                    className="card"
                    style={{ display: 'flex', alignItems: 'center', gap: 14, color: 'var(--text)' }}
                  >
                    <button
                      onClick={() => openGame(entry)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 14,
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: 'rgba(90,126,78,0.2)',
                        }}
                      >
                        GM
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ display: 'block', fontSize: 16, fontWeight: 700 }}>{entry.game.name}</span>
                        <span style={{ display: 'block', fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                          {PHASE_TEXT[phase]}
                          {entry.game.gameDate?.toDate ? ` · ${entry.game.gameDate.toDate().toLocaleDateString()}` : ''}
                        </span>
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>›</span>
                    </button>
                    <button
                      className="btn btn--ghost"
                      style={{ padding: '6px 12px', fontSize: 13 }}
                      disabled={busy}
                      title="Create a new game with this game's boundary and checkpoints"
                      onClick={() => setCloneTarget(entry)}
                    >
                      Clone
                    </button>
                    {canArchive && (
                      <button
                        className="btn btn--ghost"
                        style={{ padding: '6px 12px', fontSize: 13 }}
                        disabled={busy}
                        onClick={() => toggleArchive(entry)}
                      >
                        {entry.archived ? 'Unarchive' : 'Archive'}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        className="btn btn--ghost"
                        style={{ padding: '6px 12px', fontSize: 13, color: 'var(--danger, #e5484d)' }}
                        disabled={busy}
                        onClick={() => handleDelete(entry)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateGameModal
          defaultName={profile?.displayName ?? ''}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => navigate(`/games/${id}`)}
        />
      )}
      {showJoin && (
        <JoinGameModal
          defaultName={profile?.displayName ?? ''}
          onClose={() => setShowJoin(false)}
          onJoined={(gameId, role) => {
            setShowJoin(false);
            if (role === 'gm') navigate(`/games/${gameId}`);
            else { setError('That code joined you as a player. The web dashboard is for GMs — use a GM code.'); loadGames(); }
          }}
        />
      )}
      {cloneTarget && (
        <CloneGameModal
          source={cloneTarget}
          gmName={profile?.displayName?.trim() || 'GM'}
          onClose={() => setCloneTarget(null)}
          onCloned={(id) => navigate(`/games/${id}`)}
        />
      )}
    </div>
  );
}

function CloneGameModal({
  source,
  gmName,
  onClose,
  onCloned,
}: {
  source: GameEntry;
  gmName: string;
  onClose: () => void;
  onCloned: (gameId: string) => void;
}) {
  const [name, setName] = useState(`${source.game.name} (copy)`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleClone() {
    setError('');
    if (!name.trim()) { setError('Enter a name for the new game'); return; }
    setLoading(true);
    try {
      const { id } = await cloneGame(source.game.id, gmName, name.trim());
      onCloned(id);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  return (
    <Modal title="Clone Game" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Creates a new game with this game's boundary, checkpoints, runbook, and settings. Players,
        results, and play history are not copied. You'll be the GM with fresh join codes.
      </p>
      <div className="field">
        <label>New game name</label>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Arena 2025 — Round 2" />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={handleClone} disabled={loading}>
          {loading ? 'Cloning…' : 'Clone Game'}
        </button>
      </div>
    </Modal>
  );
}

function CreateGameModal({
  defaultName,
  onClose,
  onCreated,
}: {
  defaultName: string;
  onClose: () => void;
  onCreated: (gameId: string) => void;
}) {
  const [gameName, setGameName] = useState('');
  const [displayName, setDisplayName] = useState(defaultName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    setError('');
    if (!gameName.trim()) { setError('Enter a game name'); return; }
    if (!displayName.trim()) { setError('Enter your GM name'); return; }
    setLoading(true);
    try {
      const { id } = await createGame(gameName.trim(), displayName.trim());
      onCreated(id);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  return (
    <Modal title="Create Game" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        You'll be the Game Master. Share the player code with players and the GM code with co-GMs.
      </p>
      <div className="field">
        <label>Game Name</label>
        <input className="input" value={gameName} autoFocus onChange={(e) => setGameName(e.target.value)} placeholder="e.g. Arena 2025" />
      </div>
      <div className="field">
        <label>Your GM Name</label>
        <input className="input" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Gamemaker Snow" />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={handleCreate} disabled={loading}>
          {loading ? 'Creating…' : 'Create Game'}
        </button>
      </div>
    </Modal>
  );
}

function JoinGameModal({
  defaultName,
  onClose,
  onJoined,
}: {
  defaultName: string;
  onClose: () => void;
  onJoined: (gameId: string, role: 'player' | 'gm') => void;
}) {
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState(defaultName);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleJoin() {
    setError('');
    if (code.trim().length < 6) { setError('Enter the 6-character game code'); return; }
    if (!displayName.trim()) { setError('Enter your name'); return; }
    setLoading(true);
    try {
      const { gameId, role } = await joinGameByCode(code.trim(), displayName.trim());
      onJoined(gameId, role);
    } catch (err) {
      setError(friendlyError(err));
      setLoading(false);
    }
  }

  return (
    <Modal title="Join with GM code" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Enter the GM code to co-manage an existing game.
      </p>
      <div className="field">
        <label>Game Code</label>
        <input
          className="input"
          value={code}
          autoFocus
          maxLength={6}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCDEF"
          style={{ letterSpacing: 4, textTransform: 'uppercase' }}
        />
      </div>
      <div className="field">
        <label>Your Name</label>
        <input className="input" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Co-GM" />
      </div>
      {error && <div className="error-text">{error}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={handleJoin} disabled={loading}>
          {loading ? 'Joining…' : 'Join Game'}
        </button>
      </div>
    </Modal>
  );
}
