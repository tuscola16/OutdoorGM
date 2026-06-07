import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGame } from '@/context/GameContext';
import { useAuth } from '@/context/AuthContext';
import { GameMap, type DeathMarker } from '@/components/GameMap';
import { NotificationFeed } from '@/components/NotificationFeed';
import { Modal } from '@/components/Modal';
import { useElapsed, useRemaining, formatDuration } from '@/hooks/useElapsed';
import { useNow } from '@/hooks/useNow';
import { friendlyError } from '@/services/errorUtils';
import { stalenessLevel, stalenessColor, formatAgo, STALE_MS, unaccountedPlayers, unaccountedReasonText } from '@/services/locationStatus';
import {
  openLobby, reopenSetup, startGame, endGame, updateGameConfig, gameConfig,
  addCheckpoint, updateCheckpoint, deleteCheckpoint, stateEventFields,
  updateMemberRole, removePlayer, eliminatePlayer, clearSos, ackSos, sendBroadcast,
  deleteGame, setGameArchived, reviewRation, rationInterval, setMemberDistrict,
  openCheckpointNow, closeCheckpointNow, clearCheckpointWindow, checkpointWindowState,
  addScheduledEvent, updateScheduledEvent, deleteScheduledEvent,
  revealCheckpointNow, setRevealSchedule, parseEventDate, formatEventDate,
  sendGmMessage, subscribeGmMessages,
} from '@/services/gameService';
import {
  KIND_META, KIND_ORDER, checkpointKind, buildEvent, VIS_META, VIS_ORDER,
  STATE_META, STATE_ORDER, behaviorSummary, CHECKPOINT_ICON_EMOJIS, DEFAULT_CHECKPOINT_ICON, checkpointIconEmoji,
} from '@/services/checkpointKinds';
import { deleteField } from 'firebase/firestore';
import type {
  Arrival, Checkpoint, CheckpointEvent, CheckpointKind, EventAudience, GameMember, MapBoundary, PlayerLocation, RationSubmission,
  ScheduledEvent, ScheduledActionType, CheckpointVisibility, RevealTrigger, RevealAudience, CheckpointReveal, FsTimestamp, Broadcast,
  CheckpointState, CheckpointTransition,
} from '@shared/types';

const PHASE_LABEL: Record<string, string> = {
  setup: 'SETUP', lobby: 'LOBBY', play: 'IN PLAY', results: 'RESULTS',
};

