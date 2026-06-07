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

/** Why a living player is unaccounted-for (#6). */
export type UnaccountedReason = 'sos' | 'no-signal' | 'stale';

export interface UnaccountedPlayer {
  userId: string;
  displayName: string;
  reason: UnaccountedReason;
}

interface UnaccountedMemberInput {
  userId: string;
  role: string;
  displayName: string;
  out?: boolean;
  sos?: boolean;
  sosAckAt?: unknown;
}

/**
 * Living players the GM hasn't accounted for (#6): an open, unacknowledged SOS, or no
 * fresh location fix (never reported, or older than `thresholdMs`). Used to hard-warn
 * before End Game so a game can't be closed while someone might be in trouble. GMs and
 * eliminated (out) players are excluded; a fix at/under the threshold is considered fine.
 */
export function unaccountedPlayers(
  members: UnaccountedMemberInput[],
  lastFixByUser: Map<string, number>,
  now: number = Date.now(),
  thresholdMs: number = STALE_MS
): UnaccountedPlayer[] {
  const result: UnaccountedPlayer[] = [];
  for (const m of members) {
    if (m.role === 'gm' || m.out) continue;
    if (m.sos && !m.sosAckAt) {
      result.push({ userId: m.userId, displayName: m.displayName, reason: 'sos' });
      continue;
    }
    const fix = lastFixByUser.get(m.userId) ?? null;
    if (fix == null) {
      result.push({ userId: m.userId, displayName: m.displayName, reason: 'no-signal' });
    } else if (now - fix > thresholdMs) {
      result.push({ userId: m.userId, displayName: m.displayName, reason: 'stale' });
    }
  }
  return result;
}

/** One-line reason text for an unaccounted player, for the End-Game warning. */
export function unaccountedReasonText(p: UnaccountedPlayer, now: number, lastFixByUser: Map<string, number>): string {
  if (p.reason === 'sos') return 'open SOS (unacknowledged)';
  if (p.reason === 'no-signal') return 'no location yet';
  const fix = lastFixByUser.get(p.userId);
  return fix == null ? 'no recent fix' : `last fix ${formatAgo(now - fix)}`;
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
