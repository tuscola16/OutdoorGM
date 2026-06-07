import { Ionicons } from '@expo/vector-icons';

/**
 * Selectable map icons for a checkpoint (ROADMAP #53). The icon is chosen at placement time
 * and is independent of what the checkpoint *does* (its kind can change over the game via
 * #54 transitions), so it gets its own small palette rather than reusing the kind icons.
 * `Checkpoint.icon` stores the `key`; render with `checkpointIcon(key)`.
 */
export const CHECKPOINT_ICONS: {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}[] = [
  { key: 'flag', icon: 'flag', label: 'Flag' },
  { key: 'pin', icon: 'location', label: 'Pin' },
  { key: 'skull', icon: 'skull', label: 'Skull' },
  { key: 'cache', icon: 'gift', label: 'Cache' },
  { key: 'water', icon: 'water', label: 'Water' },
  { key: 'fire', icon: 'bonfire', label: 'Fire' },
  { key: 'forest', icon: 'leaf', label: 'Forest' },
  { key: 'mountain', icon: 'triangle', label: 'Peak' },
  { key: 'base', icon: 'home', label: 'Base' },
  { key: 'trophy', icon: 'trophy', label: 'Trophy' },
  { key: 'medic', icon: 'medkit', label: 'Medic' },
  { key: 'star', icon: 'star', label: 'Star' },
];

export const DEFAULT_CHECKPOINT_ICON = 'flag';

/** Resolve an icon key to an Ionicons glyph, falling back to a generic pin. */
export function checkpointIcon(key?: string): keyof typeof Ionicons.glyphMap {
  return CHECKPOINT_ICONS.find((i) => i.key === key)?.icon ?? 'location';
}
