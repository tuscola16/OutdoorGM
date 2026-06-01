import { useState, useEffect } from 'react';
import type { FsTimestamp } from '@shared/types';

type Timestamp = FsTimestamp | null | undefined;

/** Live elapsed-seconds counter between startedAt and (endedAt ?? now).
 *  Ported from the mobile app's hooks/useElapsed.ts. */
export function useElapsed(startedAt: Timestamp, endedAt: Timestamp): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) { setElapsed(null); return; }
    const startMs = startedAt.toMillis();
    if (endedAt) { setElapsed(Math.floor((endedAt.toMillis() - startMs) / 1000)); return; }
    const update = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, endedAt]);

  return elapsed;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
