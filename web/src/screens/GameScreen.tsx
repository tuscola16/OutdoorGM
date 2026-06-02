import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGame } from '@/context/GameContext';
import { useAuth } from '@/context/AuthContext';
import { GameMap, type DeathMarker } from '@/components/GameMap';
import { AlertFeed } from '@/components/AlertFeed';
import { Modal } from '@/components/Modal';
import { useElapsed, useRemaining, formatDuration } from '@/hooks/useElapsed';
import { useNow } from '@/hooks/useNow';
import { friendlyError } from '@/services/errorUtils';
import { stalenessLevel, stalenessColor, formatAgo, STALE_MS } from '@/services/locationStatus';
import {
  openLobby, reopenSetup, startGame, endGame, updateGameConfig, gameConfig,
  addCheckpoint, updateCheckpoint, deleteCheckpoint,
  updateMemberRole, removePlayer, eliminatePlayer, clearSos, sendBroadcast,
  deleteGame, setGameArchived,
} from '@/services/gameService';
import type { Checkpoint, GameMember, MapBoundary, PlayerLocation } from '@shared/types';

const PHASE_LABEL: Record<string, string> = {
  setup: 'SETUP', lobby: 'LOBBY', play: 'IN PLAY', results: 'RESULTS',
};

export function GameScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { game, phase, checkpoints, members, playerLocations, arrivals, loadGame, clearGame } = useGame();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const elapsed = useElapsed(game?.startedAt, game?.endedAt);
  const remaining = useRemaining(game?.startedAt, gameConfig(game).durationMinutes, game?.endedAt);
  const now = useNow(10000);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  async function run(fn: () => Promise<void>) {
    if (!gameId) return;
    setBusy(true);
    try { await fn(); }
    catch (err) { window.alert(friendlyError(err)); }
    finally { setBusy(false); }
  }

  function confirmDelete() {
    if (
      !window.confirm(
        `Delete "${game?.name ?? 'this game'}"? This permanently removes the game, its checkpoints, and all members. This cannot be undone.`
      )
    ) {
      return;
    }
    run(async () => {
      await deleteGame(gameId!);
      navigate('/games');
    });
  }

  function archiveAndExit() {
    if (!user) return;
    run(async () => {
      await setGameArchived(gameId!, user.uid, true);
      navigate('/games');
    });
  }

  const players = members.filter((m) => m.role === 'player');

  // Stale-fix tracking: Outdoor GM is the only tracker now (replaces Pingo), so a
  // silent drop-off must be visible. userId → last fix (ms).
  const lastFixByUser = new Map<string, number>();
  for (const loc of playerLocations) {
    const ms = loc.updatedAt?.toMillis?.();
    if (ms) lastFixByUser.set(loc.userId, ms);
  }
  const notReporting = players.filter((p) => {
    if (p.out) return false;
    const ms = lastFixByUser.get(p.userId);
    return ms == null || now - ms >= STALE_MS;
  }).length;
  const aliveCount = players.filter((p) => !p.out).length;
  const deathMarkers: DeathMarker[] = members
    .filter((m) => m.out && m.deathLocation)
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      latitude: m.deathLocation!.latitude,
      longitude: m.deathLocation!.longitude,
    }));

  async function broadcast(message: string, targetPlayerId?: string) {
    await run(() => sendBroadcast(gameId!, message, targetPlayerId));
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '12px 20px', borderBottom: '1px solid var(--border)',
        }}
      >
        <button className="btn btn--ghost" style={{ padding: '6px 12px' }} onClick={() => navigate('/games')}>
          ← Games
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {game?.name ?? '…'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--secondary)', fontWeight: 700, letterSpacing: 1 }}>
              GAME MASTER
            </span>
            <span style={{
              fontSize: 10, fontWeight: 800, color: 'var(--primary)', letterSpacing: 1,
              background: 'var(--surface-elevated)', borderRadius: 6, padding: '1px 6px',
            }}>
              {PHASE_LABEL[phase]}
            </span>
          </div>
        </div>
        <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowCodes(true)}>Codes</button>
        <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowPlayers(true)}>
          Players ({members.length})
        </button>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        {phase === 'setup' && (
          <SetupView gameId={gameId!} busy={busy} run={run}
            onOpenLobby={() => run(() => openLobby(gameId!))}
            onEditSettings={() => setShowConfig(true)}
            onDelete={confirmDelete} />
        )}
        {phase === 'lobby' && (
          <LobbyView
            players={players}
            playerCode={game?.playerCode ?? '…'}
            busy={busy}
            onStart={() => run(() => startGame(gameId!))}
            onBack={() => run(() => reopenSetup(gameId!))}
            onDelete={confirmDelete}
          />
        )}
        {phase === 'play' && (
          <PlayView
            remaining={remaining}
            aliveCount={aliveCount}
            activeCount={playerLocations.length}
            arrivalsCount={arrivals.length}
            notReporting={notReporting}
            sosPlayers={players.filter((p) => p.sos)}
            checkpoints={checkpoints}
            playerLocations={playerLocations}
            deathMarkers={deathMarkers}
            boundary={game?.boundary}
            arrivals={arrivals}
            busy={busy}
            onBroadcast={() => setShowBroadcast(true)}
            onClearSos={(userId) => run(() => clearSos(gameId!, userId))}
            onOpenPlayers={() => setShowPlayers(true)}
            onEnd={() => {
              if (window.confirm('End the game? This stops play for everyone and shows results.')) {
                run(() => endGame(gameId!));
              }
            }}
          />
        )}
        {phase === 'results' && (
          <ResultsView
            totalDuration={elapsed}
            players={players}
            startedAtMs={game?.startedAt?.toMillis?.() ?? null}
            endedAtMs={game?.endedAt?.toMillis?.() ?? null}
            busy={busy}
            onArchive={archiveAndExit}
            onDone={() => navigate('/games')}
          />
        )}
      </div>

      {showCodes && (
        <CodesModal
          playerCode={game?.playerCode ?? ''}
          gmCode={game?.gmCode ?? ''}
          onClose={() => setShowCodes(false)}
        />
      )}
      {showPlayers && (
        <PlayersModal
          gameId={gameId!}
          members={members}
          lastFixByUser={lastFixByUser}
          now={now}
          phase={phase}
          onClose={() => setShowPlayers(false)}
        />
      )}
      {showBroadcast && (
        <BroadcastModal
          aliveCount={aliveCount}
          onSend={async (msg) => { await broadcast(msg); }}
          onClose={() => setShowBroadcast(false)}
        />
      )}
      {showConfig && (
        <ConfigModal gameId={gameId!} initial={gameConfig(game)} onClose={() => setShowConfig(false)} />
      )}
    </div>
  );
}

