import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useGame } from '@/context/GameContext';
import { Colors } from '@/constants/colors';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  addScheduledEvent, updateScheduledEvent, deleteScheduledEvent,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { KIND_META, checkpointKind } from '@/components/checkpointForm';
import { checkpointIcon } from '@/constants/checkpointIcons';
import type { ScheduledEvent, ScheduledActionType, RunbookEntry } from '@/types';

/** One-line summary of a checkpoint's runbook, for the run-sheet list (#60). */
function behaviorSummary(entries: RunbookEntry[]): string {
  if (!entries || entries.length === 0) return 'No behavior yet';
  if (entries.length === 1) return KIND_META[entries[0].effect?.kind ?? 'gm-notify'].label;
  return `${entries.length} runbook entries`;
}

// The authoring UI presents one option per row; `player-count` is a templated
// `broadcast`, so the UI key is richer than the stored `type`. Checkpoint open/close
// windows moved to timed runbook entries (#60); the run sheet keeps broadcasts,
// reminders, gear drops, and the timed marker reveal.
type ActionKey = 'broadcast' | 'player-count' | 'gear-drop' | 'gm-reminder' | 'reveal-checkpoint';
type Needs = 'message' | 'checkpoint' | 'none';

const ACTIONS: {
  key: ActionKey;
  type: ScheduledActionType;
  template?: 'player-count';
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  needs: Needs;
}[] = [
  { key: 'broadcast', type: 'broadcast', label: 'Announcement', icon: 'megaphone-outline', needs: 'message' },
  { key: 'player-count', type: 'broadcast', template: 'player-count', label: 'Player count', icon: 'people-outline', needs: 'none' },
  { key: 'gear-drop', type: 'gear-drop', label: 'Gear drop', icon: 'gift-outline', needs: 'message' },
  { key: 'gm-reminder', type: 'gm-reminder', label: 'GM reminder', icon: 'alarm-outline', needs: 'message' },
  { key: 'reveal-checkpoint', type: 'reveal-checkpoint', label: 'Reveal marker', icon: 'eye-outline', needs: 'checkpoint' },
];

const actionFor = (key: ActionKey) => ACTIONS.find((a) => a.key === key)!;
const keyForEvent = (ev: ScheduledEvent): ActionKey =>
  ev.template === 'player-count' ? 'player-count' : (ev.type as ActionKey);

function offsetLabel(min: number | null | undefined): string {
  if (min == null) return '—';
  if (min === 0) return 'At start';
  return `+${min} min`;
}

