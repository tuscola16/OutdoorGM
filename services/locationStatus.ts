import { Colors } from '@/constants/colors';

/**
 * How fresh a player's last location fix is. Because Outdoor GM is now the *only*
 * thing tracking players (it replaces Find My Kids by Pingo), the GM needs to tell
 * "stopped moving" from "stopped reporting" — a stale fix means a player has
 * silently dropped off the only map anyone has.
 */
export type StaleLevel = 'fresh' | 'aging' | 'stale' | 'none';

/** Seconds before a fix is considered aging / stale. */
export const AGING_MS = 60_000; // 1 min
export const STALE_MS = 120_000; // 2 min

export function stalenessLevel(ageMs: number | null): StaleLevel {
  if (ageMs == null) return 'none';
  if (ageMs < AGING_MS) return 'fresh';
  if (ageMs < STALE_MS) return 'aging';
  return 'stale';
}

export function stalenessColor(level: StaleLevel): string {
  switch (level) {
    case 'fresh':
      return Colors.success;
    case 'aging':
      return Colors.secondary;
    case 'stale':
      return Colors.danger;
    default:
      return Colors.textMuted;
  }
}

/** Human "x ago" for a fix age in milliseconds. */
export function formatAgo(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