// --- Setup ---

function SetupView({
  gameId, busy, run, onOpenLobby, onEditSettings, onDelete,
}: {
  gameId: string;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onOpenLobby: () => void;
  onEditSettings: () => void;
  onDelete: () => void;
}) {
  const { game, checkpoints } = useGame();
  const [drawing, setDrawing] = useState(false);
  const [cpModal, setCpModal] = useState<{ coord: { latitude: number; longitude: number }; edit?: Checkpoint } | null>(null);
  const [showRules, setShowRules] = useState(false);

  function handleMapClick(coord: { latitude: number; longitude: number }) {
    setCpModal({ coord });
  }

  async function handleBoundaryDrawn(b: MapBoundary) {
    setDrawing(false);
    await run(() => updateGameConfig(gameId, { boundary: b }));
  }

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <GameMap
          checkpoints={checkpoints}
          playerLocations={[]}
          boundary={game?.boundary}
          editMode
          drawingBoundary={drawing}
          onMapClick={handleMapClick}
          onCheckpointClick={(cp) => setCpModal({ coord: { latitude: cp.latitude, longitude: cp.longitude }, edit: cp })}
          onBoundaryDrawn={handleBoundaryDrawn}
        />
        {drawing && (
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12, textAlign: 'center',
            background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 13,
          }}>
            Click and drag on the map to draw the play-area boundary.
          </div>
        )}
      </div>

      <aside style={{
        width: 320, borderLeft: '1px solid var(--border)', padding: 20,
        display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
      }}>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Set up your game. Draw the play area, add checkpoints, write rules, then open it to players.
        </p>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Play boundary</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {game?.boundary ? 'Boundary set ✓' : 'Not set yet'}
          </span>
          <button className={`btn ${drawing ? 'btn--ghost' : ''}`} onClick={() => setDrawing((d) => !d)}>
            {drawing ? 'Cancel drawing' : game?.boundary ? 'Redraw boundary' : 'Draw boundary'}
          </button>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>Checkpoints ({checkpoints.length})</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Click anywhere on the map to add one.
          </span>
          {checkpoints.map((cp) => (
            <button
              key={cp.id}
              className="btn btn--ghost"
              style={{ justifyContent: 'space-between', padding: '8px 12px' }}
              onClick={() => setCpModal({ coord: { latitude: cp.latitude, longitude: cp.longitude }, edit: cp })}
            >
              <span>{cp.name}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{cp.radius}m</span>
            </button>
          ))}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Rules</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {game?.rules?.trim() ? 'Rules written ✓' : 'None yet — optional'}
          </span>
          <button className="btn btn--ghost" onClick={() => setShowRules(true)}>Edit rules</button>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <strong>Game settings</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {(gameConfig(game).durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}h game · duration, winner, battery saver
          </span>
          <button className="btn btn--ghost" onClick={onEditSettings}>Edit settings</button>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn--block" onClick={onOpenLobby} disabled={busy}>
            Open to Players
          </button>
          <button
            className="btn btn--ghost btn--block"
            onClick={onDelete}
            disabled={busy}
            style={{ color: 'var(--danger)' }}
          >
            Delete game
          </button>
        </div>
      </aside>

      {cpModal && (
        <CheckpointModal
          gameId={gameId}
          coord={cpModal.coord}
          edit={cpModal.edit}
          existingCount={checkpoints.length}
          onClose={() => setCpModal(null)}
        />
      )}
      {showRules && (
        <RulesModal gameId={gameId} initial={game?.rules ?? ''} onClose={() => setShowRules(false)} />
      )}
    </div>
  );
}

