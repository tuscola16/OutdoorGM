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

/** Seconds remaining in a fixed-length game (Rule 5). Counts down live while
 * playing; freezes at 0 once the duration elapses or the game ends. Null before
 * start. Ported from the mobile app's hooks/useElapsed.ts. */
export function useRemaining(
  startedAt: Timestamp,
  durationMinutes: number,
  endedAt: Timestamp
): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!startedAt) { setRemaining(null); return; }
    const endMs = startedAt.toMillis() + durationMinutes * 60_000;
    const compute = (nowMs: number) => Math.max(0, Math.floor((endMs - nowMs) / 1000));
    if (endedAt) { setRemaining(compute(endedAt.toMillis())); return; }
    const update = () => setRemaining(compute(Date.now()));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, durationMinutes, endedAt]);

  return remaining;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
