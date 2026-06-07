import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, ActivityIndicator,
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
  updateCheckpoint, deleteCheckpoint, setRevealSchedule, stateEventFields,
  openCheckpointNow, closeCheckpointNow, clearCheckpointWindow, checkpointWindowState,
  revealCheckpointNow,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import {
  KIND_META, VIS_META, VIS_ORDER, STATE_META, STATE_ORDER, hexToRgba, buildEvent, ordinalLabel,
  KindChips, AudienceToggle,
} from '@/components/checkpointForm';
import { CHECKPOINT_ICONS, DEFAULT_CHECKPOINT_ICON } from '@/constants/checkpointIcons';
import type {
  Checkpoint, CheckpointEvent, CheckpointKind, EventAudience, CheckpointVisibility,
  RevealTrigger, RevealAudience, CheckpointReveal, CheckpointState, CheckpointTransition,
} from '@/types';

type BehaviorMode = 'static' | 'scheduled';
type TransitionRow = { atMinute: string; state: CheckpointState; message: string };

export default function CheckpointEditorScreen() {
  const { gameId, checkpointId } = useLocalSearchParams<{ gameId: string; checkpointId: string }>();
  const { checkpoints, members, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);
  const players = members.filter((m) => m.role === 'player');

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const cp = checkpoints.find((c) => c.id === checkpointId) ?? null;

  // Form state — populated once the checkpoint doc first loads.
  const [name, setName] = useState('');
  const [radius, setRadius] = useState('100');
  const [icon, setIcon] = useState<string>(DEFAULT_CHECKPOINT_ICON);

  const [behaviorMode, setBehaviorMode] = useState<BehaviorMode>('static');

  // Static behavior
  const [cpMode, setCpMode] = useState<'single' | 'queue'>('single');
  const [cpKind, setCpKind] = useState<CheckpointKind>('gm-only');
  const [cpMessage, setCpMessage] = useState('');
  const [cpAudience, setCpAudience] = useState<EventAudience>('crossing-player');
  const [cpQueue, setCpQueue] = useState<CheckpointEvent[]>([]);

  // Scheduled behavior (#54)
  const [initialState, setInitialState] = useState<CheckpointState>('closed');
  const [initialMessage, setInitialMessage] = useState('');
  const [transitions, setTransitions] = useState<TransitionRow[]>([]);

  // Visibility / reveal (#48)
  const [cpVisibility, setCpVisibility] = useState<CheckpointVisibility>('gm-only');
  const [cpRevealTrigger, setCpRevealTrigger] = useState<RevealTrigger>('on-crossing');
  const [cpRevealAudience, setCpRevealAudience] = useState<RevealAudience>('all');
  const [cpRevealOffset, setCpRevealOffset] = useState('');
  const [cpRecipients, setCpRecipients] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const loadedRef = useRef(false);

  // Initialize the form from the checkpoint doc the first time it resolves.
  useEffect(() => {
    if (!cp || loadedRef.current) return;
    loadedRef.current = true;
    setName(cp.name);
    setRadius(String(cp.radius));
    setIcon(cp.icon ?? DEFAULT_CHECKPOINT_ICON);

    if (cp.transitions && cp.transitions.length > 0) {
      setBehaviorMode('scheduled');
      setInitialState(cp.initialState ?? 'closed');
      setTransitions(
        [...cp.transitions]
          .sort((a, b) => a.atMinute - b.atMinute)
          .map((t) => ({ atMinute: String(t.atMinute), state: t.state, message: t.message ?? '' }))
      );
    } else {
      setBehaviorMode('static');
      if (cp.eventQueue && cp.eventQueue.length > 0) {
        setCpMode('queue');
        setCpQueue(cp.eventQueue);
      } else {
        setCpMode('single');
        setCpKind(cp.event?.kind ?? 'gm-only');
        setCpMessage(cp.event?.message ?? '');
        setCpAudience(cp.event?.audience ?? 'crossing-player');
      }
    }

    setCpVisibility(cp.visibility ?? 'gm-only');
    setCpRevealTrigger(cp.reveal?.trigger ?? 'on-crossing');
    setCpRevealAudience(cp.reveal?.audience ?? 'all');
    setCpRevealOffset(cp.reveal?.offsetMinutes != null ? String(cp.reveal.offsetMinutes) : '');
    setCpRecipients(cp.reveal?.recipientPlayerIds ?? []);
  }, [cp]);

  function updateQueueItem(index: number, patch: Partial<CheckpointEvent>) {
    setCpQueue((q) => q.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }
  const addQueueItem = () => setCpQueue((q) => [...q, { kind: 'hazard' }]);
  const removeQueueItem = (index: number) => setCpQueue((q) => q.filter((_, i) => i !== index));
  function toggleRecipient(id: string) {
    setCpRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  function addTransition() {
    setTransitions((t) => [...t, { atMinute: '', state: 'hazard', message: '' }]);
  }
  function updateTransition(i: number, patch: Partial<TransitionRow>) {
    setTransitions((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeTransition(i: number) {
    setTransitions((t) => t.filter((_, idx) => idx !== i));
  }

  /** Assemble the reveal config from the form, or undefined for gm-only/always. */
  function buildReveal(): CheckpointReveal | undefined {
    if (cpVisibility !== 'on-reveal') return undefined;
    const audience: RevealAudience = cpRevealTrigger === 'on-crossing' ? 'triggerer' : cpRevealAudience;
    const reveal: CheckpointReveal = { trigger: cpRevealTrigger, audience };
    if (cpRevealTrigger === 'game-time') {
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
    if (cpVisibility === 'on-reveal' && reveal?.audience === 'specific-players' && cpRecipients.length === 0) {
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

    if (behaviorMode === 'scheduled') {
      // Validate + normalize the timed transitions (#54).
      const rows = transitions
        .map((r) => ({ atMinute: Math.round(Number(r.atMinute)), state: r.state, message: r.message.trim() }))
        .filter((r) => !isNaN(r.atMinute));
      if (rows.some((r) => r.atMinute <= 0)) {
        Alert.alert('Transition times must be after start', 'Use “Starts as” for the state at minute 0; each change needs a positive minute.');
        return;
      }
      const cleaned: CheckpointTransition[] = rows
        .sort((a, b) => a.atMinute - b.atMinute)
        .map((r) => ({ atMinute: r.atMinute, state: r.state, ...(r.message ? { message: r.message } : {}) }));
      updates.initialState = initialState;
      updates.transitions = cleaned;
      updates.eventQueue = firestore.FieldValue.delete();
      // Make the initial state effective immediately (the sweep handles later transitions).
      Object.assign(updates, stateEventFields(initialState, initialMessage.trim() || undefined));
    } else {
      // Static behavior — clear any scheduled-mode artifacts.
      updates.transitions = firestore.FieldValue.delete();
      updates.initialState = firestore.FieldValue.delete();
      updates.currentState = firestore.FieldValue.delete();
      // If leaving scheduled mode, also clear the window it may have set.
      if (cp.transitions && cp.transitions.length > 0) {
        updates.opensAt = firestore.FieldValue.delete();
        updates.closesAt = firestore.FieldValue.delete();
      }
      if (cpMode === 'queue') {
        const cleaned = cpQueue.map((e) => buildEvent(e.kind, e.message ?? '', e.audience ?? 'crossing-player'));
        if (cleaned.length === 0) { Alert.alert('Add at least one step, or switch to “Same for everyone”.'); return; }
        updates.eventQueue = cleaned;
        updates.event = firestore.FieldValue.delete();
      } else {
        updates.event = buildEvent(cpKind, cpMessage, cpAudience);
        updates.eventQueue = firestore.FieldValue.delete();
      }
    }

    // Game-time reveal pairs to a deterministic run-sheet row (#48).
    const revealOffset = cpVisibility === 'on-reveal' && cpRevealTrigger === 'game-time'
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

  async function handleWindowAction(action: 'open' | 'close' | 'clear') {
    if (!gameId || !checkpointId) return;
    try {
      if (action === 'open') await openCheckpointNow(gameId, checkpointId);
      else if (action === 'close') await closeCheckpointNow(gameId, checkpointId);
      else await clearCheckpointWindow(gameId, checkpointId);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
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

  function confirmDelete() {
    if (!gameId || !cp) return;
    Alert.alert(`Delete "${cp.name}"?`, 'This cannot be undone.', [
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

  const windowState = cp ? checkpointWindowState(cp, now) : 'always';
  const windowStatusText = {
    always: 'Always live — fires whenever a player crosses.',
    open: 'Open — firing now.',
    pending: 'Scheduled — not open yet.',
    closed: 'Closed — not firing.',
  }[windowState];
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

        {/* Icon picker (#53) */}
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

        {/* Behavior mode (#53/#54) */}
        <Text style={styles.sectionLabel}>What happens here?</Text>
        <View style={styles.segment}>
          <TouchableOpacity onPress={() => setBehaviorMode('static')} style={[styles.segBtn, behaviorMode === 'static' && styles.segBtnActive]}>
            <Text style={[styles.segText, behaviorMode === 'static' && styles.segTextActive]}>Same all game</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setBehaviorMode('scheduled')} style={[styles.segBtn, behaviorMode === 'scheduled' && styles.segBtnActive]}>
            <Text style={[styles.segText, behaviorMode === 'scheduled' && styles.segTextActive]}>Changes over time</Text>
          </TouchableOpacity>
        </View>

        {behaviorMode === 'static' ? (
          <>
            <View style={styles.segment}>
              <TouchableOpacity onPress={() => setCpMode('single')} style={[styles.segBtn, cpMode === 'single' && styles.segBtnActive]}>
                <Text style={[styles.segText, cpMode === 'single' && styles.segTextActive]}>Same for everyone</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setCpMode('queue')} style={[styles.segBtn, cpMode === 'queue' && styles.segBtnActive]}>
                <Text style={[styles.segText, cpMode === 'queue' && styles.segTextActive]}>By arrival order</Text>
              </TouchableOpacity>
            </View>

            {cpMode === 'single' ? (
              <>
                <KindChips value={cpKind} onChange={setCpKind} />
                {cpKind !== 'gm-only' && (
                  <Input label="Message" value={cpMessage} onChangeText={setCpMessage} placeholder={KIND_META[cpKind].placeholder} multiline style={styles.messageInput} />
                )}
                {cpKind === 'player-notify' && <AudienceToggle value={cpAudience} onChange={setCpAudience} />}
                {cpKind === 'gm-only' && <Text style={styles.hintSmall}>Only you (the GM) are alerted. The player sees nothing.</Text>}
              </>
            ) : (
              <>
                <Text style={styles.hintSmall}>Each arriver, in order, triggers the next step. Once the steps run out, later arrivers just ping you.</Text>
                {cpQueue.map((e, i) => (
                  <View key={i} style={styles.queueRow}>
                    <View style={styles.queueRowHead}>
                      <Text style={styles.queueLabel}>{ordinalLabel(i)}</Text>
                      <TouchableOpacity onPress={() => removeQueueItem(i)} hitSlop={8}>
                        <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                    <KindChips value={e.kind} onChange={(k) => updateQueueItem(i, { kind: k })} />
                    {e.kind !== 'gm-only' && (
                      <Input value={e.message ?? ''} onChangeText={(t) => updateQueueItem(i, { message: t })} placeholder={KIND_META[e.kind].placeholder} multiline style={styles.messageInput} />
                    )}
                    {e.kind === 'player-notify' && (
                      <AudienceToggle value={e.audience ?? 'crossing-player'} onChange={(a) => updateQueueItem(i, { audience: a })} />
                    )}
                  </View>
                ))}
                <TouchableOpacity onPress={addQueueItem} style={styles.addStep}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                  <Text style={styles.addStepText}>Add step</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        ) : (
          // Scheduled / time-based transitions (#54)
          <>
            <Text style={styles.hintSmall}>
              The checkpoint starts in one state and flips at set times after Start. A “Closed” state is hidden and won’t fire.
            </Text>
            <Text style={styles.subLabel}>Starts as</Text>
            <StateChips value={initialState} onChange={setInitialState} />
            {initialState !== 'closed' && (
              <Input value={initialMessage} onChangeText={setInitialMessage} placeholder="Optional message" multiline style={styles.messageInput} />
            )}

            <Text style={styles.subLabel}>Then changes</Text>
            {transitions.length === 0 && <Text style={styles.hintSmall}>No timed changes yet.</Text>}
            {transitions.map((row, i) => (
              <View key={i} style={styles.queueRow}>
                <View style={styles.queueRowHead}>
                  <Text style={styles.queueLabel}>Change {i + 1}</Text>
                  <TouchableOpacity onPress={() => removeTransition(i)} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <Input
                  label="Minutes after start"
                  value={row.atMinute}
                  onChangeText={(t) => updateTransition(i, { atMinute: t })}
                  keyboardType="number-pad"
                  placeholder="e.g. 30"
                />
                <StateChips value={row.state} onChange={(s) => updateTransition(i, { state: s })} />
                {row.state !== 'closed' && (
                  <Input value={row.message} onChangeText={(t) => updateTransition(i, { message: t })} placeholder="Optional message" multiline style={styles.messageInput} />
                )}
              </View>
            ))}
            <TouchableOpacity onPress={addTransition} style={styles.addStep}>
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={styles.addStepText}>Add timed change</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Player visibility (#48) */}
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

        {cpVisibility === 'on-reveal' && (
          <>
            <Text style={styles.sectionLabel}>Reveal when</Text>
            <View style={styles.segment}>
              {([
                { v: 'on-crossing', label: 'On crossing' },
                { v: 'game-time', label: 'At a set time' },
                { v: 'gm-manual', label: 'When I tap' },
              ] as { v: RevealTrigger; label: string }[]).map((o) => (
                <TouchableOpacity key={o.v} onPress={() => setCpRevealTrigger(o.v)} style={[styles.segBtn, cpRevealTrigger === o.v && styles.segBtnActive]}>
                  <Text style={[styles.segText, cpRevealTrigger === o.v && styles.segTextActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {cpRevealTrigger === 'on-crossing' && (
              <Text style={styles.hintSmall}>Becomes visible to the player who crosses it (a trap they now know).</Text>
            )}
            {cpRevealTrigger === 'game-time' && (
              <Input label="Minutes after start" value={cpRevealOffset} onChangeText={setCpRevealOffset} keyboardType="number-pad" placeholder="e.g. 60" />
            )}

            {cpRevealTrigger !== 'on-crossing' && (
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

            {cpRevealTrigger === 'gm-manual' && (
              <TouchableOpacity onPress={handleRevealNow} style={[styles.chip, { alignSelf: 'flex-start', borderColor: Colors.secondary }]}>
                <Ionicons name={isRevealed ? 'eye' : 'eye-outline'} size={14} color={Colors.secondary} />
                <Text style={[styles.chipText, { color: Colors.secondary }]}>{isRevealed ? 'Revealed — reveal again' : 'Reveal now'}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* Timed site window (#12) — only for static checkpoints; scheduled ones own the window */}
        {behaviorMode === 'static' && (
          <>
            <Text style={styles.sectionLabel}>Timed site window</Text>
            <Text style={styles.hintSmall}>{windowStatusText}</Text>
            <View style={styles.chips}>
              <TouchableOpacity onPress={() => handleWindowAction('open')} style={[styles.chip, windowState === 'open' && { borderColor: Colors.success, backgroundColor: hexToRgba(Colors.success, 0.15) }]}>
                <Ionicons name="lock-open-outline" size={14} color={windowState === 'open' ? Colors.success : Colors.textSecondary} />
                <Text style={[styles.chipText, windowState === 'open' && { color: Colors.success }]}>Open now</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleWindowAction('close')} style={[styles.chip, windowState === 'closed' && { borderColor: Colors.danger, backgroundColor: hexToRgba(Colors.danger, 0.15) }]}>
                <Ionicons name="lock-closed-outline" size={14} color={windowState === 'closed' ? Colors.danger : Colors.textSecondary} />
                <Text style={[styles.chipText, windowState === 'closed' && { color: Colors.danger }]}>Close now</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleWindowAction('clear')} style={[styles.chip, windowState === 'always' && { borderColor: Colors.primary, backgroundColor: hexToRgba(Colors.primary, 0.15) }]}>
                <Ionicons name="infinite-outline" size={14} color={windowState === 'always' ? Colors.primary : Colors.textSecondary} />
                <Text style={[styles.chipText, windowState === 'always' && { color: Colors.primary }]}>Always live</Text>
              </TouchableOpacity>
            </View>
          </>
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
    </SafeAreaView>
  );
}

function StateChips({ value, onChange }: { value: CheckpointState; onChange: (s: CheckpointState) => void }) {
  return (
    <View style={styles.chips}>
      {STATE_ORDER.map((s) => {
        const meta = STATE_META[s];
        const active = s === value;
        return (
          <TouchableOpacity
            key={s}
            onPress={() => onChange(s)}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 24, paddingBottom: 48, gap: 12 },
  coords: { fontSize: 12, color: Colors.textSecondary },
  sectionLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  subLabel: { color: Colors.text, fontSize: 14, fontWeight: '700', marginTop: 4 },
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
  messageInput: { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' },
  hintSmall: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  queueRow: { backgroundColor: Colors.surfaceElevated, borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, borderColor: Colors.border },
  queueRowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  queueLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  addStep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  addStepText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  recipientList: { backgroundColor: Colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingVertical: 4 },
  recipientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12 },
  recipientName: { color: Colors.text, fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 8 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },
});
