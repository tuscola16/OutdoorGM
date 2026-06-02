import { useEffect, useState } from 'react';

/** A clock that re-renders the caller on an interval, for live "x ago" labels.
 * Ported from the mobile app's hooks/useNow.ts. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
