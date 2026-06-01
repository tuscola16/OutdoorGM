import type { Arrival } from '@shared/types';

function formatTime(timestamp: any): string {
  try {
    const date: Date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

export function AlertFeed({ arrivals }: { arrivals: Arrival[] }) {
  if (arrivals.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '32px 0' }}>
        Waiting for arrivals…
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {arrivals.map((a) => (
        <div
          key={a.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            background: 'var(--surface-elevated)',
            borderRadius: 10,
            borderLeft: '3px solid var(--primary)',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{a.playerName}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              reached {a.checkpointName}
            </div>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatTime(a.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
