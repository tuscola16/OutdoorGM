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
  addCheckpoint, updateCheckpoint, deleteCheckpoint,
  updateMemberRole, removePlayer, eliminatePlayer, clearSos, ackSos, sendBroadcast,
  deleteGame, setGameArchived, reviewRation, rationInterval, setMemberDistrict,
  revealCheckpointNow, setRevealSchedule, parseEventDate, formatEventDate,
  sendGmMessage, subscribeGmMessages,
} from '@/services/gameService';
import {
  KIND_META, checkpointKind, VIS_META, VIS_ORDER,
  behaviorSummary, CHECKPOINT_ICON_EMOJIS, DEFAULT_CHECKPOINT_ICON, checkpointIconEmoji,
} from '@/services/checkpointKinds';
import { validateGameConfig, requireMinInt } from '@shared/common/gameConfigValidation';
import { pointInBoundary } from '@shared/common/geo';
import { deleteField } from 'firebase/firestore';
import type {
  Arrival, Checkpoint, RunbookEntry, GameMember, MapBoundary, PlayerLocation, RationSubmission,
  CheckpointVisibility, RevealTrigger, RevealAudience, CheckpointReveal, FsTimestamp, Broadcast, EntryTrip,
} from '@shared/types';

const PHASE_LABEL: Record<string, string> = {
  setup: 'SETUP', lobby: 'LOBBY', play: 'IN PLAY', results: 'RESULTS',
};

