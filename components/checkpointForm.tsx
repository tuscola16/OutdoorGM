import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/colors';
import type {
  Checkpoint, CheckpointEvent, CheckpointKind, EventAudience, CheckpointVisibility,
  CheckpointState,
} from '@/types';

// Shared presentation + helpers for authoring a checkpoint's behavior (ROADMAP #53/#54).
// Extracted from the map screen so the full-screen behavior editor and the map can both use
// them without duplication.

/** Per-kind chip label/icon, pin color, and a message placeholder. */
export const KIND_META: Record<
  CheckpointKind,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; placeholder: string }
> = {
  hazard: { label: 'Hazard', icon: 'warning', color: Colors.danger, placeholder: 'e.g. A beast attacks! Defend or flee.' },
  boon: { label: 'Boon', icon: 'sparkles', color: Colors.success, placeholder: 'e.g. You found a hidden cache. Claim it.' },
  'player-notify': { label: 'Notify', icon: 'megaphone', color: Colors.playerDot, placeholder: 'e.g. The storm is closing in — head for high ground.' },
  'gm-only': { label: 'GM only', icon: 'eye-off', color: Colors.textSecondary, placeholder: '' },
};
export const KIND_ORDER: CheckpointKind[] = ['hazard', 'boon', 'player-notify', 'gm-only'];

/** Visibility (#48): who can see the marker, independent of what the checkpoint does. */
export const VIS_META: Record<CheckpointVisibility, { label: string; icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  'gm-only': { label: 'Hidden', icon: 'eye-off', hint: 'Only you see it. Players never see this checkpoint on their map.' },
  always: { label: 'Always shown', icon: 'eye', hint: 'Players see this location from the start — but not what it does until they cross it.' },
  'on-reveal': { label: 'Reveal later', icon: 'time', hint: 'Hidden until a reveal trigger fires (a trap, a timed/triggered drop, or a sponsor drop).' },
};
export const VIS_ORDER: CheckpointVisibility[] = ['gm-only', 'always', 'on-reveal'];

/** Time-based state (#54) presentation for the transitions editor. */
export const STATE_META: Record<CheckpointState, { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  closed: { label: 'Closed', icon: 'lock-closed', color: Colors.textSecondary },
  boon: { label: 'Boon', icon: 'sparkles', color: Colors.success },
  hazard: { label: 'Hazard', icon: 'warning', color: Colors.danger },
  notification: { label: 'Notify', icon: 'megaphone', color: Colors.playerDot },
};
export const STATE_ORDER: CheckpointState[] = ['closed', 'boon', 'hazard', 'notification'];

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

/** The kind a checkpoint currently presents (single event, first queue step, else gm-only). */
export function checkpointKind(cp: Checkpoint): CheckpointKind {
  return cp.event?.kind ?? cp.eventQueue?.[0]?.kind ?? 'gm-only';
}

export function buildEvent(kind: CheckpointKind, message: string, audience: EventAudience): CheckpointEvent {
  const e: CheckpointEvent = { kind };
  if (kind !== 'gm-only' && message.trim()) e.message = message.trim();
  if (kind === 'player-notify' && audience === 'all-players') e.audience = 'all-players';
  return e;
}

export function ordinalLabel(i: number): string {
  const n = i + 1;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix} arriver`;
}

export function KindChips({ value, onChange }: { value: CheckpointKind; onChange: (k: CheckpointKind) => void }) {
  return (
    <View style={styles.chips}>
      {KIND_ORDER.map((k) => {
        const meta = KIND_META[k];
        const active = k === value;
        return (
          <TouchableOpacity
            key={k}
            onPress={() => onChange(k)}
            style={[styles.chip, active && { borderColor: meta.color, backgroundColor: hexToRgba(meta.color, 0.15) }]}
          >
            <Ionicons name={meta.icon} size={14} color={active ? meta.color : Colors.textSecondary} />
            <Text style={[styles.chipText, active && { color: meta.color }]}>{meta.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function AudienceToggle({ value, onChange }: { value: EventAudience; onChange: (a: EventAudience) => void }) {
  const opts: { v: EventAudience; label: string }[] = [
    { v: 'crossing-player', label: 'Crossing player' },
    { v: 'all-players', label: 'All players' },
  ];
  return (
    <View style={styles.segment}>
      {opts.map((o) => (
        <TouchableOpacity key={o.v} onPress={() => onChange(o.v)} style={[styles.segBtn, value === o.v && styles.segBtnActive]}>
          <Text style={[styles.segText, value === o.v && styles.segTextActive]}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceElevated, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.primary },
  segText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: Colors.white },
});
