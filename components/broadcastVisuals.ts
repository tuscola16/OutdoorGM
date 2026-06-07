import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import type { Broadcast } from '@/types';

/**
 * Shared visual mapping for player-facing broadcasts (icon / color / title).
 * Used by both the passive {@link BroadcastFeed} list and the heads-up
 * {@link AlertOverlay} so a hazard looks the same in the feed and over the app.
 */
export function iconFor(b: Broadcast): keyof typeof Ionicons.glyphMap {
  switch (b.kind) {
    case 'death':
      return 'skull-outline';
    case 'winner':
      return 'trophy-outline';
    case 'player-count':
      return 'people-outline';
    case 'checkpoint-event':
      switch (b.eventKind) {
        case 'hazard':
          return 'warning-outline';
        case 'boon':
          return 'sparkles-outline';
        case 'notify':
          return 'megaphone-outline';
        default:
          return 'flash-outline';
      }
    default:
      return 'megaphone-outline';
  }
}

export function colorFor(b: Broadcast): string {
  switch (b.kind) {
    case 'death':
      return Colors.danger;
    case 'winner':
      return Colors.primary;
    case 'checkpoint-event':
      switch (b.eventKind) {
        case 'hazard':
          return Colors.danger;
        case 'boon':
          return Colors.success;
        default:
          return Colors.textSecondary;
      }
    default:
      return Colors.textSecondary;
  }
}

/** Short headline for the heads-up overlay. */
export function titleFor(b: Broadcast): string {
  switch (b.kind) {
    case 'death':
      return 'A tribute has fallen';
    case 'winner':
      return 'We have a winner';
    case 'player-count':
      return 'Tribute count';
    case 'checkpoint-event':
      switch (b.eventKind) {
        case 'hazard':
          return 'Hazard!';
        case 'boon':
          return 'A boon';
        case 'notify':
          return 'Message';
        default:
          return 'Event';
      }
    default:
      return 'Game Master';
  }
}

/** Critical kinds vibrate harder and must be tapped to dismiss (can't auto-clear). */
export function isCritical(b: Broadcast): boolean {
  return b.kind === 'death' || (b.kind === 'checkpoint-event' && b.eventKind === 'hazard');
}
