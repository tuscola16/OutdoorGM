import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { useNow } from '@/hooks/useNow';
import {
  openLobby, startGame, endGame, sendBroadcast, updateCheckpoint,
  setTestStep, rearmCheckpoint, rationInterval,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import type { CheckpointEvent } from '@/types';

/** The walkthrough is a fixed, ordered list of steps. Each is `auto` (a live Firestore
 * predicate must be satisfied before Next enables), or `manual` (no signal — the GM reads
 * the prompt aloud and taps to confirm). Per-step controls/detection are rendered inline. */
type StepId =
  | 'capture-boundary' | 'place-checkpoint' | 'open-lobby' | 'start-game'
  | 'confirm-dots' | 'checkpoint-walkthrough' | 'checkpoint-push'
  | 'ration-window' | 'ration-push' | 'gm-broadcast' | 'broadcast-confirm'
  | 'self-elimination' | 'gm-elimination' | 'sos-raise' | 'sos-clear' | 'completion';

const STEPS: { id: StepId; title: string; instruction: string }[] = [
  { id: 'capture-boundary', title: 'Set the play area',
    instruction: 'Open the map and frame this room as the play boundary, then save it.' },
  { id: 'place-checkpoint', title: 'Place the Test Checkpoint',
    instruction: 'Stand where you want the checkpoint — ideally the farthest room — and set it to your location.' },
  { id: 'open-lobby', title: 'Open the lobby',
    instruction: 'Tell everyone to join with the player code and gather in one room. Then open the lobby.' },
  { id: 'start-game', title: 'Start the game',
    instruction: 'Once everyone has joined, start the game so location tracking begins.' },
  { id: 'confirm-dots', title: 'Confirm everyone is tracking',
    instruction: 'Open the map on the GM screen and confirm you see a live dot for every player.' },
  { id: 'checkpoint-walkthrough', title: 'Walk the checkpoint',
    instruction: 'Send players to the Test Checkpoint one at a time. Watch the five event types fire in order: Hazard → Boon → message to that player → message to all → GM-only ping.' },
  { id: 'checkpoint-push', title: 'Confirm checkpoint pushes',
    instruction: 'Ask the players: did they get the hazard / boon / message push notifications?' },
  { id: 'ration-window', title: 'Ration check',
    instruction: 'Tell every player to open the app and photograph a ration card before the window closes.' },
  { id: 'ration-push', title: 'Confirm ration prompt',
    instruction: 'Ask the players: did they see the ration prompt and get the reminder push?' },
  { id: 'gm-broadcast', title: 'Send an announcement',
    instruction: 'Send a free-text announcement to all players to verify the broadcast feed.' },
  { id: 'broadcast-confirm', title: 'Confirm the announcement',
    instruction: 'Ask the players: did the announcement appear in their feed and arrive as a push?' },
  { id: 'self-elimination', title: 'Player self-eliminates',
    instruction: 'Tell ONE player to tap "I\'ve been killed" in their app.' },
  { id: 'gm-elimination', title: 'GM eliminates a player',
    instruction: 'Open the Players list and eliminate a different player with the skull button.' },
  { id: 'sos-raise', title: 'Player raises an SOS',
    instruction: 'Tell a player to tap "Safety alert — I need help".' },
  { id: 'sos-clear', title: 'Clear the SOS',
    instruction: 'Open the Players list and clear that player\'s safety alert.' },
  { id: 'completion', title: 'Test complete',
    instruction: 'Review the checklist below, then end the test game.' },
];
const LAST = STEPS.length - 1;

/** Friendly label for a queued checkpoint event (what fires for the next arriver). */
function eventLabel(ev: CheckpointEvent | undefined): string {
  if (!ev) return 'GM-only ping (queue exhausted)';
  switch (ev.kind) {
    case 'hazard': return 'Hazard ⚠️';
    case 'boon': return 'Boon ✨';
    case 'player-notify':
      return ev.audience === 'all-players' ? 'Message to all players 📢' : 'Message to crossing player 💬';
    case 'gm-only': return 'GM-only ping 📍';
    default: return ev.kind;
  }
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export default function TestRunnerScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const {
    game, phase, checkpoints, members, playerLocations, arrivals, broadcasts, rations, loadGame,
  } = useGame();
  const router = useRouter();
  const now = useNow(1000);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bcText, setBcText] = useState('');
  const initialized = useRef(false);
  const stepEnteredAt = useRef(Date.now());
  const sawSos = useRef(false);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  // Resume at the persisted cursor once the game loads (never moves backward — the
  // cursor only advances on Next). Most per-step progress is re-derived live below.
  useEffect(() => {
    if (!initialized.current && game) {
      initialized.current = true;
      setStep(Math.min(Math.max(game.testStepIndex ?? 0, 0), LAST));
    }
  }, [game]);

  // Track when the GM arrived at the current step (for "happened since here" predicates)
  // and latch that we've seen an SOS at least once.
  useEffect(() => { stepEnteredAt.current = Date.now(); }, [step]);
  useEffect(() => { if (members.some((m) => m.sos === true)) sawSos.current = true; }, [members]);

  const players = members.filter((m) => m.role === 'player');
  const cp = checkpoints[0];
  const cpArrivals = cp ? arrivals.filter((a) => a.checkpointId === cp.id) : [];
  // Real (non-tombstone) arrivals — used to pick who to re-arm and show who has crossed.
  const realArrivals = cpArrivals.filter((a) => players.some((p) => p.userId === a.playerId));
  const consumed = cpArrivals.length; // queue position consumed (real + re-armed tombstones)
  const queue = cp?.eventQueue ?? [];

  const ri = rationInterval(game, now);
  const rationIdx = ri?.index ?? -1;
  const rationSubs = rations.filter((r) => r.intervalIndex === rationIdx);

  const current = STEPS[step];

  // `done`: true = predicate satisfied (green, Next enabled); false = not yet (Next
  // disabled, Skip offered); null = manual step (Next always enabled).
  function evaluate(id: StepId): boolean | null {
    switch (id) {
      case 'capture-boundary': return !!game?.boundary;
      case 'place-checkpoint': return !!cp && (cp.latitude !== 0 || cp.longitude !== 0);
      case 'open-lobby': return phase === 'lobby' || phase === 'play';
      case 'start-game': return phase === 'play';
      case 'confirm-dots': return null;
      case 'checkpoint-walkthrough': return consumed >= 5;
      case 'checkpoint-push': return null;
      case 'ration-window': return players.length > 0 && rationSubs.length >= players.length;
      case 'ration-push': return null;
      case 'gm-broadcast':
        return broadcasts.some(
          (b) => b.kind === 'gm-message' && (b.createdAt?.toMillis?.() ?? 0) >= stepEnteredAt.current
        );
      case 'broadcast-confirm': return null;
      case 'self-elimination': return players.some((p) => p.out && p.cause === 'self');
      case 'gm-elimination': return players.some((p) => p.out && p.cause === 'gm-other');
      case 'sos-raise': return members.some((m) => m.sos === true);
      case 'sos-clear': return sawSos.current && members.every((m) => !m.sos);
      case 'completion': return null;
    }
  }

  const done = evaluate(current.id);

  // --- Actions ---
  async function run(fn: () => Promise<void>) {
    if (!gameId) return;
    setBusy(true);
    try { await fn(); }
    catch (err) { Alert.alert('Error', friendlyError(err)); }
    finally { setBusy(false); }
  }

  function goNext() {
    const next = Math.min(step + 1, LAST);
    setStep(next);
    if (gameId) setTestStep(gameId, next).catch(() => {});
  }
  function goPrev() { setStep((s) => Math.max(0, s - 1)); }

  async function setCheckpointHere() {
    if (!cp) { Alert.alert('No checkpoint found for this test.'); return; }
    await run(async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location off', 'Enable location access to place the checkpoint here.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await updateCheckpoint(gameId!, cp.id, {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
    });
  }

  async function handleRearm() {
    if (!cp) return;
    const last = realArrivals[0]; // arrivals are newest-first
    if (!last) {
      Alert.alert('No arrival yet', 'Wait for a player to reach the checkpoint, then re-arm to fire the next event.');
      return;
    }
    await run(() => rearmCheckpoint(gameId!, last.playerId, cp.id));
  }

  async function handleSendBroadcast() {
    const text = bcText.trim();
    if (!text) { Alert.alert('Type a short announcement first.'); return; }
    await run(async () => { await sendBroadcast(gameId!, text); setBcText(''); });
  }

  function handleEnd() {
    Alert.alert('End test game?', 'This ends the game and returns you to My Games.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End test',
        style: 'destructive',
        onPress: () => run(async () => { await endGame(gameId!); router.replace('/(app)/games'); }),
      },
    ]);
  }

  // --- Per-step detail / controls ---
  function renderControls() {
    switch (current.id) {
      case 'capture-boundary':
        return (
          <>
            <StatusLine done={done} text={done ? 'Boundary set' : 'No boundary yet'} />
            <Button title="Open Play Area map" variant="secondary" onPress={() => router.push(`/(app)/gm/${gameId}/boundary`)} />
          </>
        );
      case 'place-checkpoint':
        return (
          <>
            <StatusLine done={done} text={done ? 'Checkpoint placed' : 'Checkpoint not placed yet'} />
            <Button title="Set checkpoint to my location" onPress={setCheckpointHere} loading={busy} />
            <Button title="Fine-tune on map" variant="ghost" onPress={() => router.push(`/(app)/gm/${gameId}/boundary`)} />
          </>
        );
      case 'open-lobby':
        return (
          <>
            <StatusLine done={done} text={`${players.length} player${players.length === 1 ? '' : 's'} joined`} />
            <Button
              title={phase === 'setup' ? 'Open to Players' : 'Lobby open'}
              onPress={() => run(() => openLobby(gameId!))}
              loading={busy}
              disabled={phase !== 'setup'}
            />
          </>
        );
      case 'start-game':
        return (
          <>
            <StatusLine done={done} text={done ? 'Game in play' : 'Not started'} />
            <Button
              title={phase === 'play' ? 'Started' : 'Start Game'}
              onPress={() => run(() => startGame(gameId!))}
              loading={busy}
              disabled={phase === 'play' || phase === 'setup'}
            />
          </>
        );
      case 'confirm-dots':
        return (
          <StatusLine
            done={players.length > 0 && playerLocations.length >= players.length}
            text={`${playerLocations.length} of ${players.length} player${players.length === 1 ? '' : 's'} reporting a location`}
          />
        );
      case 'checkpoint-walkthrough':
        return (
          <>
            <StatusLine done={done} text={`Events fired: ${Math.min(consumed, 5)} / 5`} />
            {!done && (
              <Text style={styles.detail}>
                Next arriver fires: <Text style={styles.detailStrong}>{eventLabel(queue[consumed])}</Text>
              </Text>
            )}
            {players.length >= 5 ? (
              <Text style={styles.hint}>With 5+ players, each arriver fires the next event automatically — just send them through.</Text>
            ) : (
              <>
                <Text style={styles.hint}>Fewer than 5 players: after a player crosses, re-arm and send the same player back to fire the next event.</Text>
                <Button title="Fire next event (re-arm last arriver)" variant="secondary" onPress={handleRearm} loading={busy} />
              </>
            )}
            {realArrivals.length > 0 && (
              <Text style={styles.hint}>Last crossing: {realArrivals[0].playerName}</Text>
            )}
          </>
        );
      case 'ration-window':
        return (
          <>
            <StatusLine
              done={done}
              text={`${rationSubs.length} of ${players.length} submitted this window`}
            />
            {ri && ri.windowEndsAt > now && (
              <Text style={styles.detail}>Window closes in <Text style={styles.detailStrong}>{mmss(ri.windowEndsAt - now)}</Text></Text>
            )}
          </>
        );
      case 'gm-broadcast':
        return (
          <>
            <StatusLine done={done} text={done ? 'Announcement sent' : 'No announcement sent yet'} />
            <TextInput
              style={styles.input}
              value={bcText}
              onChangeText={setBcText}
              placeholder="e.g. This is a test announcement."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
            <Button title="Send to all players" onPress={handleSendBroadcast} loading={busy} />
          </>
        );
      case 'self-elimination':
        return <StatusLine done={done} text={done ? 'A player marked themselves killed' : 'Waiting for a self-elimination'} />;
      case 'gm-elimination':
        return (
          <>
            <StatusLine done={done} text={done ? 'You eliminated a player' : 'Waiting for a GM elimination'} />
            <Button title="Open Players list" variant="secondary" onPress={() => router.push(`/(app)/gm/${gameId}/players`)} />
          </>
        );
      case 'sos-raise':
        return <StatusLine done={done} text={done ? 'A player raised an SOS' : 'Waiting for a safety alert'} />;
      case 'sos-clear':
        return (
          <>
            <StatusLine done={done} text={done ? 'SOS cleared' : sawSos.current ? 'SOS still active — clear it' : 'No SOS seen yet'} />
            <Button title="Open Players list" variant="secondary" onPress={() => router.push(`/(app)/gm/${gameId}/players`)} />
          </>
        );
      case 'completion':
        return <Summary />;
      default:
        return null;
    }
  }

  const playerDependent: StepId[] = [
    'confirm-dots', 'checkpoint-walkthrough', 'ration-window',
    'self-elimination', 'gm-elimination', 'sos-raise',
  ];
  const waitingForPlayers = playerDependent.includes(current.id) && players.length === 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Test walkthrough</Text>
        <Text style={styles.count}>{step + 1}/{STEPS.length}</Text>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${(step / LAST) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.stepKicker}>STEP {step + 1}</Text>
        <Text style={styles.stepTitle}>{current.title}</Text>
        <Text style={styles.instruction}>{current.instruction}</Text>

        {!cp && (current.id === 'place-checkpoint' || current.id === 'checkpoint-walkthrough') && (
          <Text style={styles.warn}>No test checkpoint found on this game. It should have been created automatically.</Text>
        )}
        {waitingForPlayers && (
          <Text style={styles.warn}>Waiting for at least one player to join…</Text>
        )}

        <View style={styles.controls}>{renderControls()}</View>
      </ScrollView>

      <View style={styles.footer}>
        {current.id === 'completion' ? (
          <Button title="End test game" variant="danger" onPress={handleEnd} loading={busy} />
        ) : (
          <>
            <Button
              title="Next step"
              onPress={goNext}
              disabled={done === false}
            />
            {done === false && (
              <TouchableOpacity onPress={goNext} style={styles.skip}>
                <Text style={styles.skipText}>Skip this step</Text>
              </TouchableOpacity>
            )}
          </>
        )}
        {step > 0 && (
          <TouchableOpacity onPress={goPrev} style={styles.prev}>
            <Text style={styles.prevText}>← Previous</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function StatusLine({ done, text }: { done: boolean | null; text: string }) {
  const ok = done === true;
  return (
    <View style={styles.statusLine}>
      <Ionicons
        name={ok ? 'checkmark-circle' : done === false ? 'ellipse-outline' : 'information-circle-outline'}
        size={18}
        color={ok ? Colors.success : Colors.textSecondary}
      />
      <Text style={[styles.statusText, ok && { color: Colors.success }]}>{text}</Text>
    </View>
  );
}

function Summary() {
  return (
    <View style={styles.summary}>
      <Text style={styles.summaryTitle}>You verified:</Text>
      {[
        'Play boundary & checkpoint placement',
        'All five checkpoint event types',
        'Ration photo submission',
        'Player self-elimination',
        'GM elimination',
        'SOS raise & clear',
      ].map((t) => (
        <View key={t} style={styles.statusLine}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={styles.statusText}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  count: { fontSize: 14, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  progressTrack: { height: 4, backgroundColor: Colors.surfaceElevated, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: 4, backgroundColor: Colors.primary },
  body: { padding: 20, paddingBottom: 32 },
  stepKicker: { color: Colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  stepTitle: { color: Colors.text, fontSize: 26, fontWeight: '800', marginTop: 4 },
  instruction: { color: Colors.textSecondary, fontSize: 16, lineHeight: 24, marginTop: 12 },
  warn: {
    color: Colors.warning, fontSize: 14, lineHeight: 20, marginTop: 16,
    backgroundColor: Colors.warning + '1A', borderRadius: 10, padding: 12,
  },
  controls: { marginTop: 24, gap: 12 },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600', flex: 1 },
  detail: { color: Colors.textSecondary, fontSize: 14 },
  detailStrong: { color: Colors.text, fontWeight: '800' },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 19 },
  input: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    color: Colors.text, fontSize: 15, padding: 14, minHeight: 80,
  },
  footer: { paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  skip: { alignSelf: 'center', paddingVertical: 6 },
  skipText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  prev: { alignSelf: 'center', paddingVertical: 6 },
  prevText: { color: Colors.textMuted, fontSize: 14, fontWeight: '600' },
  summary: { gap: 10 },
  summaryTitle: { color: Colors.text, fontSize: 16, fontWeight: '700', marginBottom: 4 },
});