export default function RunSheetScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { scheduledEvents, checkpoints, runbookEntries, loadGame } = useGame();
  const router = useRouter();

  // Runbook entries grouped by checkpoint, for the per-checkpoint summary (#60).
  const entriesByCp = new Map<string, RunbookEntry[]>();
  for (const e of runbookEntries) {
    const list = entriesByCp.get(e.checkpointId) ?? [];
    list.push(e);
    entriesByCp.set(e.checkpointId, list);
  }
  const cpEntries = (id: string): RunbookEntry[] => entriesByCp.get(id) ?? [];

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  // Editor modal state
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<ActionKey>('broadcast');
  const [offset, setOffset] = useState('0');
  const [message, setMessage] = useState('');
  const [checkpointId, setCheckpointId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const action = actionFor(actionKey);

  function openAdd() {
    setEditId(null);
    setActionKey('broadcast');
    setOffset('0');
    setMessage('');
    setCheckpointId(undefined);
    setShowModal(true);
  }

  function openEdit(ev: ScheduledEvent) {
    setEditId(ev.id);
    setActionKey(keyForEvent(ev));
    setOffset(ev.offsetMinutes != null ? String(ev.offsetMinutes) : '0');
    setMessage(ev.message ?? '');
    setCheckpointId(ev.checkpointId);
    setShowModal(true);
  }

  async function handleSave() {
    if (!gameId) return;
    const offsetMinutes = parseInt(offset, 10);
    if (isNaN(offsetMinutes) || offsetMinutes < 0) {
      Alert.alert('Enter minutes after game start (0 or more).');
      return;
    }
    if (action.needs === 'message' && !message.trim()) {
      Alert.alert('Enter a message for this action.');
      return;
    }
    if (action.needs === 'checkpoint' && !checkpointId) {
      Alert.alert('Pick a checkpoint for this action.');
      return;
    }

    const data = {
      type: action.type,
      offsetMinutes,
      ...(action.template ? { template: action.template } : { template: null }),
      ...(action.needs === 'message' ? { message: message.trim() } : { message: '' }),
      ...(action.needs === 'checkpoint' ? { checkpointId } : {}),
    };

    setSaving(true);
    try {
      if (editId) await updateScheduledEvent(gameId, editId, data);
      else await addScheduledEvent(gameId, data);
      setShowModal(false);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(ev: ScheduledEvent) {
    if (!gameId) return;
    Alert.alert('Delete action?', 'This run-sheet step will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteScheduledEvent(gameId, ev.id);
          } catch (err) {
            Alert.alert('Error', friendlyError(err));
          }
        },
      },
    ]);
  }

  function summaryFor(ev: ScheduledEvent): string {
    const a = actionFor(keyForEvent(ev));
    if (a.needs === 'checkpoint') {
      const cp = checkpoints.find((c) => c.id === ev.checkpointId);
      return `${a.label} · ${cp?.name ?? 'deleted checkpoint'}`;
    }
    if (a.key === 'player-count') return 'Pushes the living-tribute count to all players';
    return ev.message || a.label;
  }

  const sorted = [...scheduledEvents].sort(
    (a, b) => (a.offsetMinutes ?? Infinity) - (b.offsetMinutes ?? Infinity)
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Run-sheet</Text>
        <Text style={styles.count}>{scheduledEvents.length}</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View>
            <View style={styles.cpSection}>
              <Text style={styles.cpHeading}>Checkpoints</Text>
              {checkpoints.length === 0 ? (
                <Text style={styles.cpEmptyText}>
                  No checkpoints yet — add them on the Checkpoints map, then tap one here to set what it does.
                </Text>
              ) : (
                checkpoints.map((cp) => {
                  const color = KIND_META[checkpointKind(cpEntries(cp.id))].color;
                  return (
                    <TouchableOpacity
                      key={cp.id}
                      style={styles.cpRow}
                      onPress={() => router.push(`/(app)/gm/${gameId}/checkpoint/${cp.id}`)}
                    >
                      <View style={[styles.cpIcon, { borderColor: color }]}>
                        <Ionicons name={checkpointIcon(cp.icon)} size={16} color={color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cpName}>{cp.name}</Text>
                        <Text style={styles.cpSummary}>{behaviorSummary(cpEntries(cp.id))}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <Text style={styles.timedHeading}>Timed actions</Text>
            <Text style={styles.intro}>
              Timed actions fire automatically, measured from when you Start the game. They run
              only while the game is in play.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const a = actionFor(keyForEvent(item));
          const fired = item.firedAt != null;
          return (
            <View style={[styles.row, fired && styles.rowFired]}>
              <View style={styles.timeCol}>
                <Text style={[styles.timeText, fired && styles.dim]}>{offsetLabel(item.offsetMinutes)}</Text>
                {fired && <Text style={styles.firedText}>fired</Text>}
              </View>
              <Ionicons name={a.icon} size={20} color={fired ? Colors.textMuted : Colors.primary} style={{ marginHorizontal: 8 }} />
              <View style={styles.info}>
                <Text style={[styles.rowLabel, fired && styles.dim]}>{a.label}</Text>
                <Text style={styles.rowSub} numberOfLines={2}>{summaryFor(item)}</Text>
              </View>
              <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn}>
                <Ionicons name="pencil-outline" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="time-outline" size={40} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No timed actions yet.{'\n'}Add broadcasts, site open/close, drops, and reminders.</Text>
          </View>
        }
      />

      <View style={styles.footer}>
        <Button title="Add timed action" onPress={openAdd} />
      </View>

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{editId ? 'Edit action' : 'New action'}</Text>

              <Text style={styles.sectionLabel}>Action</Text>
              <View style={styles.chips}>
                {ACTIONS.map((a) => {
                  const active = a.key === actionKey;
                  return (
                    <TouchableOpacity
                      key={a.key}
                      onPress={() => setActionKey(a.key)}
                      style={[styles.chip, active && styles.chipActive]}
                    >
                      <Ionicons name={a.icon} size={14} color={active ? Colors.primary : Colors.textSecondary} />
                      <Text style={[styles.chipText, active && { color: Colors.primary }]}>{a.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Input
                label="Minutes after game start"
                value={offset}
                onChangeText={setOffset}
                keyboardType="number-pad"
                placeholder="0"
              />

              {action.needs === 'message' && (
                <Input
                  label="Message"
                  value={message}
                  onChangeText={setMessage}
                  placeholder={
                    action.key === 'gm-reminder'
                      ? 'e.g. Send Aaron to The Dock now'
                      : action.key === 'gear-drop'
                        ? 'e.g. A supply drop is at Trestle Bridge'
                        : 'e.g. The storm is closing in — head for high ground'
                  }
                  multiline
                  style={styles.messageInput}
                />
              )}

              {action.key === 'player-count' && (
                <Text style={styles.hintSmall}>Auto-fills the living-tribute count (e.g. “7 tributes remain”) and pushes it to all players.</Text>
              )}
              {action.key === 'gm-reminder' && (
                <Text style={styles.hintSmall}>Only you (the GM) are notified — players see nothing.</Text>
              )}

              {action.needs === 'checkpoint' && (
                <>
                  <Text style={styles.sectionLabel}>Checkpoint</Text>
                  {checkpoints.length === 0 ? (
                    <Text style={styles.hintSmall}>No checkpoints yet — add one on the Play Area map first.</Text>
                  ) : (
                    <View style={styles.cpList}>
                      {checkpoints.map((cp) => {
                        const active = cp.id === checkpointId;
                        return (
                          <TouchableOpacity
                            key={cp.id}
                            onPress={() => setCheckpointId(cp.id)}
                            style={[styles.cpOption, active && styles.cpOptionActive]}
                          >
                            <Ionicons
                              name={active ? 'radio-button-on' : 'radio-button-off'}
                              size={18}
                              color={active ? Colors.primary : Colors.textSecondary}
                            />
                            <Text style={styles.cpOptionText}>{cp.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  )}
                </>
              )}

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
                <Button title={editId ? 'Save' : 'Add'} onPress={handleSave} loading={saving} fullWidth={false} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  count: { fontSize: 14, color: Colors.textSecondary },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  intro: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  cpSection: { marginBottom: 16 },
  cpHeading: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  cpEmptyText: { color: Colors.textMuted, fontSize: 13, lineHeight: 19 },
  cpRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpIcon: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, backgroundColor: Colors.surfaceElevated,
  },
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSummary: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  timedHeading: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowFired: { opacity: 0.6 },
  timeCol: { width: 64, alignItems: 'flex-start' },
  timeText: { fontSize: 14, fontWeight: '800', color: Colors.text },
  firedText: { fontSize: 10, color: Colors.success, fontWeight: '700' },
  dim: { color: Colors.textSecondary },
  info: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  rowSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  iconBtn: { padding: 6, marginLeft: 2 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  footer: { padding: 16 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%',
  },
  modalContent: { padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  sectionLabel: {
    color: Colors.textSecondary, fontSize: 13, fontWeight: '500',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  messageInput: { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' },
  hintSmall: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  cpList: { gap: 6 },
  cpOption: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surfaceElevated,
  },
  cpOptionActive: { borderColor: Colors.primary },
  cpOptionText: { color: Colors.text, fontSize: 14, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
});
