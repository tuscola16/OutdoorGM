import { useMemo, useState } from 'react';
import type { Arrival, EntryTrip, GameMember, EliminationCause, CheckpointKind } from '@shared/types';
import { KIND_META } from '@/services/checkpointKinds';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMillis(ts: any): number {
  return ts?.toMillis?.() ?? (ts ? new Date(ts).getTime() : 0);
}

function formatTime(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Unified GM notification feed. Derives a chronological, color-coded stream from data the GM
 * already subscribes to — no extra listener beyond `entryTrips`:
 *  - ⚡ **Events** — runbook entries that *actually fired*, from `entryTrips` (#73). One row per
 *    real trip (a player trips each entry at most once), carrying the delivered effect's kind +
 *    message. This replaces the old "label every arrival by the checkpoint's headline kind"
 *    behavior, which mislabeled plain arrivals as hazards and showed a row per arrival doc.
 *  - 📍 **Arrivals** — a neutral "reached <checkpoint>" ping, deduped to the latest per
 *    player×checkpoint so re-crossings don't spam the feed.
 *  - 🆘 safety alerts (member.sos) and ☠️ eliminations (member.out + cause).
 */
export function NotificationFeed({
  arrivals, entryTrips = [], members,
}: {
  arrivals: Arrival[];
  entryTrips?: EntryTrip[];
  members: GameMember[];
}) {
  const [filter, setFilter] = useState<'all' | Category>('all');

  const notifs = useMemo<Notif[]>(() => {
    const items: Notif[] = [];

    // Events — only entries that actually fired.
    for (const t of entryTrips) {
      const kind: CheckpointKind = t.effectKind ?? 'gm-notify';
      const meta = KIND_META[kind];
      const isGm = kind === 'gm-notify';
      const player = t.playerName ?? 'A player';
      const cp = t.checkpointName ?? 'a checkpoint';
      items.push({
        id: `trip-${t.id ?? `${t.playerId}_${t.entryId}`}`,
        time: toMillis(t.trippedAt),
        icon: isGm ? '📍' : meta.emoji,
        color: meta.color,
        title: isGm ? player : `${player} · ${meta.label}`,
        subtitle: t.message || (isGm ? `reached ${cp}` : `${meta.label} at ${cp}`),
        category: 'event',
      });
    }

    // Arrivals — neutral, deduped to the latest per player×checkpoint.
    const latestArrival = new Map<string, Arrival>();
    for (const a of arrivals) {
      const key = `${a.playerId}_${a.checkpointId}`;
      const prev = latestArrival.get(key);
      if (!prev || toMillis(a.timestamp) > toMillis(prev.timestamp)) latestArrival.set(key, a);
    }
    for (const a of latestArrival.values()) {
      items.push({
        id: `arr-${a.id}`, time: toMillis(a.timestamp), icon: '📍', color: 'var(--text-secondary)',
        title: a.playerName, subtitle: `reached ${a.checkpointName}`, category: 'arrival',
      });
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
  }, [arrivals, entryTrips, members]);

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