export function GameScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { game, phase, checkpoints, runbookEntries, members, playerLocations, arrivals, rations, entryTrips, loadGame, clearGame } = useGame();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showCodes, setShowCodes] = useState(false);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showGmMessages, setShowGmMessages] = useState(false); // co-GM messaging (#40)
  const [showConfig, setShowConfig] = useState(false);
  const [showRations, setShowRations] = useState(false);
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
        {phase !== 'results' && (
          <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => navigate(`/games/${gameId}/runbook`)}>
            Runbook{runbookEntries.length ? ` (${runbookEntries.length})` : ''}
          </button>
        )}
        <button className="btn btn--ghost" style={{ padding: '8px 12px' }} onClick={() => setShowGmMessages(true)}>Co-GM</button>
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
            runbookEntries={runbookEntries}
            playerLocations={playerLocations}
            deathMarkers={deathMarkers}
            boundary={game?.boundary}
            arrivals={arrivals}
            entryTrips={entryTrips}
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
          windowOpen={rationInterval(game, now)?.isOpen ?? false}
          enforceUnique={gameConfig(game).enforceUniqueRationCards}
          onClose={() => setShowRations(false)}
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
  const { game, checkpoints, runbookEntries } = useGame();
  const navigate = useNavigate();
  const entriesByCp = new Map<string, RunbookEntry[]>();
  for (const e of runbookEntries) {
    const list = entriesByCp.get(e.checkpointId) ?? [];
    list.push(e);
    entriesByCp.set(e.checkpointId, list);
  }
  const cpEntries = (id: string): RunbookEntry[] => entriesByCp.get(id) ?? [];
  const [drawing, setDrawing] = useState(false); // rectangle drag
  const [drawingPoly, setDrawingPoly] = useState(false); // polygon draw/edit (#39)
  // Slim placement modal — new checkpoints only (name + icon + radius).
  const [newCpCoord, setNewCpCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  // Full behavior editor — for existing checkpoints.
  const [behaviorCheckpointId, setBehaviorCheckpointId] = useState<string | null>(null);
  const behaviorCp = checkpoints.find((c) => c.id === behaviorCheckpointId) ?? null;
  const [showRules, setShowRules] = useState(false);

  function handleMapClick(coord: { latitude: number; longitude: number }) {
    // #64: a checkpoint must sit inside the play area, or the geofence can never fire it.
    if (!game?.boundary) {
      window.alert('Draw the play boundary first — checkpoints must sit inside it.');
      return;
    }
    if (!pointInBoundary(coord.latitude, coord.longitude, game.boundary)) {
      window.alert('That spot is outside the play area. Place the checkpoint inside the boundary.');
      return;
    }
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
          runbookEntries={runbookEntries}
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
            Click the map to place a checkpoint. Click a name to set its visibility; author its behavior in the Runbook.
          </span>
          {checkpoints.map((cp) => {
            const meta = KIND_META[checkpointKind(cpEntries(cp.id))];
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
                    {behaviorSummary(cpEntries(cp.id))} · {cp.radius}m
                  </span>
                </button>
              </div>
            );
          })}
          {checkpoints.length > 0 && (
            <button className="btn btn--ghost" style={{ justifyContent: 'center' }} onClick={() => navigate(`/games/${gameId}/runbook`)}>
              Open Runbook editor →
            </button>
          )}
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

/** Placement + visibility editor for an existing checkpoint (#60). Behavior (runbook
 * entries) is authored on the standalone Runbook editor; this owns name/icon/radius +
 * who can see the marker, and links out to the Runbook. */
function CheckpointBehaviorModal({
  gameId, cp, onClose,
}: {
  gameId: string;
  cp: Checkpoint;
  onClose: () => void;
}) {
  const { checkpoints: liveCheckpoints, members, runbookEntries } = useGame();
  const navigate = useNavigate();
  const liveCp = liveCheckpoints.find((c) => c.id === cp.id) ?? cp;
  const players = members.filter((m) => m.role === 'player');
  const entryCount = runbookEntries.filter((e) => e.checkpointId === cp.id).length;

  const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 } as const;

  const [name, setName] = useState(liveCp.name);
  const [radius, setRadius] = useState(String(liveCp.radius));
  const [icon, setIcon] = useState(liveCp.icon ?? DEFAULT_CHECKPOINT_ICON);

  // Visibility / reveal (#60)
  const [visibility, setVisibility] = useState<CheckpointVisibility>(liveCp.visibility ?? 'hidden');
  const [revealTrigger, setRevealTrigger] = useState<RevealTrigger>(liveCp.reveal?.trigger ?? 'player');
  const [revealAudience, setRevealAudience] = useState<RevealAudience>(liveCp.reveal?.audience ?? 'all');
  const [revealOffset, setRevealOffset] = useState(liveCp.reveal?.offsetMinutes != null ? String(liveCp.reveal.offsetMinutes) : '');
  const [recipients, setRecipients] = useState<string[]>(liveCp.reveal?.recipientPlayerIds ?? []);
  const toggleRecipient = (id: string) =>
    setRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const [busy, setBusy] = useState(false);

  function buildReveal(): CheckpointReveal | undefined {
    if (visibility !== 'shown-on-trigger') return undefined;
    const aud: RevealAudience = revealTrigger === 'player' ? 'triggerer' : revealAudience;
    const reveal: CheckpointReveal = { trigger: revealTrigger, audience: aud };
    if (revealTrigger === 'timed') reveal.offsetMinutes = Math.max(0, Math.round(Number(revealOffset) || 0));
    if (aud === 'specific-players') reveal.recipientPlayerIds = recipients;
    return reveal;
  }

  async function save() {
    if (!name.trim()) { window.alert('Enter a checkpoint name'); return; }
    const r = parseInt(radius, 10);
    if (isNaN(r) || r < 10) { window.alert('Enter a valid radius (minimum 10m)'); return; }

    const reveal = buildReveal();
    if (visibility === 'shown-on-trigger' && reveal?.audience === 'specific-players' && recipients.length === 0) {
      window.alert('Pick at least one player for a sponsor drop, or choose "All players".');
      return;
    }
    const isTimedReveal = visibility === 'shown-on-trigger' && revealTrigger === 'timed';
    if (isTimedReveal) {
      // #63: a timed reveal at +0 (or blank/negative) min makes no sense — require > 0.
      const offsetErr = requireMinInt(Math.round(Number(revealOffset)), 1, 'Reveal time (minutes after start)');
      if (offsetErr) { window.alert(offsetErr); return; }
    }
    const revealOffsetMins = isTimedReveal ? Math.round(Number(revealOffset)) : null;

    const updates: Record<string, unknown> = {
      name: name.trim(),
      radius: r,
      icon,
      visibility,
      reveal: reveal ?? deleteField(),
    };

    setBusy(true);
    try {
      await updateCheckpoint(gameId, cp.id, updates as Partial<Omit<Checkpoint, 'id'>>);
      await setRevealSchedule(gameId, cp.id, revealOffsetMins);
      onClose();
    } catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  async function remove() {
    if (!window.confirm(`Delete "${liveCp.name}"? This also deletes its runbook entries. This cannot be undone.`)) return;
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

      {/* Player visibility (#60) */}
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
        {visibility === 'shown-on-trigger' && (
          <>
            <span style={labelStyle}>Reveal when</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {([{ v: 'player', label: 'On crossing' }, { v: 'timed', label: 'At a set time' }, { v: 'gm', label: 'When I tap' }] as { v: RevealTrigger; label: string }[]).map((o) => (
                <button key={o.v} type="button" className={revealTrigger === o.v ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 10px', fontSize: 12 }} onClick={() => setRevealTrigger(o.v)}>{o.label}</button>
              ))}
            </div>
            {revealTrigger === 'player' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Becomes visible to the player who crosses it (a trap they now know).</span>}
            {revealTrigger === 'timed' && (
              <div className="field">
                <label>Minutes after start</label>
                <input className="input" type="number" value={revealOffset} onChange={(e) => setRevealOffset(e.target.value)} placeholder="e.g. 60" />
              </div>
            )}
            {revealTrigger !== 'player' && (
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
            {revealTrigger === 'gm' && (
              <button type="button" className="btn btn--secondary" onClick={revealNow}>
                {liveCp.revealedAt ? 'Revealed — reveal again' : 'Reveal now'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Runbook link (#60) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <span style={labelStyle}>Runbook ({entryCount})</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          What happens at this checkpoint is authored in the Runbook — hazards, boons, arrival queues, timed and GM-prompted events.
        </span>
        <button type="button" className="btn btn--ghost" onClick={() => { onClose(); navigate(`/games/${gameId}/runbook?cp=${cp.id}`); }}>
          Open Runbook editor →
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>Save</button>
      </div>
      <button className="btn btn--danger" onClick={remove} disabled={busy}>Delete checkpoint</button>
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
  checkpoints, runbookEntries, playerLocations, deathMarkers, boundary, arrivals, entryTrips, members, busy,
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
  runbookEntries: RunbookEntry[];
  playerLocations: PlayerLocation[];
  deathMarkers: DeathMarker[];
  boundary?: MapBoundary | null;
  arrivals: Arrival[];
  entryTrips: EntryTrip[];
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
        <GameMap checkpoints={checkpoints} runbookEntries={runbookEntries} playerLocations={playerLocations} deathMarkers={deathMarkers} boundary={boundary} />
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
          <NotificationFeed arrivals={arrivals} entryTrips={entryTrips} members={members} />
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
  const [tripInterval, setTripInterval] = useState(String(initial.tripIntervalMinutes ?? 2)); // #67
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save() {
    // #63: validate + show inline reasons instead of silently clamping.
    const minutes = Math.round(Number(duration));
    const rationMins = Math.round(Number(rationMinutes));
    const rationWindowMins = Math.round(Number(rationWindow));
    const tripMins = Math.round(Number(tripInterval));
    const errs = validateGameConfig({
      durationMinutes: minutes,
      rationsEnabled: rations,
      rationIntervalMinutes: rationMins,
      rationWindowMinutes: rationWindowMins,
      tripIntervalMinutes: tripMins,
    });
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
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
          tripIntervalMinutes: tripMins,
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
        {errors.durationMinutes
          ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{errors.durationMinutes}</span>
          : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>210 = 3.5 hours</span>}
      </div>
      <div className="field">
        <label>Event date (optional)</label>
        <input className="input" type="date" value={gameDate} onChange={(e) => setGameDate(e.target.value)} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          The day you're running this game. Sorts it in My Games; leave blank to use the created date.
        </span>
      </div>
      <div className="field">
        <label>Checkpoint re-trigger interval (minutes)</label>
        <input className="input" type="number" value={tripInterval} onChange={(e) => setTripInterval(e.target.value)} />
        {errors.tripIntervalMinutes && (
          <span style={{ fontSize: 12, color: 'var(--danger)' }}>{errors.tripIntervalMinutes}</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          While a player lingers on a checkpoint, its runbook events are re-checked this often so a
          newly-live event still triggers. Each event triggers a player at most once.
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
            {errors.rationIntervalMinutes
              ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{errors.rationIntervalMinutes}</span>
              : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>How often players must submit a ration card</span>}
          </div>
          <div className="field">
            <label>Open window (minutes)</label>
            <input className="input" type="number" value={rationWindow} onChange={(e) => setRationWindow(e.target.value)} />
            {errors.rationWindowMinutes
              ? <span style={{ fontSize: 12, color: 'var(--danger)' }}>{errors.rationWindowMinutes}</span>
              : <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  How long the card window stays open before each interval ends — players are alerted when
                  it opens. Must not exceed the interval length.
                </span>}
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
  gameId, rations, members, currentIndex, totalWindows, windowOpen, enforceUnique, onClose,
}: {
  gameId: string;
  rations: RationSubmission[];
  members: GameMember[];
  currentIndex: number | null;
  totalWindows: number | null;
  /** #66: true only while the eat-window is actually open — before then nobody is "late". */
  windowOpen: boolean;
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
  // #66: only flag "not eaten" once the eat-window is actually open — before then no one is late.
  const notEaten =
    currentIndex == null || !windowOpen
      ? []
      : members.filter((m) => m.role === 'player' && !m.out && !fed.has(m.userId));

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
        {currentIndex != null && !windowOpen ? ' · window not open yet' : ''}
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
              {r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button className="btn btn--ghost" style={{ padding: '6px 10px' }} disabled={busyId === r.id} onClick={() => review(r, 'rejected')}>Reject</button>
                  <button className="btn" style={{ padding: '6px 10px' }} disabled={busyId === r.id} onClick={() => review(r, 'valid')}>Accept</button>
                </div>
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
