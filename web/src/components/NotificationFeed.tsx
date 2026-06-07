import { useMemo, useState } from 'react';
import type { Arrival, RunbookEntry, GameMember, EliminationCause } from '@shared/types';
import { KIND_META, checkpointKind } from '@/services/checkpointKinds';

type Category = 'event' | 'arrival' | 'sos' | 'death';

interface Notif {
  id: string;
  time: number; // millis, for sorting
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  category: Category;
}

const CAUSE_LABEL: Record<EliminationCause, string> = {
  self: 'Tapped out',
  starvation: 'Starved',
  'bad-sport': 'Bad sport',
  'stole-drop': 'Stole a drop',
  comms: 'Comms violation',
  'cold-tapout': 'Cold tap-out',
  'gm-other': 'Eliminated by GM',
};

const FILTERS: { key: 'all' | Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'event', label: 'Events' },
  { key: 'arrival', label: 'Arrivals' },
  { key: 'sos', label: 'Safety' },
];

function toMillis(ts: any): number {
  return ts?.toMillis?.() ?? (ts ? new Date(ts).getTime() : 0);
}

function formatTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Unified GM notification feed. Derives a chronological, color-coded stream from the
 * data the GM already subscribes to — no extra Firestore listener:
 *  - checkpoint crossings (joined to their checkpoint to surface hazard/boon/notify kind)
 *  - 🆘 safety alerts (member.sos)
 *  - ☠️ eliminations (member.out + cause)
 */
export function NotificationFeed({
  arrivals, runbookEntries = [], members,
}: {
  arrivals: Arrival[];
  runbookEntries?: RunbookEntry[];
  members: GameMember[];
}) {
  const [filter, setFilter] = useState<'all' | Category>('all');

  const notifs = useMemo<Notif[]>(() => {
    const entriesByCp = new Map<string, RunbookEntry[]>();
    for (const e of runbookEntries) {
      const list = entriesByCp.get(e.checkpointId) ?? [];
      list.push(e);
      entriesByCp.set(e.checkpointId, list);
    }
    const items: Notif[] = [];

    for (const a of arrivals) {
      const kind = checkpointKind(entriesByCp.get(a.checkpointId) ?? []);
      const meta = KIND_META[kind];
      if (kind === 'gm-notify') {
        items.push({
          id: `arr-${a.id}`, time: toMillis(a.timestamp), icon: '📍', color: meta.color,
          title: a.playerName, subtitle: `reached ${a.checkpointName}`, category: 'arrival',
        });
      } else {
        items.push({
          id: `arr-${a.id}`, time: toMillis(a.timestamp), icon: meta.emoji, color: meta.color,
          title: `${a.playerName} · ${meta.label}`,
          subtitle: `${meta.label} at ${a.checkpointName}`,
          category: 'event',
        });
      }
    }

    for (const m of members) {
      if (m.sos) {
        items.push({
          id: `sos-${m.userId}`, time: toMillis(m.sosAt), icon: '🆘', color: 'var(--danger)',
          title: `${m.displayName} needs assistance`, subtitle: 'Safety alert', category: 'sos',
        });
      }
      if (m.out) {
        items.push({
          id: `death-${m.userId}`, time: toMillis(m.outAt), icon: '☠️', color: 'var(--text-secondary)',
          title: `${m.displayName} eliminated`,
          subtitle: m.cause ? CAUSE_LABEL[m.cause] : 'Out of the game', category: 'death',
        });
      }
    }

    return items.sort((a, b) => b.time - a.time);
  }, [arrivals, runbookEntries, members]);

  const shown = notifs.filter((n) =>
    filter === 'all' ? true : filter === 'sos' ? (n.category === 'sos' || n.category === 'death') : n.category === filter
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
                background: active ? 'var(--primary)' : 'transparent',
                color: active ? '#fff' : 'var(--text-secondary)',
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {shown.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>
            {filter === 'all' ? 'Waiting for activity…' : 'Nothing here yet.'}
          </div>
        ) : (
          shown.map((n) => (
            <div
              key={n.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                background: 'var(--surface-elevated)', borderRadius: 10,
                borderLeft: `3px solid ${n.color}`,
              }}
            >
              <span style={{ fontSize: 16 }}>{n.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {n.subtitle}
                </div>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{formatTime(n.time)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
