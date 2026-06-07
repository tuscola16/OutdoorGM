import type {
  Checkpoint, CheckpointEvent, CheckpointKind, EventAudience, CheckpointVisibility,
  CheckpointState,
} from '@shared/types';

/**
 * Per-kind presentation for checkpoints, mirroring the mobile app's KIND_META
 * (app/(app)/gm/[gameId]/boundary.tsx). Colors are the web COLORS palette.
 */
export const KIND_META: Record<
  CheckpointKind,
  { label: string; emoji: string; color: string; placeholder: string }
> = {
  hazard: {
    label: 'Hazard', emoji: '⚠️', color: '#e8402a',
    placeholder: 'e.g. A beast attacks! Defend or flee.',
  },
  boon: {
    label: 'Boon', emoji: '✨', color: '#6b8f5e',
    placeholder: 'e.g. You found a hidden cache. Claim it.',
  },
  'player-notify': {
    label: 'Notify', emoji: '📢', color: '#4fc3f7',
    placeholder: 'e.g. The storm is closing in — head for high ground.',
  },
  'gm-only': {
    label: 'GM only', emoji: '📍', color: '#999999',
    placeholder: '',
  },
};

export const KIND_ORDER: CheckpointKind[] = ['hazard', 'boon', 'player-notify', 'gm-only'];

/** The kind that determines a checkpoint's map-pin color (single event, or first queued). */
export function checkpointKind(cp: Checkpoint): CheckpointKind {
  return cp.event?.kind ?? cp.eventQueue?.[0]?.kind ?? 'gm-only';
}

/** Build a clean event with no undefined fields (Firestore rejects undefined). */
export function buildEvent(
  kind: CheckpointKind,
  message: string,
  audience: EventAudience
): CheckpointEvent {
  const e: CheckpointEvent = { kind };
  if (kind !== 'gm-only' && message.trim()) e.message = message.trim();
  if (kind === 'player-notify' && audience === 'all-players') e.audience = 'all-players';
  return e;
}

/** Player-visibility presentation (#48), mirroring the mobile checkpoints editor. */
export const VIS_META: Record<CheckpointVisibility, { label: string; emoji: string; hint: string }> = {
  'gm-only': { label: 'Hidden', emoji: '🙈', hint: 'Only you see it. Players never see this checkpoint.' },
  always: { label: 'Always shown', emoji: '📍', hint: 'Players see this location from the start — but not what it does until they cross it.' },
  'on-reveal': { label: 'Reveal later', emoji: '⏱️', hint: 'Hidden until a reveal trigger fires (trap, timed/triggered drop, or sponsor drop).' },
};

export const VIS_ORDER: CheckpointVisibility[] = ['gm-only', 'always', 'on-reveal'];

/** Time-based checkpoint state presentation (#54), mirroring mobile STATE_META. */
export const STATE_META: Record<CheckpointState, { label: string; emoji: string; color: string }> = {
  closed: { label: 'Closed', emoji: '🔒', color: '#777777' },
  boon: { label: 'Boon', emoji: '✨', color: '#6b8f5e' },
  hazard: { label: 'Hazard', emoji: '⚠️', color: '#e8402a' },
  notification: { label: 'Notify', emoji: '📢', color: '#4fc3f7' },
};

export const STATE_ORDER: CheckpointState[] = ['closed', 'boon', 'hazard', 'notification'];

/** One-line summary of what a checkpoint does, matching mobile behaviorSummary. */
export function behaviorSummary(cp: Checkpoint): string {
  if (cp.transitions && cp.transitions.length > 0) {
    return `Scheduled · ${cp.transitions.length} change${cp.transitions.length === 1 ? '' : 's'}`;
  }
  const steps = cp.eventQueue?.length ?? 0;
  if (steps > 0) return `By arrival · ${steps} step${steps === 1 ? '' : 's'}`;
  return KIND_META[checkpointKind(cp)].label;
}

/** Emoji map for the icon picker (#53). Keys match mobile CHECKPOINT_ICONS[].key. */
export const CHECKPOINT_ICON_EMOJIS: Record<string, string> = {
  flag: '🚩', pin: '📍', skull: '💀', cache: '🎁', water: '💧',
  fire: '🔥', forest: '🌿', mountain: '⛰️', base: '🏠', trophy: '🏆',
  medic: '🩺', star: '⭐',
};

export const DEFAULT_CHECKPOINT_ICON = 'flag';

export function checkpointIconEmoji(key?: string): string {
  return CHECKPOINT_ICON_EMOJIS[key ?? ''] ?? '📍';
}