export function GameScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { game, phase, checkpoints, members, playerLocations, arrivals, rations, scheduledEvents, loadGame, clearGame } = useGame();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showGmMessages, setShowGmMessages] = useState(false); // co-GM messaging (#40)
  const [showConfig, setShowConfig] = useState(false);
  const [showRations, setShowRations] = useState(false);
  const [showRunSheet, setShowRunSheet] = useState(false);
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

  const rationsEnabled = gameConfig(game).rationsEnabled;
  const pendingRations = rations.filter((r) => r.status === 'pending').length;

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
        <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowGmMessages(true)}>Co-GM</button>
        {phase !== 'results' && (
          <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowRunSheet(true)}>
            Run-sheet{scheduledEvents.length ? ` (${scheduledEvents.length})` : ''}
          </button>
        )}
        <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowPlayers(true)}>
          Players ({players.length})
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
            members={players}
            busy={busy}
            rationsEnabled={rationsEnabled}
            pendingRations={pendingRations}
            onOpenRations={() => setShowRations(true)}
            onBroadcast={() => setShowBroadcast(true)}
            onAckSos={(userId) => run(() => ackSos(gameId!, userId))}
            onClearSos={(userId) => run(() => clearSos(gameId!, userId))}
            onOpenPlayers={() => setShowPlayers(true)}
            onEnd={() => {
              // Block End Game while a player is unaccounted-for (#6): open unacked SOS
              // or no fresh fix. Hard override only — confirm past the warning to end.
              const unaccounted = unaccountedPlayers(players, lastFixByUser, now);
              if (unaccounted.length > 0) {
                const lines = unaccounted
                  .map((p) => `• ${p.displayName} — ${unaccountedReasonText(p, now, lastFixByUser)}`)
                  .join('\n');
                if (!window.confirm(
                  `${unaccounted.length} player(s) unaccounted-for — open safety alert or no recent location:\n\n${lines}\n\nCheck on them before ending. End anyway?`
                )) return;
              } else if (!window.confirm('End the game? This stops play for everyone and shows results.')) {
                return;
              }
              run(() => endGame(gameId!));
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
      {showGmMessages && (
        <GmMessagesModal
          gameId={gameId!}
          senderName={members.find((m) => m.userId === user?.uid)?.displayName ?? 'GM'}
          onClose={() => setShowGmMessages(false)}
        />
      )}
      {showConfig && (
        <ConfigModal gameId={gameId!} initial={gameConfig(game)} gameDateInitial={game?.gameDate ?? null} onClose={() => setShowConfig(false)} />
      )}
      {showRations && (
        <RationsModal
          gameId={gameId!}
          rations={rations}
          members={members}
          currentIndex={rationInterval(game, now)?.index ?? null}
          totalWindows={rationInterval(game, now)?.total ?? null}
          enforceUnique={gameConfig(game).enforceUniqueRationCards}
          onClose={() => setShowRations(false)}
        />
      )}
      {showRunSheet && (
        <RunSheetModal
          gameId={gameId!}
          events={scheduledEvents}
          checkpoints={checkpoints}
          onClose={() => setShowRunSheet(false)}
        />
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
  const [drawing, setDrawing] = useState(false); // rectangle drag
  const [drawingPoly, setDrawingPoly] = useState(false); // polygon draw/edit (#39)
  // Slim placement modal — new checkpoints only (name + icon + radius).
  const [newCpCoord, setNewCpCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  // Full behavior editor — for existing checkpoints.
  const [behaviorCheckpointId, setBehaviorCheckpointId] = useState<string | null>(null);
  const behaviorCp = checkpoints.find((c) => c.id === behaviorCheckpointId) ?? null;
  const [showRules, setShowRules] = useState(false);

  function handleMapClick(coord: { latitude: number; longitude: number }) {
    setNewCpCoord(coord);
  }

  async function handleBoundaryDrawn(b: MapBoundary) {
    // Rectangle is one-shot (exit after); polygon stays active so the GM can keep
    // adjusting vertices until they click Done (#39).
    if (!b.polygon) setDrawing(false);
    await run(() => updateGameConfig(gameId, { boundary: b }));
  }

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <GameMap
          checkpoints={checkpoints}
          playerLocations={[]}
          boundary={game?.boundary}
          editMode={!drawingPoly}
          drawingBoundary={drawing}
          drawingPolygon={drawingPoly}
          onMapClick={handleMapClick}
          onCheckpointClick={(cp) => setBehaviorCheckpointId(cp.id)}
          onBoundaryDrawn={handleBoundaryDrawn}
        />
        {(drawing || drawingPoly) && (
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12, textAlign: 'center',
            background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 12px', borderRadius: 8, fontSize: 13,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <span>
              {drawing
                ? 'Click and drag on the map to draw a rectangular boundary.'
                : 'Click to add points, double-click to finish. Drag points to adjust — saves automatically.'}
            </span>
            {drawingPoly && (
              <button className="btn" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setDrawingPoly(false)}>Done</button>
            )}
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
            {game?.boundary
              ? game.boundary.polygon && game.boundary.polygon.length >= 3
                ? `Polygon set ✓ (${game.boundary.polygon.length} points)`
                : 'Rectangle set ✓'
              : 'Not set yet'}
          </span>
          <button
            className={`btn ${drawing ? 'btn--ghost' : ''}`}
            onClick={() => { setDrawingPoly(false); setDrawing((d) => !d); }}
          >
            {drawing ? 'Cancel drawing' : 'Draw rectangle'}
          </button>
          <button
            className={`btn ${drawingPoly ? 'btn--ghost' : 'btn--secondary'}`}
            onClick={() => { setDrawing(false); setDrawingPoly((d) => !d); }}
          >
            {drawingPoly ? 'Done editing polygon' : game?.boundary?.polygon ? 'Edit polygon' : 'Draw polygon'}
          </button>
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <strong>Checkpoints ({checkpoints.length})</strong>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Click the map to place a checkpoint. Click a name to configure its behavior.
          </span>
          {checkpoints.map((cp) => {
            const meta = KIND_META[checkpointKind(cp)];
            const iconEmoji = checkpointIconEmoji(cp.icon);
            return (
              <div key={cp.id} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button
                  className="btn btn--ghost"
                  style={{ flex: 1, justifyContent: 'flex-start', gap: 8, padding: '8px 10px', textAlign: 'left' }}
                  onClick={() => setBehaviorCheckpointId(cp.id)}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{iconEmoji}</span>
                  <span style={{ flex: 1, fontWeight: 600 }}>{cp.name}</span>
                  <span style={{ color: meta.color, fontSize: 11, flexShrink: 0 }}>{meta.emoji}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                    {behaviorSummary(cp)} · {cp.radius}m
                  </span>
                </button>
              </div>
            );
          })}
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

      {newCpCoord && (
        <NewCheckpointModal
          gameId={gameId}
          coord={newCpCoord}
          existingCount={checkpoints.length}
          onClose={(andConfigure) => {
            setNewCpCoord(null);
            if (andConfigure) setBehaviorCheckpointId(andConfigure);
          }}
        />
      )}
      {behaviorCp && (
        <CheckpointBehaviorModal
          gameId={gameId}
          cp={behaviorCp}
          onClose={() => setBehaviorCheckpointId(null)}
        />
      )}
      {showRules && (
        <RulesModal gameId={gameId} initial={game?.rules ?? ''} onClose={() => setShowRules(false)} />
      )}
    </div>
  );
}

/** Row of selectable kind chips (Hazard / Boon / Notify / GM only). */
function KindChips({ value, onChange }: { value: CheckpointKind; onChange: (k: CheckpointKind) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {KIND_ORDER.map((k) => {
        const meta = KIND_META[k];
        const active = k === value;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: `1px solid ${active ? meta.color : 'var(--border)'}`,
              background: active ? `${meta.color}26` : 'transparent',
              color: active ? meta.color : 'var(--text-secondary)',
            }}
          >
            <span>{meta.emoji}</span>{meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** Crossing-player vs all-players toggle (player-notify only). */
function AudienceToggle({ value, onChange }: { value: EventAudience; onChange: (a: EventAudience) => void }) {
  const opts: { v: EventAudience; label: string }[] = [
    { v: 'crossing-player', label: 'Crossing player' },
    { v: 'all-players', label: 'All players' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          className={value === o.v ? 'btn' : 'btn btn--ghost'}
          style={{ flex: 1, padding: '8px 12px' }}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Slim placement modal — new checkpoints only (name + icon + radius). */
function NewCheckpointModal({
  gameId, coord, existingCount, onClose,
}: {
  gameId: string;
  coord: { latitude: number; longitude: number };
  existingCount: number;
  onClose: (andConfigure?: string) => void;
}) {
  const [name, setName] = useState(`Checkpoint ${existingCount + 1}`);
  const [radius, setRadius] = useState('100');
  const [icon, setIcon] = useState(DEFAULT_CHECKPOINT_ICON);
  const [busy, setBusy] = useState(false);

  const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 } as const;

  async function save(andConfigure = false) {
    if (!name.trim()) { window.alert('Enter a checkpoint name'); return; }
    const r = parseInt(radius, 10);
    if (isNaN(r) || r < 10) { window.alert('Enter a valid radius (minimum 10m)'); return; }
    setBusy(true);
    try {
      const created = await addCheckpoint(gameId, {
        name: name.trim(), latitude: coord.latitude, longitude: coord.longitude, radius: r, icon,
      });
      onClose(andConfigure ? created.id : undefined);
    } catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  return (
    <Modal title="New Checkpoint" onClose={() => onClose()}>
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
      <div>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Map icon</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(CHECKPOINT_ICON_EMOJIS).map(([key, emoji]) => (
            <button
              key={key}
              type="button"
              onClick={() => setIcon(key)}
              title={key}
              style={{
                width: 40, height: 40, borderRadius: 8, fontSize: 18, cursor: 'pointer',
                border: `1px solid ${key === icon ? 'var(--primary)' : 'var(--border)'}`,
                background: key === icon ? 'rgba(212,137,63,0.15)' : 'transparent',
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
      <button className="btn btn--block" onClick={() => save(true)} disabled={busy}>Add &amp; configure</button>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={() => onClose()} disabled={busy}>Cancel</button>
        <button className="btn btn--secondary" style={{ flex: 1 }} onClick={() => save(false)} disabled={busy}>Just add</button>
      </div>
    </Modal>
  );
}

/** Full-screen behavior editor for an existing checkpoint — mirrors the mobile checkpoint/[checkpointId].tsx. */
function CheckpointBehaviorModal({
  gameId, cp, onClose,
}: {
  gameId: string;
  cp: Checkpoint;
  onClose: () => void;
}) {
  const { checkpoints: liveCheckpoints, members } = useGame();
  const liveCp = liveCheckpoints.find((c) => c.id === cp.id) ?? cp;
  const players = members.filter((m) => m.role === 'player');

  const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 } as const;

  // Placement fields (also editable here, mirroring mobile's full-screen editor).
  const [name, setName] = useState(liveCp.name);
  const [radius, setRadius] = useState(String(liveCp.radius));
  const [icon, setIcon] = useState(liveCp.icon ?? DEFAULT_CHECKPOINT_ICON);

  // Behavior mode: static (same all game) vs scheduled (changes over time, #54).
  const hasTransitions = (liveCp.transitions?.length ?? 0) > 0;
  const [behaviorMode, setBehaviorMode] = useState<'static' | 'scheduled'>(hasTransitions ? 'scheduled' : 'static');

  // Static behavior
  const hasQueue = (liveCp.eventQueue?.length ?? 0) > 0;
  const [mode, setMode] = useState<'single' | 'queue'>(hasQueue ? 'queue' : 'single');
  const [kind, setKind] = useState<CheckpointKind>(liveCp.event?.kind ?? 'gm-only');
  const [message, setMessage] = useState(liveCp.event?.message ?? '');
  const [audience, setAudience] = useState<EventAudience>(liveCp.event?.audience ?? 'crossing-player');
  const [queue, setQueue] = useState<CheckpointEvent[]>(liveCp.eventQueue ?? []);

  // Scheduled behavior (#54)
  const [initialState, setInitialState] = useState<CheckpointState>(liveCp.initialState ?? 'closed');
  const [initialMessage, setInitialMessage] = useState('');
  const [transitions, setTransitions] = useState<CheckpointTransition[]>(
    [...(liveCp.transitions ?? [])].sort((a, b) => a.atMinute - b.atMinute)
  );

  // Visibility / reveal (#48)
  const [visibility, setVisibility] = useState<CheckpointVisibility>(liveCp.visibility ?? 'gm-only');
  const [revealTrigger, setRevealTrigger] = useState<RevealTrigger>(liveCp.reveal?.trigger ?? 'on-crossing');
  const [revealAudience, setRevealAudience] = useState<RevealAudience>(liveCp.reveal?.audience ?? 'all');
  const [revealOffset, setRevealOffset] = useState(liveCp.reveal?.offsetMinutes != null ? String(liveCp.reveal.offsetMinutes) : '');
  const [recipients, setRecipients] = useState<string[]>(liveCp.reveal?.recipientPlayerIds ?? []);
  const toggleRecipient = (id: string) =>
    setRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const [busy, setBusy] = useState(false);

  const updateQueueItem = (i: number, patch: Partial<CheckpointEvent>) =>
    setQueue((q) => q.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  const addQueueItem = () => setQueue((q) => [...q, { kind: 'hazard' }]);
  const removeQueueItem = (i: number) => setQueue((q) => q.filter((_, idx) => idx !== i));

  function addTransition() {
    const lastMin = transitions.length > 0 ? transitions[transitions.length - 1].atMinute + 30 : 30;
    setTransitions((t) => [...t, { atMinute: lastMin, state: 'boon' }]);
  }
  function updateTransition(i: number, patch: Partial<CheckpointTransition>) {
    setTransitions((t) => t.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function removeTransition(i: number) {
    setTransitions((t) => t.filter((_, idx) => idx !== i));
  }

  function buildReveal(): CheckpointReveal | undefined {
    if (visibility !== 'on-reveal') return undefined;
    const aud: RevealAudience = revealTrigger === 'on-crossing' ? 'triggerer' : revealAudience;
    const reveal: CheckpointReveal = { trigger: revealTrigger, audience: aud };
    if (revealTrigger === 'game-time') reveal.offsetMinutes = Math.max(0, Math.round(Number(revealOffset) || 0));
    if (aud === 'specific-players') reveal.recipientPlayerIds = recipients;
    return reveal;
  }

  async function save() {
    if (!name.trim()) { window.alert('Enter a checkpoint name'); return; }
    const r = parseInt(radius, 10);
    if (isNaN(r) || r < 10) { window.alert('Enter a valid radius (minimum 10m)'); return; }

    const reveal = buildReveal();
    if (visibility === 'on-reveal' && reveal?.audience === 'specific-players' && recipients.length === 0) {
      window.alert('Pick at least one player for a sponsor drop, or choose "All players".');
      return;
    }
    const revealOffsetMins = visibility === 'on-reveal' && revealTrigger === 'game-time'
      ? Math.max(0, Math.round(Number(revealOffset) || 0))
      : null;

    const updates: Record<string, unknown> = {
      name: name.trim(),
      radius: r,
      icon,
      visibility,
      reveal: reveal ?? deleteField(),
    };

    if (behaviorMode === 'scheduled') {
      if (transitions.length === 0) { window.alert('Add at least one timed change, or switch to "Same all game".'); return; }
      const cleaned = [...transitions].sort((a, b) => a.atMinute - b.atMinute)
        .map((t) => ({ atMinute: t.atMinute, state: t.state, ...(t.message ? { message: t.message } : {}) }));
      updates.initialState = initialState;
      updates.transitions = cleaned;
      updates.eventQueue = deleteField();
      // Make the initial state effective immediately (sweep handles later transitions).
      Object.assign(updates, stateEventFields(initialState, initialMessage.trim() || undefined));
    } else {
      updates.transitions = deleteField();
      updates.initialState = deleteField();
      updates.currentState = deleteField();
      let event: CheckpointEvent | undefined;
      let eventQueue: CheckpointEvent[] | undefined;
      if (mode === 'queue') {
        if (queue.length === 0) { window.alert('Add at least one step, or switch to "Same for everyone".'); return; }
        eventQueue = queue.map((e) => buildEvent(e.kind, e.message ?? '', e.audience ?? 'crossing-player'));
      } else {
        event = buildEvent(kind, message, audience);
      }
      updates.event = eventQueue ? deleteField() : event;
      updates.eventQueue = eventQueue ?? deleteField();
    }

    setBusy(true);
    try {
      await updateCheckpoint(gameId, cp.id, updates as Partial<Omit<Checkpoint, 'id'>>);
      await setRevealSchedule(gameId, cp.id, revealOffsetMins);
      onClose();
    } catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete "${liveCp.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteCheckpoint(gameId, cp.id); onClose(); }
    catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  async function revealNow() {
    try {
      await revealCheckpointNow(gameId, liveCp);
      window.alert(`${liveCp.name} is now visible to players.`);
    } catch (err) { window.alert(friendlyError(err)); }
  }

  const windowState = checkpointWindowState(liveCp);
  const windowStatusText = { always: 'Always live — fires whenever a player crosses.', open: 'Open — firing now.', pending: 'Scheduled — not open yet.', closed: 'Closed — not firing.' }[windowState];
  async function windowAction(action: 'open' | 'close' | 'clear') {
    try {
      if (action === 'open') await openCheckpointNow(gameId, cp.id);
      else if (action === 'close') await closeCheckpointNow(gameId, cp.id);
      else await clearCheckpointWindow(gameId, cp.id);
    } catch (err) { window.alert(friendlyError(err)); }
  }

  return (
    <Modal title={`${liveCp.name} — Configure`} onClose={onClose}>
      {/* Placement */}
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        📍 {liveCp.latitude.toFixed(5)}, {liveCp.longitude.toFixed(5)}
      </div>
      <div className="field">
        <label>Name</label>
        <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Detection Radius (meters)</label>
        <input className="input" type="number" value={radius} onChange={(e) => setRadius(e.target.value)} />
      </div>
      <div>
        <div style={{ ...labelStyle, marginBottom: 8 }}>Map icon</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {Object.entries(CHECKPOINT_ICON_EMOJIS).map(([key, emoji]) => (
            <button
              key={key}
              type="button"
              onClick={() => setIcon(key)}
              title={key}
              style={{
                width: 40, height: 40, borderRadius: 8, fontSize: 18, cursor: 'pointer',
                border: `1px solid ${key === icon ? 'var(--primary)' : 'var(--border)'}`,
                background: key === icon ? 'rgba(212,137,63,0.15)' : 'transparent',
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Behavior mode */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={labelStyle}>What happens here?</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={behaviorMode === 'static' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 12px' }} onClick={() => setBehaviorMode('static')}>Same all game</button>
          <button type="button" className={behaviorMode === 'scheduled' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 12px' }} onClick={() => setBehaviorMode('scheduled')}>Changes over time</button>
        </div>

        {behaviorMode === 'static' ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className={mode === 'single' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }} onClick={() => setMode('single')}>Same for everyone</button>
              <button type="button" className={mode === 'queue' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px', fontSize: 13 }} onClick={() => setMode('queue')}>By arrival order</button>
            </div>
            {mode === 'single' ? (
              <>
                <KindChips value={kind} onChange={setKind} />
                {kind !== 'gm-only' && <textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={KIND_META[kind].placeholder} style={{ resize: 'vertical' }} />}
                {kind === 'player-notify' && <AudienceToggle value={audience} onChange={setAudience} />}
                {kind === 'gm-only' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only you (the GM) are alerted. The player sees nothing.</span>}
              </>
            ) : (
              <>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Each arriver, in order, triggers the next step. Once the steps run out, later arrivers just ping you.</span>
                {queue.map((e, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: 13 }}>{ordinalLabel(i)}</strong>
                      <button type="button" onClick={() => removeQueueItem(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
                    </div>
                    <KindChips value={e.kind} onChange={(k) => updateQueueItem(i, { kind: k })} />
                    {e.kind !== 'gm-only' && <textarea className="input" rows={2} value={e.message ?? ''} onChange={(ev) => updateQueueItem(i, { message: ev.target.value })} placeholder={KIND_META[e.kind].placeholder} style={{ resize: 'vertical' }} />}
                    {e.kind === 'player-notify' && <AudienceToggle value={e.audience ?? 'crossing-player'} onChange={(a) => updateQueueItem(i, { audience: a })} />}
                  </div>
                ))}
                <button type="button" className="btn btn--ghost" onClick={addQueueItem}>+ Add step</button>
              </>
            )}
          </>
        ) : (
          // Scheduled / time-based transitions (#54)
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              The checkpoint starts in one state and flips at set times after Start. A "Closed" state is hidden and won't fire.
            </span>
            <div>
              <span style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>Starts as</span>
              <StateChips value={initialState} onChange={setInitialState} />
              {initialState !== 'closed' && (
                <input
                  className="input"
                  value={initialMessage}
                  onChange={(e) => setInitialMessage(e.target.value)}
                  placeholder="Optional message"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
            <div>
              <span style={{ ...labelStyle, display: 'block', marginBottom: 6 }}>Then changes</span>
              {transitions.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No timed changes yet.</span>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {transitions.map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input
                        className="input"
                        type="number"
                        value={t.atMinute}
                        onChange={(e) => updateTransition(i, { atMinute: Math.max(1, Number(e.target.value)) })}
                        style={{ width: 64, padding: '4px 8px' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>min →</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {STATE_ORDER.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateTransition(i, { state: s })}
                          style={{
                            padding: '4px 8px', borderRadius: 12, fontSize: 12, cursor: 'pointer',
                            border: `1px solid ${t.state === s ? STATE_META[s].color : 'var(--border)'}`,
                            background: t.state === s ? `${STATE_META[s].color}26` : 'transparent',
                            color: t.state === s ? STATE_META[s].color : 'var(--text-secondary)',
                          }}
                        >
                          {STATE_META[s].emoji} {STATE_META[s].label}
                        </button>
                      ))}
                    </div>
                    {t.state !== 'closed' && (
                      <input
                        className="input"
                        value={t.message ?? ''}
                        onChange={(e) => updateTransition(i, { message: e.target.value })}
                        placeholder="Message (optional)"
                        style={{ flex: 1, minWidth: 120, padding: '4px 8px' }}
                      />
                    )}
                    <button type="button" onClick={() => removeTransition(i)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '2px 4px' }}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn--ghost" style={{ marginTop: 8 }} onClick={addTransition}>+ Add timed change</button>
            </div>
          </>
        )}
      </div>

      {/* Player visibility (#48) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Player visibility</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {VIS_ORDER.map((v) => {
            const active = v === visibility;
            return (
              <button key={v} type="button" onClick={() => setVisibility(v)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 600, border: `1px solid ${active ? 'var(--secondary)' : 'var(--border)'}`, background: active ? 'rgba(90,126,78,0.18)' : 'transparent', color: active ? 'var(--secondary)' : 'var(--text-secondary)' }}>
                <span>{VIS_META[v].emoji}</span>{VIS_META[v].label}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{VIS_META[visibility].hint}</span>
        {visibility === 'on-reveal' && (
          <>
            <span style={labelStyle}>Reveal when</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([{ v: 'on-crossing', label: 'On crossing' }, { v: 'game-time', label: 'At a set time' }, { v: 'gm-manual', label: 'When I tap' }] as { v: RevealTrigger; label: string }[]).map((o) => (
                <button key={o.v} type="button" className={revealTrigger === o.v ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px', fontSize: 12 }} onClick={() => setRevealTrigger(o.v)}>{o.label}</button>
              ))}
            </div>
            {revealTrigger === 'on-crossing' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Becomes visible to the player who crosses it (a trap they now know).</span>}
            {revealTrigger === 'game-time' && (
              <div className="field">
                <label>Minutes after start</label>
                <input className="input" type="number" value={revealOffset} onChange={(e) => setRevealOffset(e.target.value)} placeholder="e.g. 60" />
              </div>
            )}
            {revealTrigger !== 'on-crossing' && (
              <>
                <span style={labelStyle}>Reveal to</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([{ v: 'all', label: 'All players' }, { v: 'specific-players', label: 'Specific players' }] as { v: RevealAudience; label: string }[]).map((o) => (
                    <button key={o.v} type="button" className={revealAudience === o.v ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px', fontSize: 12 }} onClick={() => setRevealAudience(o.v)}>{o.label}</button>
                  ))}
                </div>
                {revealAudience === 'specific-players' && (
                  players.length === 0
                    ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No players have joined yet — they'll appear here once they do.</span>
                    : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                        {players.map((p) => (
                          <label key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 6px' }}>
                            <input type="checkbox" checked={recipients.includes(p.userId)} onChange={() => toggleRecipient(p.userId)} />
                            <span>{p.displayName}</span>
                          </label>
                        ))}
                      </div>
                    )
                )}
              </>
            )}
            {revealTrigger === 'gm-manual' && (
              <button type="button" className="btn btn--secondary" onClick={revealNow}>
                {liveCp.revealedAt ? 'Revealed — reveal again' : 'Reveal now'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Timed site window — only for static checkpoints; scheduled ones own the window via stateEventFields */}
      {behaviorMode === 'static' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Timed site window</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{windowStatusText}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={windowState === 'open' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px' }} onClick={() => windowAction('open')}>Open now</button>
            <button type="button" className={windowState === 'closed' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px' }} onClick={() => windowAction('close')}>Close now</button>
            <button type="button" className={windowState === 'always' ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px' }} onClick={() => windowAction('clear')}>Always live</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>Save</button>
      </div>
      <button className="btn btn--danger" onClick={remove} disabled={busy}>Delete checkpoint</button>
    </Modal>
  );
}

function StateChips({ value, onChange }: { value: CheckpointState; onChange: (s: CheckpointState) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {STATE_ORDER.map((s) => {
        const meta = STATE_META[s];
        const active = s === value;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20,
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              border: `1px solid ${active ? meta.color : 'var(--border)'}`,
              background: active ? `${meta.color}26` : 'transparent',
              color: active ? meta.color : 'var(--text-secondary)',
            }}
          >
            <span>{meta.emoji}</span>{meta.label}
          </button>
        );
      })}
    </div>
  );
}

/** "1st arriver", "2nd arriver", … for the arrival-order queue rows. */
function ordinalLabel(i: number): string {
  const n = i + 1;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix} arriver`;
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

// --- Run-sheet (#11) ---
type RunAction = {
  key: string;
  type: ScheduledActionType;
  template?: 'player-count';
  label: string;
  needs: 'message' | 'checkpoint' | 'none';
};
const RUN_ACTIONS: RunAction[] = [
  { key: 'broadcast', type: 'broadcast', label: 'Announcement', needs: 'message' },
  { key: 'player-count', type: 'broadcast', template: 'player-count', label: 'Player count', needs: 'none' },
  { key: 'gear-drop', type: 'gear-drop', label: 'Gear drop', needs: 'message' },
  { key: 'gm-reminder', type: 'gm-reminder', label: 'GM reminder', needs: 'message' },
  { key: 'open-site', type: 'open-site', label: 'Open site', needs: 'checkpoint' },
  { key: 'close-site', type: 'close-site', label: 'Close site', needs: 'checkpoint' },
  { key: 'reveal-checkpoint', type: 'reveal-checkpoint', label: 'Reveal marker', needs: 'checkpoint' },
];
const runActionFor = (key: string) => RUN_ACTIONS.find((a) => a.key === key)!;
const runKeyForEvent = (ev: ScheduledEvent) => (ev.template === 'player-count' ? 'player-count' : ev.type);

function RunSheetModal({
  gameId, events, checkpoints, onClose,
}: {
  gameId: string;
  events: ScheduledEvent[];
  checkpoints: Checkpoint[];
  onClose: () => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState('broadcast');
  const [offset, setOffset] = useState('0');
  const [message, setMessage] = useState('');
  const [checkpointId, setCheckpointId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [behaviorCheckpointId, setBehaviorCheckpointId] = useState<string | null>(null);
  const action = runActionFor(actionKey);

  function reset() {
    setEditId(null); setActionKey('broadcast'); setOffset('0'); setMessage(''); setCheckpointId(undefined);
  }
  function startEdit(ev: ScheduledEvent) {
    setEditId(ev.id);
    setActionKey(runKeyForEvent(ev));
    setOffset(ev.offsetMinutes != null ? String(ev.offsetMinutes) : '0');
    setMessage(ev.message ?? '');
    setCheckpointId(ev.checkpointId);
  }
  async function save() {
    const offsetMinutes = parseInt(offset, 10);
    if (isNaN(offsetMinutes) || offsetMinutes < 0) { window.alert('Enter minutes after game start (0 or more).'); return; }
    if (action.needs === 'message' && !message.trim()) { window.alert('Enter a message for this action.'); return; }
    if (action.needs === 'checkpoint' && !checkpointId) { window.alert('Pick a checkpoint for this action.'); return; }
    const data = {
      type: action.type,
      offsetMinutes,
      template: action.template ?? null,
      message: action.needs === 'message' ? message.trim() : '',
      ...(action.needs === 'checkpoint' ? { checkpointId } : {}),
    };
    setBusy(true);
    try {
      if (editId) await updateScheduledEvent(gameId, editId, data);
      else await addScheduledEvent(gameId, data);
      reset();
    } catch (err) { window.alert(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function remove(ev: ScheduledEvent) {
    if (!window.confirm('Delete this run-sheet action?')) return;
    try { await deleteScheduledEvent(gameId, ev.id); if (editId === ev.id) reset(); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  function summary(ev: ScheduledEvent): string {
    const a = runActionFor(runKeyForEvent(ev));
    if (a.needs === 'checkpoint') {
      const cp = checkpoints.find((c) => c.id === ev.checkpointId);
      return `${a.label} · ${cp?.name ?? 'deleted checkpoint'}`;
    }
    if (a.key === 'player-count') return 'Pushes the living-tribute count to all players';
    return ev.message || a.label;
  }
  const sorted = [...events].sort((a, b) => (a.offsetMinutes ?? Infinity) - (b.offsetMinutes ?? Infinity));

  const behaviorCp = behaviorCheckpointId ? checkpoints.find((c) => c.id === behaviorCheckpointId) ?? null : null;

  if (behaviorCp) {
    return (
      <CheckpointBehaviorModal
        gameId={gameId}
        cp={behaviorCp}
        onClose={() => setBehaviorCheckpointId(null)}
      />
    );
  }

  return (
    <Modal title="Run-sheet" onClose={onClose}>
      {/* Checkpoint hub — mirrors mobile runsheet.tsx */}
      {checkpoints.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Checkpoints</span>
          {checkpoints.map((cp) => (
            <button
              key={cp.id}
              type="button"
              onClick={() => setBehaviorCheckpointId(cp.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--card)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
            >
              <span style={{ fontSize: 20 }}>{checkpointIconEmoji(cp.icon)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{cp.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{behaviorSummary(cp)}</div>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ borderTop: checkpoints.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: checkpoints.length > 0 ? 12 : 0 }}>
        <p style={{ margin: '0 0 8px', color: 'var(--text-secondary)', fontSize: 13 }}>
          Timed actions fire automatically, measured from when you Start the game. They run only while the game is in play.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
        {sorted.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>No timed actions yet.</span>}
        {sorted.map((ev) => {
          const a = runActionFor(runKeyForEvent(ev));
          const fired = ev.firedAt != null;
          return (
            <div key={ev.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', opacity: fired ? 0.6 : 1 }}>
              <strong style={{ width: 56, fontVariant: 'tabular-nums' }}>{ev.offsetMinutes === 0 ? 'Start' : `+${ev.offsetMinutes}m`}</strong>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{a.label}{fired ? ' · fired' : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary(ev)}</div>
              </div>
              <button className="btn btn--ghost" style={{ padding: '4px 8px', fontSize: 12 }} onClick={() => startEdit(ev)}>Edit</button>
              <button className="btn btn--ghost" style={{ padding: '4px 8px', fontSize: 12, color: 'var(--danger)' }} onClick={() => remove(ev)}>Delete</button>
            </div>
          );
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <strong style={{ fontSize: 13 }}>{editId ? 'Edit action' : 'Add action'}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {RUN_ACTIONS.map((a) => (
            <button key={a.key} type="button" className={a.key === actionKey ? 'btn' : 'btn btn--ghost'} style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setActionKey(a.key)}>{a.label}</button>
          ))}
        </div>
        <div className="field">
          <label>Minutes after game start</label>
          <input className="input" type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
        </div>
        {action.needs === 'message' && (
          <textarea
            className="input"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={action.key === 'gm-reminder' ? 'e.g. Send Aaron to The Dock now' : action.key === 'gear-drop' ? 'e.g. A supply drop is at Trestle Bridge' : 'e.g. The storm is closing in — head for high ground'}
            style={{ resize: 'vertical' }}
          />
        )}
        {action.key === 'player-count' && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Auto-fills the living-tribute count and pushes it to all players.</span>
        )}
        {action.key === 'gm-reminder' && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only you (the GM) are notified — players see nothing.</span>
        )}
        {action.needs === 'checkpoint' && (
          checkpoints.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No checkpoints yet — add one on the map first.</span>
          ) : (
            <select className="input" value={checkpointId ?? ''} onChange={(e) => setCheckpointId(e.target.value || undefined)}>
              <option value="">Select checkpoint…</option>
              {checkpoints.map((cp) => <option key={cp.id} value={cp.id}>{cp.name}</option>)}
            </select>
          )
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {editId && <button className="btn btn--ghost" style={{ flex: 1 }} onClick={reset}>Cancel edit</button>}
          <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>{editId ? 'Save action' : 'Add action'}</button>
        </div>
      </div>
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
  checkpoints, playerLocations, deathMarkers, boundary, arrivals, members, busy,
  rationsEnabled, pendingRations, onOpenRations,
  onBroadcast, onAckSos, onClearSos, onOpenPlayers, onEnd,
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
  arrivals: Arrival[];
  members: GameMember[];
  busy: boolean;
  rationsEnabled: boolean;
  pendingRations: number;
  onOpenRations: () => void;
  onBroadcast: () => void;
  onAckSos: (userId: string) => void;
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

        {/* Safety alerts — most urgent, surfaced first. Unacked is the live, escalating
            state (#5); acknowledging stops the escalation but keeps it open until cleared. */}
        {sosPlayers.map((p) => {
          const acked = !!p.sosAckAt;
          return (
            <div key={p.userId} className="card" style={{ borderColor: acked ? 'var(--warning, #D4893F)' : 'var(--danger)', background: acked ? 'rgba(212,137,63,0.1)' : 'rgba(232,64,42,0.1)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🆘</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: acked ? 'var(--warning, #D4893F)' : 'var(--danger)' }}>
                  {p.displayName} {acked ? 'needs assistance (acknowledged)' : 'needs assistance'}
                </div>
              </div>
              {!acked && (
                <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => onAckSos(p.userId)}>Acknowledge</button>
              )}
              <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => onClearSos(p.userId)}>Clear</button>
            </div>
          );
        })}

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

        {rationsEnabled && (
          <button
            className="btn btn--ghost"
            onClick={onOpenRations}
            style={pendingRations > 0 ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}
          >
            🍽 Ration review{pendingRations > 0 ? ` (${pendingRations} pending)` : ''}
          </button>
        )}

        <h3 style={{ margin: '4px 0 0' }}>Notifications</h3>
        <div style={{ flex: 1, minHeight: 0 }}>
          <NotificationFeed arrivals={arrivals} checkpoints={checkpoints} members={members} />
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
  // A game must always keep ≥ 1 GM (#50): true when m is the only GM.
  const isLastGM = (m: GameMember) =>
    m.role === 'gm' && members.filter((x) => x.role === 'gm').length <= 1;

  async function toggleRole(m: GameMember) {
    const newRole = m.role === 'player' ? 'gm' : 'player';
    if (newRole === 'player' && isLastGM(m)) {
      window.alert(`Can't demote the last GM. Promote another player to GM first — every game needs at least one Game Master.`);
      return;
    }
    const label = newRole === 'gm' ? 'Promote to GM' : 'Demote to Player';
    if (!window.confirm(`${label}? ${m.displayName} will ${newRole === 'gm' ? 'gain GM access and see all player locations.' : 'lose GM access.'}`)) return;
    try { await updateMemberRole(gameId, m.userId, newRole); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function remove(m: GameMember) {
    if (isLastGM(m)) {
      window.alert(`Can't remove the last GM. Promote another player to GM first — every game needs at least one Game Master.`);
      return;
    }
    if (!window.confirm(`Remove ${m.displayName}? They'll be removed and their location will no longer be tracked.`)) return;
    try { await removePlayer(gameId, m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function message(m: GameMember) {
    // Targeted GM→player message (#49): a gm-message broadcast scoped to this player.
    const text = window.prompt(`Private message to ${m.displayName} (only they see it):`);
    if (text == null || !text.trim()) return;
    try { await sendBroadcast(gameId, text.trim(), m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function eliminate(m: GameMember) {
    if (!window.confirm(`Eliminate ${m.displayName}? Everyone is notified, and if they're the last one standing the survivor wins.`)) return;
    try { await eliminatePlayer(gameId, m.userId, 'gm-other'); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function acknowledgeSos(m: GameMember) {
    try { await ackSos(gameId, m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function dismissSos(m: GameMember) {
    try { await clearSos(gameId, m.userId); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  async function setDistrict(m: GameMember) {
    const next = window.prompt(
      `District for ${m.displayName}? Tributes who share a district are paired (a trap is withheld if both arrive together). Leave blank to clear.`,
      m.district != null ? String(m.district) : ''
    );
    if (next == null) return; // cancelled
    try { await setMemberDistrict(gameId, m.userId, next); }
    catch (err) { window.alert(friendlyError(err)); }
  }
  // Tributes sharing a district sit adjacent; unassigned ('~') sort last. Numeric
  // collation keeps "2" before "10".
  const districtKey = (m: GameMember) =>
    m.district != null && String(m.district).trim() !== '' ? String(m.district).trim() : '~';
  const gms = members.filter((m) => m.role === 'gm');
  const players = members
    .filter((m) => m.role === 'player')
    .sort((a, b) => {
      const ka = districtKey(a);
      const kb = districtKey(b);
      if (ka !== kb) return ka.localeCompare(kb, undefined, { numeric: true });
      return a.displayName.localeCompare(b.displayName);
    });
  const alive = players.filter((m) => !m.out).length;
  const districtCount = new Set(players.map(districtKey).filter((k) => k !== '~')).size;
  return (
    <Modal title={`Players (${players.length})`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {players.length} player{players.length !== 1 ? 's' : ''} · {alive} alive{districtCount > 0 ? ` · ${districtCount} district${districtCount !== 1 ? 's' : ''}` : ''}
      </div>
      {/* GM count kept on its own line, separate from the player counts (GM-only dashboard). */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, var(--text-secondary))' }}>
        Staff: {gms.length} GM{gms.length !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 380, overflowY: 'auto' }}>
        {members.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No members yet.</p>}
        {[...gms, ...players].map((m) => {
          const isGM = m.role === 'gm';
          const isOut = !!m.out;
          const hasDistrict = m.district != null && String(m.district).trim() !== '';
          const showFix = !isGM && !isOut && phase === 'play';
          const fixMs = lastFixByUser.get(m.userId) ?? null;
          const level = showFix ? stalenessLevel(fixMs == null ? null : now - fixMs) : 'none';
          return (
            <div key={m.userId} className="card" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderColor: m.sos ? (m.sosAckAt ? 'var(--warning, #D4893F)' : 'var(--danger)') : undefined, background: m.sos ? (m.sosAckAt ? 'rgba(212,137,63,0.08)' : 'rgba(232,64,42,0.08)') : undefined }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, textDecoration: isOut ? 'line-through' : undefined, color: isOut ? 'var(--text-secondary)' : undefined }}>{m.displayName}</span>
                  {!isGM && (
                    <button
                      onClick={() => setDistrict(m)}
                      title="Set district"
                      style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, cursor: 'pointer',
                        border: hasDistrict ? '1px solid rgba(90,126,78,0.6)' : '1px dashed var(--border)',
                        background: hasDistrict ? 'rgba(90,126,78,0.15)' : 'transparent',
                        color: hasDistrict ? undefined : 'var(--text-secondary)',
                      }}
                    >
                      {hasDistrict ? `District ${m.district}` : '+ District'}
                    </button>
                  )}
                </div>
                {m.sos ? (
                  <div style={{ fontSize: 12, color: m.sosAckAt ? 'var(--warning, #D4893F)' : 'var(--danger)', fontWeight: 600 }}>
                    {m.sosAckAt ? '🆘 Acknowledged · stand down when resolved' : '🆘 Needs assistance'}
                  </div>
                ) : !isGM && !isOut && m.outOfBounds ? (
                  <div style={{ fontSize: 12, color: 'var(--warning, #D4893F)', fontWeight: 600 }}>🚧 Outside the play area</div>
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
              {m.sos && !m.sosAckAt && (
                <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => acknowledgeSos(m)}>Acknowledge</button>
              )}
              {m.sos && (
                <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => dismissSos(m)}>Clear SOS</button>
              )}
              {!isGM && (
                <button className="btn btn--ghost" style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => message(m)}>Message</button>
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

function GmMessagesModal({
  gameId, senderName, onClose,
}: {
  gameId: string;
  senderName: string;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Broadcast[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeGmMessages(gameId, setMessages), [gameId]);

  async function send() {
    const msg = text.trim();
    if (!msg) return;
    setBusy(true);
    try { await sendGmMessage(gameId, msg, senderName); setText(''); }
    catch (err) { window.alert(friendlyError(err)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Co-GM messages" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        Private channel between Game Masters — players never see these.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', padding: '4px 0' }}>
        {messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
            No messages yet. Coordinate with your co-GMs here.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="card" style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--secondary, #5A7E4E)', marginBottom: 2 }}>
                {m.senderName ?? 'GM'} · {m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '…'}
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.4 }}>{m.message}</div>
            </div>
          ))
        )}
      </div>
      <textarea
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Message your co-GMs…"
        style={{ resize: 'vertical' }}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
        <button className="btn" style={{ flex: 1 }} onClick={send} disabled={busy}>Send</button>
      </div>
    </Modal>
  );
}

function ConfigModal({
  gameId, initial, gameDateInitial, onClose,
}: {
  gameId: string;
  initial: ReturnType<typeof gameConfig>;
  gameDateInitial: FsTimestamp | null;
  onClose: () => void;
}) {
  const [duration, setDuration] = useState(String(initial.durationMinutes));
  const [gameDate, setGameDate] = useState(formatEventDate(gameDateInitial)); // 'YYYY-MM-DD' (#36)
  const [playerCount, setPlayerCount] = useState(initial.playerCountBroadcast);
  const [winner, setWinner] = useState(initial.winnerDetection);
  const [battery, setBattery] = useState(initial.batterySaver);
  const [rations, setRations] = useState(initial.rationsEnabled);
  const [rationMinutes, setRationMinutes] = useState(String(initial.rationIntervalMinutes));
  const [rationWindow, setRationWindow] = useState(String(initial.rationWindowMinutes));
  const [uniqueCards, setUniqueCards] = useState(initial.enforceUniqueRationCards);
  const [busy, setBusy] = useState(false);

  async function save() {
    const minutes = Math.max(5, Math.round(Number(duration) || initial.durationMinutes));
    const rationMins = Math.max(1, Math.round(Number(rationMinutes) || initial.rationIntervalMinutes));
    // Open window can't exceed the interval (clamped); blank/0 falls back to the default.
    const rationWindowMins = Math.min(
      rationMins,
      Math.max(1, Math.round(Number(rationWindow) || initial.rationWindowMinutes))
    );
    setBusy(true);
    try {
      await updateGameConfig(gameId, {
        gameDate: parseEventDate(gameDate), // valid date or null to clear (#36)
        config: {
          durationMinutes: minutes,
          playerCountBroadcast: playerCount,
          winnerDetection: winner,
          batterySaver: battery,
          rationsEnabled: rations,
          rationIntervalMinutes: rationMins,
          rationWindowMinutes: rationWindowMins,
          enforceUniqueRationCards: uniqueCards,
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
      <div className="field">
        <label>Event date (optional)</label>
        <input className="input" type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          The day you're running this game. Sorts it in My Games; leave blank to use the created date.
        </span>
      </div>
      <Toggle label="Auto player-count updates" checked={playerCount} onChange={setPlayerCount} />
      <Toggle label="Declare a winner" checked={winner} onChange={setWinner} />
      <Toggle label="Battery saver" checked={battery} onChange={setBattery} />
      <Toggle label="Ration check" checked={rations} onChange={setRations} />
      {rations && (
        <>
          <div className="field">
            <label>Ration interval (minutes)</label>
            <input className="input" type="number" value={rationMinutes} onChange={(e) => setRationMinutes(e.target.value)} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>How often players must submit a ration card</span>
          </div>
          <div className="field">
            <label>Open window (minutes)</label>
            <input className="input" type="number" value={rationWindow} onChange={(e) => setRationWindow(e.target.value)} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              How long the card window stays open before each interval ends — players are alerted when
              it opens. Capped at the interval length.
            </span>
          </div>
          <Toggle label="Unique ration cards" checked={uniqueCards} onChange={setUniqueCards} />
        </>
      )}
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

// --- Ration review (GM-only; web mirrors the mobile review screen) ---

function RationsModal({
  gameId, rations, members, currentIndex, totalWindows, enforceUnique, onClose,
}: {
  gameId: string;
  rations: RationSubmission[];
  members: GameMember[];
  currentIndex: number | null;
  totalWindows: number | null;
  enforceUnique: boolean;
  onClose: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Card numbers in use (valid or pending) → the uniqueness flag (Rule 6).
  const cardCounts = new Map<string, number>();
  for (const r of rations) {
    const c = r.cardNumber?.trim();
    if (c && r.status !== 'rejected') cardCounts.set(c, (cardCounts.get(c) ?? 0) + 1);
  }

  const rank = (s: RationSubmission['status']) => (s === 'pending' ? 0 : s === 'rejected' ? 1 : 2);
  const ordered = [...rations].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0)
  );

  const fed = new Set(
    rations
      .filter((r) => currentIndex != null && r.intervalIndex === currentIndex && r.status !== 'rejected')
      .map((r) => r.playerId)
  );
  const notEaten =
    currentIndex == null ? [] : members.filter((m) => m.role === 'player' && !m.out && !fed.has(m.userId));

  const pendingCount = rations.filter((r) => r.status === 'pending').length;

  async function review(r: RationSubmission, status: 'valid' | 'rejected') {
    setBusyId(r.id);
    try {
      await reviewRation(gameId, r.id, status);
    } catch (err) {
      window.alert(friendlyError(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal title="Ration review" onClose={onClose}>
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
        {pendingCount > 0 ? `${pendingCount} awaiting review` : 'All caught up'}
        {currentIndex != null ? ` · window ${currentIndex + 1}/${totalWindows ?? '—'}` : ''}
      </p>

      {notEaten.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--danger)', background: 'rgba(192,57,43,0.1)' }}>
          <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 14 }}>
            Not eaten this window ({notEaten.length})
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>{notEaten.map((m) => m.displayName).join(', ')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>
            Eliminate from the Players list if they miss the window (starvation).
          </div>
        </div>
      )}

      {ordered.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No ration cards submitted yet.</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ordered.map((r) => {
          const dup =
            enforceUnique &&
            !!r.cardNumber?.trim() &&
            (cardCounts.get(r.cardNumber.trim()) ?? 0) > 1 &&
            r.status !== 'rejected';
          return (
            <div key={r.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <img
                src={r.photoUrl}
                onClick={() => setLightbox(r.photoUrl)}
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', cursor: 'pointer', flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{r.playerName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Window {r.intervalIndex + 1}
                  {r.cardNumber ? ` · card #${r.cardNumber}` : ''}
                </div>
                {dup && <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>⚠ Card number reused</div>}
                {r.status === 'valid' && <div style={{ color: 'var(--success)', fontSize: 12, fontWeight: 600 }}>✓ Accepted</div>}
                {r.status === 'rejected' && <div style={{ color: 'var(--danger)', fontSize: 12, fontWeight: 600 }}>✕ Rejected</div>}
              </div>
              {r.status === 'pending' ? (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn--ghost" style={{ padding: '6px 10px' }} disabled={busyId === r.id} onClick={() => review(r, 'rejected')}>Reject</button>
                  <button className="btn" style={{ padding: '6px 10px' }} disabled={busyId === r.id} onClick={() => review(r, 'valid')}>Accept</button>
                </div>
              ) : (
                <button
                  className="btn btn--ghost"
                  style={{ padding: '6px 10px', flexShrink: 0 }}
                  disabled={busyId === r.id}
                  onClick={() => review(r, r.status === 'valid' ? 'rejected' : 'valid')}
                >
                  {r.status === 'valid' ? 'Reject' : 'Accept'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'grid', placeItems: 'center', zIndex: 60, cursor: 'zoom-out' }}
        >
          <img src={lightbox} style={{ maxWidth: '92%', maxHeight: '92%' }} />
        </div>
      )}
    </Modal>
  );
}
