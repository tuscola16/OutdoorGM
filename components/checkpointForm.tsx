import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import type {
  RunbookEntry, CheckpointKind, CheckpointVisibility, RunbookTriggerType,
} from '@/types';

// Shared presentation + helpers for checkpoints and the runbook (ROADMAP #60). Authoring of
// runbook entries lives in the web dashboard; the mobile app shows them read-only, so these
// are mostly labels/colors for badges plus the visibility chips the mobile editor still owns.

/** Per-kind chip label/icon, pin color, and a message placeholder. */
export const KIND_META: Record<
  CheckpointKind,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; placeholder: string }
> = {
  hazard: { label: 'Hazard', icon: 'warning', color: Colors.danger, placeholder: 'e.g. A beast attacks! Defend or flee.' },
  boon: { label: 'Boon', icon: 'sparkles', color: Colors.success, placeholder: 'e.g. You found a hidden cache. Claim it.' },
  notify: { label: 'Notify', icon: 'megaphone', color: Colors.playerDot, placeholder: 'e.g. The storm is closing in — head for high ground.' },
  'gm-notify': { label: 'GM only', icon: 'eye-off', color: Colors.textSecondary, placeholder: '' },
};
export const KIND_ORDER: CheckpointKind[] = ['hazard', 'boon', 'notify', 'gm-notify'];

/** Visibility (#60): who can see the marker, independent of what the runbook does. */
export const VIS_META: Record<CheckpointVisibility, { label: string; icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  hidden: { label: 'Hidden', icon: 'eye-off', hint: 'Only you see it. Players never see this checkpoint on their map.' },
  shown: { label: 'Always shown', icon: 'eye', hint: 'Players see this location from the start — but not what it does until they cross it.' },
  'shown-on-trigger': { label: 'Reveal later', icon: 'time', hint: 'Hidden until a reveal trigger fires (a trap, a timed/triggered drop, or a sponsor drop).' },
};
export const VIS_ORDER: CheckpointVisibility[] = ['hidden', 'shown', 'shown-on-trigger'];

/** Runbook trigger presentation for read-only badges. */
export const TRIGGER_META: Record<RunbookTriggerType, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  'fixed-order': { label: 'Fixed order', icon: 'list' },
  'always-on': { label: 'Always on', icon: 'infinite' },
  timed: { label: 'Timed', icon: 'time' },
  'gm-prompted': { label: 'GM prompted', icon: 'hand-left' },
};

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/** The representative kind for a checkpoint's pin/summary: the highest-priority entry's
 * effect kind, else `gm-notify` when it has no runbook entries (#60). */
export function checkpointKind(entries: RunbookEntry[]): CheckpointKind {
  if (!entries || entries.length === 0) return 'gm-notify';
  const top = [...entries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];
  return top.effect?.kind ?? 'gm-notify';
}

export function ordinalLabel(i: number): string {
  const n = i + 1;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix} arriver`;
}