function CheckpointModal({
  gameId, coord, edit, existingCount, onClose,
}: {
  gameId: string;
  coord: { latitude: number; longitude: number };
  edit?: Checkpoint;
  existingCount: number;
  onClose: () => void;
}) {
  const [name, setName] = useState(edit?.name ?? `Checkpoint ${existingCount + 1}`);
  const [radius, setRadius] = useState(String(edit?.radius ?? 100));
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) { window.alert('Enter a checkpoint name'); return; }
    const r = parseInt(radius, 10);
    if (isNaN(r) || r < 10) { window.alert('Enter a valid radius (minimum 10m)'); return; }
    setBusy(true);
    try {
      if (edit) await updateCheckpoint(gameId, edit.id, { name: name.trim(), radius: r });
      else await addCheckpoint(gameId, { name: name.trim(), latitude: coord.latitude, longitude: coord.longitude, radius: r });
      onClose();
    } catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  async function remove() {
    if (!edit) return;
    if (!window.confirm(`Delete "${edit.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteCheckpoint(gameId, edit.id); onClose(); }
    catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  return (
    <Modal title={edit ? 'Edit Checkpoint' : 'New Checkpoint'} onClose={onClose}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        📍 {coord.latitude.toFixed(5)}, {coord.longitude.toFixed(5)}
      </div>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Detection Radius (meters)</label>
        <input className="input" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>{edit ? 'Save' : 'Add'}</button>
      </div>
      {edit && (
        <button className="btn btn--danger" onClick={remove} disabled={busy}>Delete checkpoint</button>
      )}
    </Modal>
  );
}

function RulesModal({ gameId, initial, onClose }: { gameId: string; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await updateGameConfig(gameId, { rules: text.trim() }); onClose(); }
    catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }
  return (
    <Modal title="Game Rules" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Players see these in their tutorial before the game starts.
      </p>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="e.g. Stay inside the boundary. First to all checkpoints wins. No vehicles."
        style={{ resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>Save</button>
      </div>
    </Modal>
  );
}

// --- Lobby ---

function LobbyView({
  players, playerCode, busy, onStart, onBack, onDelete,
}: {
  players: GameMember[];
  playerCode: string;
  busy: boolean;
  onStart: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: 1 }}>PLAYER CODE</div>
        <CopyableCode code={playerCode} big />
      </div>
      <h3 style={{ margin: 0 }}>{players.length} player{players.length === 1 ? '' : 's'} joined</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {players.length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>Waiting for players to join with the code above…</p>
        )}
        {players.map((p) => (
          <div key={p.userId} className="card" style={{ padding: '10px 14px' }}>{p.displayName}</div>
        ))}
      </div>
      <button className="btn btn--block" onClick={onStart} disabled={busy}>Start Game</button>
      <button className="btn btn--ghost" onClick={onBack} disabled={busy}>← Back to setup</button>
      <button className="btn btn--ghost" onClick={onDelete} disabled={busy} style={{ color: 'var(--danger)' }}>
        Delete game
      </button>
    </div>
  );
}

// --- Play ---

function PlayView({
  remaining, aliveCount, activeCount, arrivalsCount, notReporting, sosPlayers,
  checkpoints, playerLocations, deathMarkers, boundary, arrivals, busy,
  onBroadcast, onClearSos, onOpenPlayers, onEnd,
}: {
  remaining: number | null;
  aliveCount: number;
  activeCount: number;
  arrivalsCount: number;
  notReporting: number;
  sosPlayers: GameMember[];
  checkpoints: Checkpoint[];
  playerLocations: PlayerLocation[];
  deathMarkers: DeathMarker[];
  boundary?: MapBoundary | null;
  arrivals: any[];
  busy: boolean;
  onBroadcast: () => void;
  onClearSos: (userId: string) => void;
  onOpenPlayers: () => void;
  onEnd: () => void;
}) {
  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <div style={{ flex: 1 }}>
        <GameMap checkpoints={checkpoints} playerLocations={playerLocations} deathMarkers={deathMarkers} boundary={boundary} />
      </div>
      <aside style={{
        width: 340, borderLeft: '1px solid var(--border)', padding: 20,
        display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Stat label="Remaining" value={remaining != null ? formatDuration(remaining) : '—'} danger={remaining === 0} />
          <Stat label="Alive" value={String(aliveCount)} />
          <Stat label="Active" value={String(activeCount)} />
          <Stat label="Arrivals" value={String(arrivalsCount)} />
        </div>

        {/* Safety alerts — most urgent, surfaced first. */}
        {sosPlayers.map((p) => (
          <div key={p.userId} className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(232,64,42,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🆘</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: 'var(--danger)' }}>{p.displayName} needs assistance</div>
            </div>
            <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => onClearSos(p.userId)}>Clear</button>
          </div>
        ))}

        {notReporting > 0 && (
          <button
            className="card"
            onClick={onOpenPlayers}
            style={{ textAlign: 'left', cursor: 'pointer', borderColor: 'var(--danger)', background: 'rgba(232,64,42,0.08)', color: 'var(--danger)', fontWeight: 600 }}
          >
            ⚠ {notReporting} player{notReporting === 1 ? '' : 's'} not reporting — tap to check
          </button>
        )}

        <button className="btn" onClick={onBroadcast} disabled={busy}>📢 Broadcast to players</button>

        <h3 style={{ margin: '4px 0 0' }}>Alerts</h3>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <AlertFeed arrivals={arrivals} />
        </div>
        <button className="btn btn--danger" onClick={onEnd} disabled={busy}>End Game</button>
      </aside>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="card" style={{ flex: 1, textAlign: 'center', padding: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: danger ? 'var(--danger)' : undefined }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// --- Results ---

function ResultsView({
  totalDuration, players, startedAtMs, endedAtMs, busy, onArchive, onDone,
}: {
  totalDuration: number | null;
  players: GameMember[];
  startedAtMs: number | null;
  endedAtMs: number | null;
  busy: boolean;
  onArchive: () => void;
  onDone: () => void;
}) {
  function playerTime(p: GameMember): string {
    if (startedAtMs == null) return '—';
    const outMs = p.outAt?.toMillis?.() ?? null;
    const end = outMs ?? endedAtMs ?? Date.now();
    return formatDuration(Math.max(0, Math.floor((end - startedAtMs) / 1000)));
  }
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 24 }}>
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <div style={{ color: 'var(--text-secondary)', fontWeight: 800, letterSpacing: 2, fontSize: 12 }}>GAME OVER</div>
        <div style={{ fontSize: 44, fontWeight: 800 }}>{totalDuration != null ? formatDuration(totalDuration) : '—'}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>total game time</div>
      </div>
      <h3>Players</h3>
      {players.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No players took part.</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {players.map((p) => (
          <div key={p.userId} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600 }}>{p.displayName}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {p.out && <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 4, padding: '1px 5px' }}>OUT</span>}
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{playerTime(p)}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onDone}>Back to Games</button>
        <button className="btn btn--secondary" style={{ flex: 1 }} onClick={onArchive} disabled={busy}>
          Archive game
        </button>
      </div>
    </div>
  );
}

// --- Shared modals ---

function CodesModal({ playerCode, gmCode, onClose }: { playerCode: string; gmCode: string; onClose: () => void }) {
  return (
    <Modal title="Game Codes" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Share these codes for players and co-GMs to join.
      </p>
      <div className="card" style={{ background: 'var(--surface-elevated)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: 1 }}>PLAYER CODE</div>
        <CopyableCode code={playerCode} />
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Players join — they can't see others or checkpoints</div>
      </div>
      <div className="card" style={{ background: 'var(--surface-elevated)', borderColor: 'rgba(90,126,78,0.4)' }}>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: 1 }}>GM CODE</div>
        <CopyableCode code={gmCode} />
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Co-GMs join — they see everything</div>
      </div>
      <button className="btn btn--ghost btn--block" onClick={onClose}>Close</button>
    </Modal>
  );
}

function CopyableCode({ code, big }: { code: string; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }
  return (
    <button
      onClick={copy}
      style={{
        background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: big ? 'center' : 'space-between',
        gap: 12, width: '100%', padding: 0,
      }}
    >
      <span style={{ fontSize: big ? 36 : 28, fontWeight: 800, letterSpacing: 8 }}>{code || '…'}</span>
      <span style={{ fontSize: 13, color: copied ? 'var(--success)' : 'var(--text-secondary)' }}>
        {copied ? '✓ Copied' : 'Copy'}
      </span>
    </button>
  );
}

function PlayersModal({
  gameId, members, lastFixByUser, now, phase, onClose,
}: {
  gameId: string;
  members: GameMember[];
  lastFixByUser: Map<string, number>;
  now: number;
  phase: string;
  onClose: () => void;
}) {
  async function toggleRole(m: GameMember) {
    const newRole = m.role === 'player' ? 'gm' : 'player';
    const label = newRole === 'gm' ? 'Promote to GM' : 'Demote to Player';
    if (!window.confirm(`${label}? ${m.displayName} will ${newRole === 'gm' ? 'gain GM access and see all player locations.' : 'lose GM access.'}`)) return;
    try { await updateMemberRole(gameId, m.userId, newRole); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function remove(m: GameMember) {
    if (!window.confirm(`Remove ${m.displayName}? They'll be removed and their location will no longer be tracked.`)) return;
    try { await removePlayer(gameId, m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function eliminate(m: GameMember) {
    if (!window.confirm(`Eliminate ${m.displayName}? Everyone is notified, and if they're the last one standing the survivor wins.`)) return;
    try { await eliminatePlayer(gameId, m.userId, 'gm-other'); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function dismissSos(m: GameMember) {
    try { await clearSos(gameId, m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  const gms = members.filter((m) => m.role === 'gm');
  const players = members.filter((m) => m.role === 'player');
  const alive = players.filter((m) => !m.out).length;
  return (
    <Modal title={`Players (${members.length})`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {gms.length} GM{gms.length !== 1 ? 's' : ''} · {players.length} player{players.length !== 1 ? 's' : ''} · {alive} alive
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
        {members.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No members yet.</p>}
        {[...gms, ...players].map((m) => {
          const isGM = m.role === 'gm';
          const isOut = !!m.out;
          const showFix = !isGM && !isOut && phase === 'play';
          const fixMs = lastFixByUser.get(m.userId) ?? null;
          const level = showFix ? stalenessLevel(fixMs == null ? null : now - fixMs) : 'none';
          return (
            <div key={m.userId} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderColor: m.sos ? 'var(--danger)' : undefined, background: m.sos ? 'rgba(232,64,42,0.08)' : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, textDecoration: isOut ? 'line-through' : undefined, color: isOut ? 'var(--text-secondary)' : undefined }}>{m.displayName}</div>
                {m.sos ? (
                  <div style={{ fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>🆘 Needs assistance</div>
                ) : showFix ? (
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: level === 'stale' ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: stalenessColor(level), display: 'inline-block' }} />
                    {fixMs == null ? 'No signal yet' : `Last fix ${formatAgo(now - fixMs)}`}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{m.email}</div>
                )}
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, letterSpacing: 0.5, padding: '3px 7px', borderRadius: 6,
                background: isOut ? 'rgba(232,64,42,0.2)' : isGM ? 'rgba(90,126,78,0.2)' : 'rgba(212,137,63,0.15)',
              }}>
                {isOut ? 'DEAD' : isGM ? 'GM' : 'PLAYER'}
              </span>
              {m.sos && (
                <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => dismissSos(m)}>Clear SOS</button>
              )}
              {!isGM && !isOut && (
                <button className="btn btn--danger" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => eliminate(m)}>Eliminate</button>
              )}
              <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => toggleRole(m)}>
                {isGM ? 'Demote' : 'Promote'}
              </button>
              <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => remove(m)}>
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <button className="btn btn--ghost btn--block" onClick={onClose}>Close</button>
    </Modal>
  );
}

function BroadcastModal({
  aliveCount, onSend, onClose,
}: {
  aliveCount: number;
  onSend: (message: string) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(message: string) {
    if (!message.trim()) return;
    setBusy(true);
    try { await onSend(message.trim()); onClose(); }
    catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }
  return (
    <Modal title="Broadcast to players" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        One-way message to every player (gear drops, updates, warnings). Players can't reply.
      </p>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="e.g. Gear drop at the old oak — marked with your name."
        style={{ resize: 'vertical' }}
        autoFocus
      />
      <button
        className="btn btn--ghost btn--block"
        disabled={busy}
        onClick={() => send(`${aliveCount} ${aliveCount === 1 ? 'tribute remains' : 'tributes remain'}.`)}
      >
        Send living-player count instead
      </button>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={() => send(text)} disabled={busy}>Send</button>
      </div>
    </Modal>
  );
}

function ConfigModal({
  gameId, initial, onClose,
}: {
  gameId: string;
  initial: ReturnType<typeof gameConfig>;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [playerCount, setPlayerCount] = useState(initial.playerCountBroadcast);
  const [winner, setWinner] = useState(initial.winnerDetection);
  const [battery, setBattery] = useState(initial.batterySaver);
  const [busy, setBusy] = useState(false);

  async function save() {
    const minutes = Math.max(5, Math.round(Number(duration) || initial.durationMinutes));
    setBusy(true);
    try {
      await updateGameConfig(gameId, {
        config: {
          durationMinutes: minutes,
          playerCountBroadcast: playerCount,
          winnerDetection: winner,
          batterySaver: battery,
        },
      });
      onClose();
    } catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  return (
    <Modal title="Game settings" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Tune the rules for this game. Defaults match the base game.
      </p>
      <div className="field">
        <label>Game length (minutes)</label>
        <input className="input" type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>210 = 3.5 hours</span>
      </div>
      <Toggle label="Auto player-count updates" checked={playerCount} onChange={setPlayerCount} />
      <Toggle label="Declare a winner" checked={winner} onChange={setWinner} />
      <Toggle label="Battery saver" checked={battery} onChange={setBattery} />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>Save</button>
      </div>
    </Modal>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '6px 0' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
