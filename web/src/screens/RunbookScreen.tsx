import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { deleteField } from 'firebase/firestore';
import { useGame } from '@/context/GameContext';
import {
  addRunbookEntry, updateRunbookEntry, deleteRunbookEntry, fireRunbookEntry,
} from '@/services/gameService';
import {
  KIND_META, KIND_ORDER, TRIGGER_META, ordinalLabel,
} from '@/services/checkpointKinds';
import { friendlyError } from '@/services/errorUtils';
import type {
  RunbookEntry, RunbookEffect, RunbookTriggerType, CheckpointKind, NotifyAudience, TimedBound,
} from '@shared/types';

// Standalone full-page runbook editor (ROADMAP #60). Left sidebar lists entries in two
// groups — Always-on and Timed — sorted by priority (timed then by start time); the right
// pane edits the selected entry.

const labelStyle = { fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 } as const;

/** Sort key for a timed entry's start, in minutes after game start (game-start = 0). */
function startMinutes(e: RunbookEntry): number {
  const b = e.startAt;
  if (!b || b.kind === 'game-start') return 0;
  if (b.kind === 'game-end') return Number.POSITIVE_INFINITY;
  return b.atMinute ?? 0;
}

export function RunbookScreen() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { game, checkpoints, runbookEntries, members, loadGame, clearGame } = useGame();
  const players = members.filter((m) => m.role === 'player');

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // `new:<checkpointId>` while authoring a fresh entry, or an existing entry id.
  const [selected, setSelected] = useState<string | null>(null);

  // Deep-link from the checkpoint modal: ?cp=<id> starts a new entry on that checkpoint.
  useEffect(() => {
    const cp = params.get('cp');
    if (cp && selected == null) setSelected(`new:${cp}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const cpName = (id: string) => checkpoints.find((c) => c.id === id)?.name ?? 'Unknown checkpoint';

  const { alwaysOn, timed } = useMemo(() => {
    const byPriority = (a: RunbookEntry, b: RunbookEntry) => (b.priority ?? 0) - (a.priority ?? 0);
    const timed = runbookEntries
      .filter((e) => e.trigger === 'timed')
      .sort((a, b) => byPriority(a, b) || startMinutes(a) - startMinutes(b));
    const alwaysOn = runbookEntries.filter((e) => e.trigger !== 'timed').sort(byPriority);
    return { alwaysOn, timed };
  }, [runbookEntries]);

  const editing = selected && !selected.startsWith('new:')
    ? runbookEntries.find((e) => e.id === selected) ?? null
    : null;
  const newCheckpointId = selected?.startsWith('new:') ? selected.slice(4) : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 20px', borderBottom: '1px solid var(--border)' }}>
        <button className="btn btn--ghost" style={{ padding: '6px 12px' }} onClick={() => navigate(`/games/${gameId}`)}>← Game</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Runbook</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{game?.name ?? '…'} · {runbookEntries.length} entr{runbookEntries.length === 1 ? 'y' : 'ies'}</div>
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Sidebar */}
        <aside style={{ width: 320, borderRight: '1px solid var(--border)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {checkpoints.length === 0 ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              Add a checkpoint on the map first — runbook entries attach to a checkpoint.
            </p>
          ) : (
            <NewEntryButton checkpoints={checkpoints} onPick={(cpId) => setSelected(`new:${cpId}`)} />
          )}

          <Group title="Always on" entries={alwaysOn} cpName={cpName} selectedId={editing?.id ?? null} onSelect={setSelected} />
          <Group title="Timed" entries={timed} cpName={cpName} selectedId={editing?.id ?? null} onSelect={setSelected} timed />
        </aside>

        {/* Editor */}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 24 }}>
          {editing || newCheckpointId ? (
            <EntryEditor
              key={editing?.id ?? `new:${newCheckpointId}`}
              gameId={gameId!}
              entry={editing}
              newCheckpointId={newCheckpointId}
              checkpoints={checkpoints}
              players={players}
              onSaved={(id) => setSelected(id)}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>
              Select an entry, or add a new one.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function NewEntryButton({ checkpoints, onPick }: { checkpoints: { id: string; name: string }[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn--block" onClick={() => setOpen((o) => !o)}>+ New entry</button>
      {open && (
        <div className="card" style={{ position: 'absolute', zIndex: 5, top: '110%', left: 0, right: 0, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '2px 4px' }}>On which checkpoint?</span>
          {checkpoints.map((c) => (
            <button key={c.id} className="btn btn--ghost" style={{ justifyContent: 'flex-start' }} onClick={() => { onPick(c.id); setOpen(false); }}>
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Group({
  title, entries, cpName, selectedId, onSelect, timed,
}: {
  title: string;
  entries: RunbookEntry[];
  cpName: (id: string) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  timed?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{title} ({entries.length})</span>
      {entries.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>None yet.</span>}
      {entries.map((e) => {
        const meta = KIND_META[e.effect?.kind ?? 'gm-notify'];
        const active = e.id === selectedId;
        return (
          <button
            key={e.id}
            onClick={() => onSelect(e.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              textAlign: 'left', width: '100%',
              border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
              background: active ? 'rgba(212,137,63,0.12)' : 'var(--card)',
            }}
          >
            <span style={{ fontSize: 14 }}>{meta.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name || '(unnamed)'}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cpName(e.checkpointId)} · {TRIGGER_META[e.trigger].label}
                {timed ? ` · ${timedLabel(e.startAt, e.endAt)}` : ''}
              </div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>P{e.priority ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

function timedLabel(start?: TimedBound, end?: TimedBound): string {
  const lbl = (b: TimedBound | undefined, fb: string) => {
    if (!b) return fb;
    if (b.kind === 'game-start') return 'start';
    if (b.kind === 'game-end') return 'end';
    return `+${b.atMinute ?? 0}m`;
  };
  return `${lbl(start, 'start')}→${lbl(end, 'end')}`;
}

// --- Effect editor ---

function cleanEffect(e: RunbookEffect): RunbookEffect {
  const out: RunbookEffect = { kind: e.kind };
  if (e.kind !== 'gm-notify' && e.message?.trim()) out.message = e.message.trim();
  if (e.kind === 'notify' && e.audience === 'all-players') out.audience = 'all-players';
  return out;
}

function KindChips({ value, onChange }: { value: CheckpointKind; onChange: (k: CheckpointKind) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {KIND_ORDER.map((k) => {
        const meta = KIND_META[k];
        const active = k === value;
        return (
          <button key={k} type="button" onClick={() => onChange(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, fontWeight: 600, border: `1px solid ${active ? meta.color : 'var(--border)'}`, background: active ? `${meta.color}26` : 'transparent', color: active ? meta.color : 'var(--text-secondary)' }}>
            <span>{meta.emoji}</span>{meta.label}
          </button>
        );
      })}
    </div>
  );
}

function AudienceToggle({ value, onChange }: { value: NotifyAudience; onChange: (a: NotifyAudience) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {([{ v: 'crossing-player', label: 'Crossing player' }, { v: 'all-players', label: 'All players' }] as { v: NotifyAudience; label: string }[]).map((o) => (
        <button key={o.v} type="button" className={value === o.v ? 'btn' : 'btn btn--ghost'} style={{ flex: 1, padding: '8px 12px' }} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

function EffectEditor({ value, onChange }: { value: RunbookEffect; onChange: (e: RunbookEffect) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <KindChips value={value.kind} onChange={(k) => onChange({ ...value, kind: k })} />
      {value.kind !== 'gm-notify' && (
        <textarea className="input" rows={2} value={value.message ?? ''} onChange={(e) => onChange({ ...value, message: e.target.value })} placeholder={KIND_META[value.kind].placeholder} style={{ resize: 'vertical' }} />
      )}
      {value.kind === 'notify' && (
        <AudienceToggle value={value.audience ?? 'crossing-player'} onChange={(a) => onChange({ ...value, audience: a })} />
      )}
      {value.kind === 'gm-notify' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only you (the GM) are alerted. The player sees nothing.</span>}
    </div>
  );
}

// --- Entry editor ---

function EntryEditor({
  gameId, entry, newCheckpointId, checkpoints, players, onSaved, onDeleted,
}: {
  gameId: string;
  entry: RunbookEntry | null;
  newCheckpointId: string | null;
  checkpoints: { id: string; name: string }[];
  players: { userId: string; displayName: string }[];
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [checkpointId, setCheckpointId] = useState(entry?.checkpointId ?? newCheckpointId ?? checkpoints[0]?.id ?? '');
  const [name, setName] = useState(entry?.name ?? '');
  const [priority, setPriority] = useState(String(entry?.priority ?? 0));
  const [trigger, setTrigger] = useState<RunbookTriggerType>(entry?.trigger ?? 'always-on');
  const [effect, setEffect] = useState<RunbookEffect>(entry?.effect ?? { kind: 'gm-notify' });
  const [slots, setSlots] = useState<(RunbookEffect | null)[]>(entry?.queueSlots ?? []);
  const [defaultNone, setDefaultNone] = useState(entry?.defaultNone ?? false);
  const [startAt, setStartAt] = useState<TimedBound>(entry?.startAt ?? { kind: 'game-start' });
  const [endAt, setEndAt] = useState<TimedBound>(entry?.endAt ?? { kind: 'game-end' });
  const [busy, setBusy] = useState(false);

  // GM-prompted fire
  const [fireTargets, setFireTargets] = useState<string[]>([]);
  const toggleFire = (id: string) => setFireTargets((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  async function save() {
    if (!checkpointId) { window.alert('Pick a checkpoint.'); return; }
    if (!name.trim()) { window.alert('Name this runbook entry.'); return; }
    const prio = Math.round(Number(priority) || 0);

    const base: Record<string, unknown> = {
      checkpointId,
      name: name.trim(),
      priority: prio,
      trigger,
      effect: cleanEffect(effect),
    };
    // Trigger-specific fields (set the relevant ones; clear the rest on update).
    if (trigger === 'fixed-order') {
      base.queueSlots = slots.map((s) => (s ? cleanEffect(s) : null));
      base.defaultNone = defaultNone;
    } else {
      base.queueSlots = entry ? deleteField() : undefined;
      base.defaultNone = entry ? deleteField() : undefined;
    }
    if (trigger === 'timed') {
      base.startAt = cleanBound(startAt);
      base.endAt = cleanBound(endAt);
    } else {
      base.startAt = entry ? deleteField() : undefined;
      base.endAt = entry ? deleteField() : undefined;
    }

    setBusy(true);
    try {
      if (entry) {
        await updateRunbookEntry(gameId, entry.id, base);
        onSaved(entry.id);
      } else {
        const cleaned = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined));
        const id = await addRunbookEntry(gameId, cleaned as unknown as Omit<RunbookEntry, 'id' | 'createdAt'>);
        onSaved(id);
      }
    } catch (err) { window.alert(friendlyError(err)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!entry) { onDeleted(); return; }
    if (!window.confirm(`Delete "${entry.name}"?`)) return;
    setBusy(true);
    try { await deleteRunbookEntry(gameId, entry.id); onDeleted(); }
    catch (err) { window.alert(friendlyError(err)); setBusy(false); }
  }

  async function fire() {
    if (!entry) return;
    setBusy(true);
    try {
      await fireRunbookEntry(gameId, entry.id, fireTargets.length > 0 ? fireTargets : undefined);
      window.alert(`Fired “${entry.name}” to ${fireTargets.length > 0 ? `${fireTargets.length} player(s)` : 'all players'}.`);
    } catch (err) { window.alert(friendlyError(err)); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0 }}>{entry ? 'Edit entry' : 'New entry'}</h2>

      <div className="field">
        <label>Checkpoint</label>
        <select className="input" value={checkpointId} onChange={(e) => setCheckpointId(e.target.value)}>
          {checkpoints.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sponsor drop" />
        </div>
        <div className="field" style={{ width: 110 }}>
          <label>Priority</label>
          <input className="input" type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8 }}>
        On a crossing, the highest-priority matching entry wins.
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>Trigger</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(['fixed-order', 'always-on', 'timed', 'gm-prompted'] as RunbookTriggerType[]).map((t) => (
            <button key={t} type="button" className={trigger === t ? 'btn' : 'btn btn--ghost'} style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setTrigger(t)}>
              {TRIGGER_META[t].emoji} {TRIGGER_META[t].label}
            </button>
          ))}
        </div>
      </div>

      {/* Effect (the default for fixed-order) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={labelStyle}>{trigger === 'fixed-order' ? 'Default effect' : 'Effect'}</span>
        {trigger === 'fixed-order' && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>
              Fires for arrivers past the slots below, and for anyone who revisits.
            </span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={defaultNone} onChange={(e) => setDefaultNone(e.target.checked)} />
              Nothing fires by default
            </label>
          </>
        )}
        {!(trigger === 'fixed-order' && defaultNone) && (
          <EffectEditor value={effect} onChange={setEffect} />
        )}
      </div>

      {/* Trigger-specific */}
      {trigger === 'fixed-order' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={labelStyle}>Per-arrival slots</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            The Nth arriver gets their slot; unlisted arrivers get the default effect above.
          </span>
          {slots.map((slot, i) => (
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 13 }}>{ordinalLabel(i)}</strong>
                <button type="button" onClick={() => setSlots((s) => s.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={slot == null} onChange={(e) => setSlots((s) => s.map((x, idx) => (idx === i ? (e.target.checked ? null : { kind: 'gm-notify' }) : x)))} />
                Nothing fires for this arriver
              </label>
              {slot != null && (
                <EffectEditor value={slot} onChange={(eff) => setSlots((s) => s.map((x, idx) => (idx === i ? eff : x)))} />
              )}
            </div>
          ))}
          <button type="button" className="btn btn--ghost" onClick={() => setSlots((s) => [...s, { kind: 'hazard' }])}>+ Add slot</button>
        </div>
      )}

      {trigger === 'timed' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <BoundEditor label="Starts" value={startAt} onChange={setStartAt} anchorLabel="Game start" anchorKind="game-start" />
          <BoundEditor label="Ends" value={endAt} onChange={setEndAt} anchorLabel="Game end" anchorKind="game-end" />
        </div>
      )}

      {trigger === 'gm-prompted' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
          <span style={labelStyle}>Fire now</span>
          {!entry ? (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Save the entry first, then fire it from here.</span>
          ) : (
            <>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Leave all unchecked to send to every living player.</span>
              {players.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No players have joined yet.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {players.map((p) => (
                    <label key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={fireTargets.includes(p.userId)} onChange={() => toggleFire(p.userId)} />
                      <span>{p.displayName}</span>
                    </label>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn--secondary" onClick={fire} disabled={busy}>⚡ Fire entry</button>
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button className="btn btn--ghost" style={{ flex: 1 }} onClick={onDeleted}>Cancel</button>
        <button className="btn" style={{ flex: 1 }} onClick={save} disabled={busy}>Save entry</button>
      </div>
      {entry && <button className="btn btn--danger" onClick={remove} disabled={busy}>Delete entry</button>}
    </div>
  );
}

function cleanBound(b: TimedBound): TimedBound {
  if (b.kind === 'time') return { kind: 'time', atMinute: Math.max(0, Math.round(b.atMinute ?? 0)) };
  return { kind: b.kind };
}

function BoundEditor({
  label, value, onChange, anchorLabel, anchorKind,
}: {
  label: string;
  value: TimedBound;
  onChange: (b: TimedBound) => void;
  anchorLabel: string;
  anchorKind: 'game-start' | 'game-end';
}) {
  const isTime = value.kind === 'time';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" className={!isTime ? 'btn' : 'btn btn--ghost'} style={{ padding: '8px 12px' }} onClick={() => onChange({ kind: anchorKind })}>{anchorLabel}</button>
        <button type="button" className={isTime ? 'btn' : 'btn btn--ghost'} style={{ padding: '8px 12px' }} onClick={() => onChange({ kind: 'time', atMinute: isTime ? value.atMinute : 0 })}>At minute</button>
        {isTime && (
          <input className="input" type="number" style={{ width: 100 }} value={value.atMinute ?? 0} onChange={(e) => onChange({ kind: 'time', atMinute: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        )}
        {isTime && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>min after start</span>}
      </div>
    </div>
  );
}
