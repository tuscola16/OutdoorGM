import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import firestore from '@react-native-firebase/firestore';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors } from '@/constants/colors';
import {
  updateCheckpoint, deleteCheckpoint, setRevealSchedule, revealCheckpointNow, fireRunbookEntry,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import {
  KIND_META, VIS_META, VIS_ORDER, TRIGGER_META, hexToRgba,
} from '@/components/checkpointForm';
import { CHECKPOINT_ICONS, DEFAULT_CHECKPOINT_ICON } from '@/constants/checkpointIcons';
import type {
  Checkpoint, CheckpointVisibility, RevealTrigger, RevealAudience, CheckpointReveal,
  RunbookEntry, TimedBound,
} from '@/types';

export default function CheckpointEditorScreen() {
  const { gameId, checkpointId } = useLocalSearchParams<{ gameId: string; checkpointId: string }>();
  const { checkpoints, runbookEntries, members, loadGame } = useGame();
  const router = useRouter();
  const players = members.filter((m) => m.role === 'player');

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const cp = checkpoints.find((c) => c.id === checkpointId) ?? null;
  const entries = runbookEntries
    .filter((e) => e.checkpointId === checkpointId)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  // Form state — populated once the checkpoint doc first loads.
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('100');
  const [icon, setIcon] = useState<string>(DEFAULT_CHECKPOINT_ICON);

  // Visibility / reveal (#60)
  const [cpVisibility, setCpVisibility] = useState<CheckpointVisibility>('hidden');
  const [cpRevealTrigger, setCpRevealTrigger] = useState<RevealTrigger>('player');
  const [cpRevealAudience, setCpRevealAudience] = useState<RevealAudience>('all');
  const [cpRevealOffset, setCpRevealOffset] = useState('');
  const [cpRecipients, setCpRecipients] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);

  // GM-prompted fire modal
  const [fireEntry, setFireEntry] = useState<RunbookEntry | null>(null);
  const [fireTargets, setFireTargets] = useState<string[]>([]);
  const [firing, setFiring] = useState(false);

  useEffect(() => {
    if (!cp || loadedRef.current) return;
    loadedRef.current = true;
    setName(cp.name);
    setRadius(String(cp.radius));
    setIcon(cp.icon ?? DEFAULT_CHECKPOINT_ICON);
    setCpVisibility(cp.visibility ?? 'hidden');
    setCpRevealTrigger(cp.reveal?.trigger ?? 'player');
    setCpRevealAudience(cp.reveal?.audience ?? 'all');
    setCpRevealOffset(cp.reveal?.offsetMinutes != null ? String(cp.reveal.offsetMinutes) : '');
    setCpRecipients(cp.reveal?.recipientPlayerIds ?? []);
  }, [cp]);

  function toggleRecipient(id: string) {
    setCpRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }
  function toggleFireTarget(id: string) {
    setFireTargets((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  /** Assemble the reveal config from the form, or undefined for hidden/shown. */
  function buildReveal(): CheckpointReveal | undefined {
    if (cpVisibility !== 'shown-on-trigger') return undefined;
    const audience: RevealAudience = cpRevealTrigger === 'player' ? 'triggerer' : cpRevealAudience;
    const reveal: CheckpointReveal = { trigger: cpRevealTrigger, audience };
    if (cpRevealTrigger === 'timed') {
      reveal.offsetMinutes = Math.max(0, Math.round(Number(cpRevealOffset) || 0));
    }
    if (audience === 'specific-players') reveal.recipientPlayerIds = cpRecipients;
    return reveal;
  }

  async function handleSave() {
    if (!gameId || !checkpointId || !cp) return;
    if (!name.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const rad = parseInt(radius, 10);
    if (isNaN(rad) || rad < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }

    const reveal = buildReveal();
    if (cpVisibility === 'shown-on-trigger' && reveal?.audience === 'specific-players' && cpRecipients.length === 0) {
      Alert.alert('Pick at least one player', 'A sponsor drop needs at least one recipient, or choose “All players”.');
      return;
    }

    const updates: Record<string, unknown> = {
      name: name.trim(),
      radius: rad,
      icon,
      visibility: cpVisibility,
      reveal: reveal ?? firestore.FieldValue.delete(),
    };

    // A timed reveal pairs to a deterministic run-sheet row (#60).
    const revealOffset = cpVisibility === 'shown-on-trigger' && cpRevealTrigger === 'timed'
      ? Math.max(0, Math.round(Number(cpRevealOffset) || 0))
      : null;

    setSaving(true);
    try {
      await updateCheckpoint(gameId, checkpointId, updates as Partial<Omit<Checkpoint, 'id'>>);
      await setRevealSchedule(gameId, checkpointId, revealOffset);
      router.back();
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRevealNow() {
    if (!gameId || !cp) return;
    try {
      await revealCheckpointNow(gameId, cp);
      Alert.alert('Revealed', `${cp.name} is now visible to players.`);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  function openFire(entry: RunbookEntry) {
    setFireEntry(entry);
    setFireTargets([]);
    setFiring(false);
  }

  async function handleFire() {
    if (!gameId || !fireEntry) return;
    setFiring(true);
    try {
      await fireRunbookEntry(gameId, fireEntry.id, fireTargets.length > 0 ? fireTargets : undefined);
      const who = fireTargets.length > 0 ? `${fireTargets.length} player(s)` : 'all players';
      setFireEntry(null);
      Alert.alert('Fired', `“${fireEntry.name}” sent to ${who}.`);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setFiring(false);
    }
  }

  function confirmDelete() {
    if (!gameId || !cp) return;
    Alert.alert(`Delete "${cp.name}"?`, 'This also deletes its runbook entries. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteCheckpoint(gameId, cp.id); router.back(); }
          catch (err) { Alert.alert('Error', friendlyError(err)); }
        },
      },
    ]);
  }

  const isRevealed = !!cp?.revealedAt;

  if (!cp) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Checkpoint</Text>
        </View>
        <View style={styles.loading}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Loading checkpoint…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{name || 'Checkpoint'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.coords}>📍 {cp.latitude.toFixed(5)}, {cp.longitude.toFixed(5)}</Text>
        <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Cornucopia" />
        <Input label="Detection Radius (meters)" value={radius} onChangeText={setRadius} keyboardType="number-pad" placeholder="100" />

        {/* Icon picker */}
        <Text style={styles.sectionLabel}>Map icon</Text>
        <View style={styles.iconGrid}>
          {CHECKPOINT_ICONS.map((opt) => {
            const active = opt.key === icon;
            return (
              <TouchableOpacity
                key={opt.key}
                onPress={() => setIcon(opt.key)}
                style={[styles.iconChip, active && styles.iconChipActive]}
              >
                <Ionicons name={opt.icon} size={20} color={active ? Colors.primary : Colors.textSecondary} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Player visibility (#60) */}
        <Text style={styles.sectionLabel}>Player visibility</Text>
        <View style={styles.chips}>
          {VIS_ORDER.map((v) => {
            const active = v === cpVisibility;
            return (
              <TouchableOpacity
                key={v}
                onPress={() => setCpVisibility(v)}
                style={[styles.chip, active && { borderColor: Colors.secondary, backgroundColor: hexToRgba(Colors.secondary, 0.15) }]}
              >
                <Ionicons name={VIS_META[v].icon} size={14} color={active ? Colors.secondary : Colors.textSecondary} />
                <Text style={[styles.chipText, active && { color: Colors.secondary }]}>{VIS_META[v].label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hintSmall}>{VIS_META[cpVisibility].hint}</Text>

        {cpVisibility === 'shown-on-trigger' && (
          <>
            <Text style={styles.sectionLabel}>Reveal when</Text>
            <View style={styles.segment}>
              {([
                { v: 'player', label: 'On crossing' },
                { v: 'timed', label: 'At a set time' },
                { v: 'gm', label: 'When I tap' },
              ] as { v: RevealTrigger; label: string }[]).map((o) => (
                <TouchableOpacity key={o.v} onPress={() => setCpRevealTrigger(o.v)} style={[styles.segBtn, cpRevealTrigger === o.v && styles.segBtnActive]}>
                  <Text style={[styles.segText, cpRevealTrigger === o.v && styles.segTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {cpRevealTrigger === 'player' && (
              <Text style={styles.hintSmall}>Becomes visible to the player who crosses it (a trap they now know).</Text>
            )}
            {cpRevealTrigger === 'timed' && (
              <Input label="Minutes after start" value={cpRevealOffset} onChangeText={setCpRevealOffset} keyboardType="number-pad" placeholder="e.g. 60" />
            )}

            {cpRevealTrigger !== 'player' && (
              <>
                <Text style={styles.sectionLabel}>Reveal to</Text>
                <View style={styles.segment}>
                  {([
                    { v: 'all', label: 'All players' },
                    { v: 'specific-players', label: 'Specific players' },
                  ] as { v: RevealAudience; label: string }[]).map((o) => (
                    <TouchableOpacity key={o.v} onPress={() => setCpRevealAudience(o.v)} style={[styles.segBtn, cpRevealAudience === o.v && styles.segBtnActive]}>
                      <Text style={[styles.segText, cpRevealAudience === o.v && styles.segTextActive]}>{o.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {cpRevealAudience === 'specific-players' && (
                  players.length === 0 ? (
                    <Text style={styles.hintSmall}>No players have joined yet — they'll appear here once they do.</Text>
                  ) : (
                    <View style={styles.recipientList}>
                      {players.map((p) => {
                        const on = cpRecipients.includes(p.userId);
                        return (
                          <TouchableOpacity key={p.userId} style={styles.recipientRow} onPress={() => toggleRecipient(p.userId)}>
                            <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? Colors.secondary : Colors.textSecondary} />
                            <Text style={styles.recipientName}>{p.displayName}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )
                )}
              </>
            )}

            {cpRevealTrigger === 'gm' && (
              <TouchableOpacity onPress={handleRevealNow} style={[styles.chip, { alignSelf: 'flex-start', borderColor: Colors.secondary }]}>
                <Ionicons name={isRevealed ? 'eye' : 'eye-outline'} size={14} color={Colors.secondary} />
                <Text style={[styles.chipText, { color: Colors.secondary }]}>{isRevealed ? 'Revealed — reveal again' : 'Reveal now'}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Runbook entries — authored on the web dashboard, read-only here (#60) */}
        <Text style={styles.sectionLabel}>Runbook ({entries.length})</Text>
        <Text style={styles.hintSmall}>
          Author runbook entries on the web GM dashboard. You can fire GM-prompted entries here.
        </Text>
        {entries.length === 0 ? (
          <Text style={styles.hintSmall}>No runbook entries for this checkpoint yet.</Text>
        ) : (
          entries.map((e) => {
            const kindMeta = KIND_META[e.effect?.kind ?? 'gm-notify'];
            const trig = TRIGGER_META[e.trigger];
            return (
              <View key={e.id} style={styles.entryRow}>
                <View style={[styles.entryIcon, { borderColor: kindMeta.color }]}>
                  <Ionicons name={kindMeta.icon} size={16} color={kindMeta.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryName}>{e.name}</Text>
                  <Text style={styles.entrySub}>
                    {trig.label} · {kindMeta.label} · priority {e.priority ?? 0}
                    {e.trigger === 'fixed-order' && e.queueSlots ? ` · ${e.queueSlots.length} slots` : ''}
                    {e.trigger === 'timed' ? ` · ${timedSummary(e.startAt, e.endAt)}` : ''}
                  </Text>
                </View>
                {e.trigger === 'gm-prompted' && (
                  <TouchableOpacity onPress={() => openFire(e)} style={styles.fireBtn}>
                    <Ionicons name="flash" size={14} color={Colors.white} />
                    <Text style={styles.fireBtnText}>Fire</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        <View style={styles.actions}>
          <Button title="Cancel" onPress={() => router.back()} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
          <Button title="Save" onPress={handleSave} loading={saving} fullWidth={false} style={{ flex: 1 }} />
        </View>
        <TouchableOpacity onPress={confirmDelete} style={styles.deleteRow}>
          <Ionicons name="trash-outline" size={18} color={Colors.danger} />
          <Text style={styles.deleteText}>Delete checkpoint</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* GM-prompted fire: pick targets (#60) */}
      <Modal visible={!!fireEntry} transparent animationType="slide" onRequestClose={() => setFireEntry(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Fire “{fireEntry?.name}”</Text>
              <Text style={styles.hintSmall}>
                Leave everyone unchecked to send to all living players, or pick specific recipients.
              </Text>
              {players.length === 0 ? (
                <Text style={styles.hintSmall}>No players have joined yet.</Text>
              ) : (
                <View style={styles.recipientList}>
                  {players.map((p) => {
                    const on = fireTargets.includes(p.userId);
                    return (
                      <TouchableOpacity key={p.userId} style={styles.recipientRow} onPress={() => toggleFireTarget(p.userId)}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? Colors.secondary : Colors.textSecondary} />
                        <Text style={styles.recipientName}>{p.displayName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              <View style={styles.actions}>
                <Button title="Cancel" onPress={() => setFireEntry(null)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
                <Button title="Fire" onPress={handleFire} loading={firing} fullWidth={false} style={{ flex: 1 }} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/** Compact label for a timed entry's window. */
function timedSummary(start?: TimedBound, end?: TimedBound): string {
  const label = (b: TimedBound | undefined, fallback: string): string => {
    if (!b) return fallback;
    if (b.kind === 'game-start') return 'start';
    if (b.kind === 'game-end') return 'end';
    if (typeof b.atMinute === 'number') return `+${b.atMinute}m`;
    return fallback;
  };
  return `${label(start, 'start')}→${label(end, 'end')}`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 24, paddingBottom: 48, gap: 12 },
  coords: { fontSize: 12, color: Colors.textSecondary },
  sectionLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconChip: {
    width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  iconChipActive: { borderColor: Colors.primary, backgroundColor: hexToRgba(Colors.primary, 0.15) },
  segment: { flexDirection: 'row', backgroundColor: Colors.surfaceElevated, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.primary },
  segText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  segTextActive: { color: Colors.white },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  hintSmall: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.surfaceElevated, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border },
  entryIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, backgroundColor: Colors.surface },
  entryName: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  entrySub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  fireBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
  fireBtnText: { color: Colors.white, fontSize: 13, fontWeight: '700' },
  recipientList: { backgroundColor: Colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 4 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  recipientName: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 8 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  modalContent: { padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
});
