import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  Alert, ScrollView, TextInput, FlatList, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useGame } from '@/context/GameContext';
import { useAuth } from '@/context/AuthContext';
import { GameMap } from '@/components/GameMap';
import { AlertFeed } from '@/components/AlertFeed';
import { Button } from '@/components/ui/Button';
import { Colors } from '@/constants/colors';
import { onForegroundMessage } from '@/services/notificationService';
import { endGame, openLobby, reopenSetup, startGame, updateGameConfig, deleteGame, setGameArchived, sendBroadcast, gameConfig } from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useElapsed, useRemaining, formatDuration } from '@/hooks/useElapsed';
import { useNow } from '@/hooks/useNow';
import { STALE_MS } from '@/services/locationStatus';
import type { Checkpoint, GameMember } from '@/types';

type Tab = 'map' | 'alerts';

const PHASE_LABEL: Record<string, string> = {
  setup: 'SETUP',
  lobby: 'LOBBY',
  play: 'IN PLAY',
  results: 'RESULTS',
};

export default function GMGameScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, phase, checkpoints, members, playerLocations, arrivals, rations, loadGame, clearGame } = useGame();
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('map');
  const [showCodes, setShowCodes] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [rulesText, setRulesText] = useState('');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [cfgDuration, setCfgDuration] = useState('');
  const [cfgPlayerCount, setCfgPlayerCount] = useState(true);
  const [cfgWinner, setCfgWinner] = useState(true);
  const [cfgBattery, setCfgBattery] = useState(true);
  const [cfgRations, setCfgRations] = useState(true);
  const [cfgRationInterval, setCfgRationInterval] = useState('');
  const [cfgUniqueCards, setCfgUniqueCards] = useState(true);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [lastSeenArrivals, setLastSeenArrivals] = useState(0);
  const [copiedCode, setCopiedCode] = useState<'player' | 'gm' | null>(null);
  const [busy, setBusy] = useState(false);
  const prevArrivalsRef = useRef(0);

  const elapsed = useElapsed(game?.startedAt, game?.endedAt);
  const remaining = useRemaining(game?.startedAt, gameConfig(game).durationMinutes, game?.endedAt);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
    return () => clearGame();
  }, [gameId]);

  // Haptic feedback + unseen badge on new arrivals
  useEffect(() => {
    if (arrivals.length > prevArrivalsRef.current) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    prevArrivalsRef.current = arrivals.length;

    if (tab === 'alerts') {
      setLastSeenArrivals(arrivals.length);
      setNewAlertCount(0);
    } else {
      setNewAlertCount(Math.max(0, arrivals.length - lastSeenArrivals));
    }
  }, [arrivals.length, tab]);

  useEffect(() => {
    return onForegroundMessage(() => {});
  }, []);

  async function handleCopyCode(code: string, type: 'player' | 'gm') {
    try {
      await Clipboard.setStringAsync(code);
      setCopiedCode(type);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      Alert.alert('Could not copy', 'Please copy the code manually.');
    }
  }

  function handleCheckpointPress(checkpoint: Checkpoint) {
    Alert.alert(
      checkpoint.name,
      `Radius: ${checkpoint.radius}m\nLat: ${checkpoint.latitude.toFixed(6)}\nLng: ${checkpoint.longitude.toFixed(6)}`,
      [{ text: 'OK' }]
    );
  }

  async function runPhaseAction(fn: () => Promise<void>) {
    if (!gameId) return;
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmStart() {
    Alert.alert(
      'Start the game?',
      'Players will see their timer begin. You can end the game at any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start', onPress: () => runPhaseAction(() => startGame(gameId!)) },
      ]
    );
  }

  function handleEndGame() {
    Alert.alert(
      'End Game?',
      'This stops play for everyone and shows results.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Game',
          style: 'destructive',
          onPress: () => runPhaseAction(() => endGame(gameId!)),
        },
      ]
    );
  }

  function handleDeleteGame() {
    Alert.alert(
      `Delete "${game?.name ?? 'this game'}"?`,
      'This permanently removes the game, its checkpoints, and all members for everyone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => runPhaseAction(async () => {
            await deleteGame(gameId!);
            router.replace('/(app)/games');
          }),
        },
      ]
    );
  }

  function handleArchiveGame() {
    if (!user) return;
    runPhaseAction(async () => {
      await setGameArchived(gameId!, user.uid, true);
      router.replace('/(app)/games');
    });
  }

  function openRulesEditor() {
    setRulesText(game?.rules ?? '');
    setShowRules(true);
  }

  async function saveRules() {
    await runPhaseAction(() => updateGameConfig(gameId!, { rules: rulesText.trim() }));
    setShowRules(false);
  }

  function openConfigEditor() {
    const cfg = gameConfig(game);
    setCfgDuration(String(cfg.durationMinutes));
    setCfgPlayerCount(cfg.playerCountBroadcast);
    setCfgWinner(cfg.winnerDetection);
    setCfgBattery(cfg.batterySaver);
    setCfgRations(cfg.rationsEnabled);
    setCfgRationInterval(String(cfg.rationIntervalMinutes));
    setCfgUniqueCards(cfg.enforceUniqueRationCards);
    setShowConfig(true);
  }

  async function saveConfig() {
    const minutes = Math.max(5, Math.round(Number(cfgDuration) || gameConfig(game).durationMinutes));
    const rationMins = Math.max(1, Math.round(Number(cfgRationInterval) || gameConfig(game).rationIntervalMinutes));
    await runPhaseAction(() =>
      updateGameConfig(gameId!, {
        config: {
          durationMinutes: minutes,
          playerCountBroadcast: cfgPlayerCount,
          winnerDetection: cfgWinner,
          batterySaver: cfgBattery,
          rationsEnabled: cfgRations,
          rationIntervalMinutes: rationMins,
          enforceUniqueRationCards: cfgUniqueCards,
        },
      })
    );
    setShowConfig(false);
  }

  async function sendBroadcastMessage() {
    const text = broadcastText.trim();
    if (!text) return;
    await runPhaseAction(() => sendBroadcast(gameId!, text));
    setBroadcastText('');
    setShowBroadcast(false);
  }

  // Quick action: push the current living-player count to everyone (Rule 24).
  async function broadcastPlayerCount() {
    const living = members.filter((m) => m.role === 'player' && !m.out).length;
    await runPhaseAction(() =>
      sendBroadcast(gameId!, `${living} ${living === 1 ? 'tribute remains' : 'tributes remain'}.`)
    );
  }

  const players = members.filter((m) => m.role === 'player');
  const pendingRations = rations.filter((r) => r.status === 'pending').length;

  // Players who have silently dropped off the map (no fix, or none in 2 min). Since
  // Outdoor GM replaces Pingo as the only tracker, the GM must see this immediately.
  const now = useNow(10000);
  const lastFixByUser = new Map<string, number>();
  for (const loc of playerLocations) {
    const ms = loc.updatedAt?.toMillis?.();
    if (ms) lastFixByUser.set(loc.userId, ms);
  }
  const notReporting = players.filter((p) => {
    if (p.out) return false;
    const ms = lastFixByUser.get(p.userId);
    return ms == null || now - ms >= STALE_MS;
  }).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace('/(app)/games')}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.gameName} numberOfLines={1}>{game?.name ?? '…'}</Text>
          <View style={styles.phaseRow}>
            <Text style={styles.gmBadge}>GAME MASTER</Text>
            <View style={styles.phasePill}>
              <Text style={styles.phasePillText}>{PHASE_LABEL[phase]}</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          {(phase === 'lobby' || phase === 'play') && (
            <TouchableOpacity onPress={() => setShowBroadcast(true)} style={styles.headerBtn}>
              <Ionicons name="megaphone-outline" size={22} color={Colors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setShowCodes(true)} style={styles.headerBtn}>
            <Ionicons name="qr-code-outline" size={22} color={Colors.text} />
          </TouchableOpacity>
          {phase === 'play' && gameConfig(game).rationsEnabled && (
            <TouchableOpacity onPress={() => router.push(`/(app)/gm/${gameId}/rations`)} style={styles.headerBtn}>
              <Ionicons name="restaurant-outline" size={22} color={Colors.text} />
              {pendingRations > 0 && (
                <View style={styles.headerBadge}>
                  <Text style={styles.badgeText}>{pendingRations}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {phase !== 'results' && (
            <TouchableOpacity onPress={() => router.push(`/(app)/gm/${gameId}/runsheet`)} style={styles.headerBtn}>
              <Ionicons name="time-outline" size={22} color={Colors.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => router.push(`/(app)/gm/${gameId}/players`)} style={styles.headerBtn}>
            <Ionicons name="people-outline" size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {phase === 'setup' && (
        <SetupView
          gameId={gameId!}
          boundarySet={!!game?.boundary}
          checkpointCount={checkpoints.length}
          rulesSet={!!game?.rules?.trim()}
          durationMinutes={gameConfig(game).durationMinutes}
          onEditRules={openRulesEditor}
          onEditSettings={openConfigEditor}
          onContinue={() => runPhaseAction(() => openLobby(gameId!))}
          onDelete={handleDeleteGame}
          busy={busy}
        />
      )}

      {phase === 'lobby' && (
        <LobbyView
          players={players}
          playerCode={game?.playerCode ?? '…'}
          onCopyCode={() => handleCopyCode(game?.playerCode ?? '', 'player')}
          copied={copiedCode === 'player'}
          onStart={confirmStart}
          onBack={() => runPhaseAction(() => reopenSetup(gameId!))}
          onDelete={handleDeleteGame}
          busy={busy}
        />
      )}

      {phase === 'play' && (
        <>
          {/* Stats bar */}
          <View style={styles.statsBar}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, remaining === 0 && styles.statValueDanger]}>
                {remaining != null ? formatDuration(remaining) : '—'}
              </Text>
              <Text style={styles.statLabel}>Remaining</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{players.filter((p) => !p.out).length}</Text>
              <Text style={styles.statLabel}>Alive</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{playerLocations.length}</Text>
              <Text style={styles.statLabel}>Active</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{arrivals.length}</Text>
              <Text style={styles.statLabel}>Arrivals</Text>
            </View>
          </View>

          {/* Tab bar */}
          <View style={styles.tabBar}>
            <TouchableOpacity style={[styles.tab, tab === 'map' && styles.activeTab]} onPress={() => setTab('map')}>
              <Ionicons name="map" size={18} color={tab === 'map' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.tabText, tab === 'map' && styles.activeTabText]}>Map</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, tab === 'alerts' && styles.activeTab]} onPress={() => setTab('alerts')}>
              <Ionicons name="notifications" size={18} color={tab === 'alerts' ? Colors.primary : Colors.textSecondary} />
              <Text style={[styles.tabText, tab === 'alerts' && styles.activeTabText]}>Alerts</Text>
              {newAlertCount > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{newAlertCount}</Text></View>
              )}
            </TouchableOpacity>
          </View>

          {notReporting > 0 && (
            <TouchableOpacity
              style={styles.staleChip}
              onPress={() => router.push(`/(app)/gm/${gameId}/players`)}
            >
              <Ionicons name="warning-outline" size={16} color={Colors.danger} />
              <Text style={styles.staleChipText}>
                {notReporting} player{notReporting === 1 ? '' : 's'} not reporting — tap to check
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.content}>
            {tab === 'map' ? (
              <GameMap
                checkpoints={checkpoints}
                playerLocations={playerLocations}
                boundary={game?.boundary}
                deathMarkers={members
                  .filter((m) => m.out && m.deathLocation)
                  .map((m) => ({
                    userId: m.userId,
                    displayName: m.displayName,
                    latitude: m.deathLocation!.latitude,
                    longitude: m.deathLocation!.longitude,
                  }))}
                onCheckpointPress={handleCheckpointPress}
              />
            ) : (
              <View style={styles.alertContainer}><AlertFeed arrivals={arrivals} /></View>
            )}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity onPress={handleEndGame} style={styles.endBtn} disabled={busy}>
              <Text style={styles.endBtnText}>End Game</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {phase === 'results' && (
        <ResultsView
          totalDuration={elapsed}
          players={players}
          startedAtMs={game?.startedAt?.toMillis?.() ?? null}
          endedAtMs={game?.endedAt?.toMillis?.() ?? null}
          onDone={() => router.replace('/(app)/games')}
          onArchive={handleArchiveGame}
          busy={busy}
        />
      )}

      {/* Codes modal */}
      <Modal visible={showCodes} transparent animationType="slide" onRequestClose={() => setShowCodes(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Game Codes</Text>
            <Text style={styles.modalSub}>Share these codes for players and co-GMs to join.</Text>

            <View style={styles.codeBlock}>
              <Text style={styles.codeLabel}>PLAYER CODE</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeValue}>{game?.playerCode ?? '…'}</Text>
                <TouchableOpacity onPress={() => handleCopyCode(game?.playerCode ?? '', 'player')} style={styles.copyBtn}>
                  <Ionicons name={copiedCode === 'player' ? 'checkmark' : 'copy-outline'} size={20}
                    color={copiedCode === 'player' ? Colors.success : Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.codeDesc}>Players join — they cannot see others or checkpoints</Text>
            </View>

            <View style={[styles.codeBlock, styles.gmCodeBlock]}>
              <Text style={styles.codeLabel}>GM CODE</Text>
              <View style={styles.codeRow}>
                <Text style={styles.codeValue}>{game?.gmCode ?? '…'}</Text>
                <TouchableOpacity onPress={() => handleCopyCode(game?.gmCode ?? '', 'gm')} style={styles.copyBtn}>
                  <Ionicons name={copiedCode === 'gm' ? 'checkmark' : 'copy-outline'} size={20}
                    color={copiedCode === 'gm' ? Colors.success : Colors.textSecondary} />
                </TouchableOpacity>
              </View>
              <Text style={styles.codeDesc}>Co-GMs join — they see everything</Text>
            </View>

            <TouchableOpacity onPress={() => setShowCodes(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rules editor modal */}
      <Modal visible={showRules} transparent animationType="slide" onRequestClose={() => setShowRules(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Game Rules</Text>
            <Text style={styles.modalSub}>Players see these in their tutorial before the game starts.</Text>
            <TextInput
              style={styles.rulesInput}
              value={rulesText}
              onChangeText={setRulesText}
              placeholder="e.g. Stay inside the boundary. First to all checkpoints wins. No vehicles."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setShowRules(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
              <Button title="Save" onPress={saveRules} loading={busy} fullWidth={false} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Broadcast composer modal */}
      <Modal visible={showBroadcast} transparent animationType="slide" onRequestClose={() => setShowBroadcast(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Broadcast to players</Text>
            <Text style={styles.modalSub}>
              One-way message to every player (gear drops, updates, warnings). Players can't reply.
            </Text>
            <TextInput
              style={styles.rulesInput}
              value={broadcastText}
              onChangeText={setBroadcastText}
              placeholder="e.g. Gear drop at the old oak — marked with your name."
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
            <TouchableOpacity onPress={broadcastPlayerCount} style={styles.quickAction} disabled={busy}>
              <Ionicons name="people-outline" size={18} color={Colors.primary} />
              <Text style={styles.quickActionText}>Send living-player count instead</Text>
            </TouchableOpacity>
            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setShowBroadcast(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
              <Button title="Send" onPress={sendBroadcastMessage} loading={busy} fullWidth={false} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Game settings modal */}
      <Modal visible={showConfig} transparent animationType="slide" onRequestClose={() => setShowConfig(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Game settings</Text>
            <Text style={styles.modalSub}>Tune the rules for this game. Defaults match the base game.</Text>

            <Text style={styles.codeLabel}>GAME LENGTH (MINUTES)</Text>
            <TextInput
              style={styles.durationInput}
              value={cfgDuration}
              onChangeText={setCfgDuration}
              keyboardType="number-pad"
              placeholder="210"
              placeholderTextColor={Colors.textMuted}
            />
            <Text style={styles.settingHint}>210 = 3.5 hours</Text>

            <ConfigToggle
              label="Auto player-count updates"
              hint="Push the living-player count each interval"
              value={cfgPlayerCount}
              onValueChange={setCfgPlayerCount}
            />
            <ConfigToggle
              label="Declare a winner"
              hint="Announce the survivor when one player remains"
              value={cfgWinner}
              onValueChange={setCfgWinner}
            />
            <ConfigToggle
              label="Battery saver"
              hint="Coarser GPS cadence when players are still"
              value={cfgBattery}
              onValueChange={setCfgBattery}
            />
            <ConfigToggle
              label="Ration check"
              hint="Players photograph a ration card each window to avoid starving"
              value={cfgRations}
              onValueChange={setCfgRations}
            />
            {cfgRations && (
              <>
                <Text style={styles.codeLabel}>RATION WINDOW (MINUTES)</Text>
                <TextInput
                  style={styles.durationInput}
                  value={cfgRationInterval}
                  onChangeText={setCfgRationInterval}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={Colors.textMuted}
                />
                <Text style={styles.settingHint}>How often players must submit a ration card</Text>
                <ConfigToggle
                  label="Unique ration cards"
                  hint="Flag a card number that's been used before so you can reject it"
                  value={cfgUniqueCards}
                  onValueChange={setCfgUniqueCards}
                />
              </>
            )}

            <View style={styles.modalActions}>
              <Button title="Cancel" onPress={() => setShowConfig(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
              <Button title="Save" onPress={saveConfig} loading={busy} fullWidth={false} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ConfigToggle({
  label, hint, value, onValueChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: Colors.border, true: Colors.primary }}
        thumbColor={Colors.white}
      />
    </View>
  );
}

// --- Phase sub-views ---

function SetupView({
  gameId, boundarySet, checkpointCount, rulesSet, durationMinutes, onEditRules, onEditSettings, onContinue, onDelete, busy,
}: {
  gameId: string;
  boundarySet: boolean;
  checkpointCount: number;
  rulesSet: boolean;
  durationMinutes: number;
  onEditRules: () => void;
  onEditSettings: () => void;
  onContinue: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const router = useRouter();
  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.setupBody}>
        <Text style={styles.sectionIntro}>
          Set up your game. When you're ready, open it so players can join.
        </Text>

        <ChecklistRow
          icon="map-outline"
          title="Set up the map"
          sub={
            boundarySet || checkpointCount > 0
              ? `${boundarySet ? 'Boundary set' : 'No boundary'} · ${checkpointCount} checkpoint${checkpointCount === 1 ? '' : 's'}`
              : 'View the map, set the play boundary, add checkpoints'
          }
          done={boundarySet || checkpointCount > 0}
          onPress={() => router.push(`/(app)/gm/${gameId}/boundary`)}
        />
        <ChecklistRow
          icon="document-text-outline"
          title="Rules"
          sub={rulesSet ? 'Rules written' : 'None yet — optional'}
          done={rulesSet}
          onPress={onEditRules}
        />
        <ChecklistRow
          icon="settings-outline"
          title="Game settings"
          sub={`${(durationMinutes / 60).toFixed(1).replace(/\.0$/, '')}h game · tap to adjust`}
          done={false}
          onPress={onEditSettings}
        />
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Open to Players" onPress={onContinue} loading={busy} />
        <TouchableOpacity onPress={onDelete} style={styles.linkBtn} disabled={busy}>
          <Text style={styles.deleteLinkText}>Delete game</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ChecklistRow({
  icon, title, sub, done, onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  done: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.checkIcon}>
        <Ionicons name={icon} size={22} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkTitle}>{title}</Text>
        <Text style={styles.checkSub}>{sub}</Text>
      </View>
      <Ionicons
        name={done ? 'checkmark-circle' : 'chevron-forward'}
        size={done ? 22 : 20}
        color={done ? Colors.success : Colors.textMuted}
      />
    </TouchableOpacity>
  );
}

function LobbyView({
  players, playerCode, onCopyCode, copied, onStart, onBack, onDelete, busy,
}: {
  players: GameMember[];
  playerCode: string;
  onCopyCode: () => void;
  copied: boolean;
  onStart: () => void;
  onBack: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.flex}>
      <View style={styles.lobbyCodeCard}>
        <Text style={styles.codeLabel}>PLAYER CODE</Text>
        <TouchableOpacity style={styles.codeRow} onPress={onCopyCode} activeOpacity={0.7}>
          <Text style={styles.codeValue}>{playerCode}</Text>
          <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={22} color={copied ? Colors.success : Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.lobbyHeading}>
        {players.length} player{players.length === 1 ? '' : 's'} joined
      </Text>
      <FlatList
        data={players}
        keyExtractor={(p) => p.userId}
        contentContainerStyle={styles.lobbyList}
        renderItem={({ item }) => (
          <View style={styles.lobbyRow}>
            <Ionicons name="person-circle-outline" size={26} color={Colors.playerDot} />
            <Text style={styles.lobbyName}>{item.displayName}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.lobbyEmpty}>Waiting for players to join with the code above…</Text>
        }
      />

      <View style={styles.footer}>
        <Button title="Start Game" onPress={onStart} loading={busy} />
        <TouchableOpacity onPress={onBack} style={styles.linkBtn} disabled={busy}>
          <Text style={styles.linkBtnText}>← Back to setup</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.linkBtn} disabled={busy}>
          <Text style={styles.deleteLinkText}>Delete game</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ResultsView({
  totalDuration, players, startedAtMs, endedAtMs, onDone, onArchive, busy,
}: {
  totalDuration: number | null;
  players: GameMember[];
  startedAtMs: number | null;
  endedAtMs: number | null;
  onDone: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  function playerTime(p: GameMember): string {
    if (startedAtMs == null) return '—';
    const outMs = p.outAt?.toMillis?.() ?? null;
    const end = outMs ?? endedAtMs ?? Date.now();
    // formatDuration expects seconds; convert from the millisecond timestamps.
    return formatDuration(Math.max(0, Math.floor((end - startedAtMs) / 1000)));
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.setupBody}>
        <View style={styles.resultHero}>
          <Ionicons name="flag" size={40} color={Colors.primary} />
          <Text style={styles.resultHeroLabel}>GAME OVER</Text>
          <Text style={styles.resultHeroTime}>
            {totalDuration != null ? formatDuration(totalDuration) : '—'}
          </Text>
          <Text style={styles.resultHeroSub}>total game time</Text>
        </View>

        <Text style={styles.lobbyHeading}>Players</Text>
        {players.map((p) => (
          <View key={p.userId} style={styles.resultRow}>
            <Text style={styles.resultName}>{p.displayName}</Text>
            <View style={styles.resultRight}>
              {p.out && <Text style={styles.outTag}>OUT</Text>}
              <Text style={styles.resultTime}>{playerTime(p)}</Text>
            </View>
          </View>
        ))}
        {players.length === 0 && <Text style={styles.lobbyEmpty}>No players took part.</Text>}
      </ScrollView>
      <View style={styles.footer}>
        <Button title="Back to My Games" onPress={onDone} />
        <TouchableOpacity onPress={onArchive} style={styles.linkBtn} disabled={busy}>
          <Text style={styles.linkBtnText}>Archive game (hide from My Games)</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  headerCenter: { flex: 1 },
  gameName: { fontSize: 18, fontWeight: '800', color: Colors.text },
  phaseRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  gmBadge: { fontSize: 11, color: Colors.secondary, fontWeight: '700', letterSpacing: 1 },
  phasePill: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  phasePillText: { fontSize: 10, fontWeight: '800', color: Colors.primary, letterSpacing: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerBtn: { padding: 4 },
  headerBadge: {
    position: 'absolute', top: -2, right: -4, backgroundColor: Colors.danger,
    borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statValueDanger: { color: Colors.danger },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, borderRadius: 8, gap: 6,
  },
  activeTab: { backgroundColor: Colors.surfaceElevated },
  tabText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  activeTabText: { color: Colors.primary },
  badge: {
    backgroundColor: Colors.danger, borderRadius: 8, minWidth: 16, height: 16,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: Colors.white, fontSize: 10, fontWeight: '700' },
  staleChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginBottom: 8, paddingVertical: 8, paddingHorizontal: 12,
    borderRadius: 8, backgroundColor: Colors.danger + '1A', borderWidth: 1, borderColor: Colors.danger,
  },
  staleChipText: { color: Colors.danger, fontSize: 13, fontWeight: '600' },
  content: { flex: 1, marginHorizontal: 16, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  alertContainer: { flex: 1, backgroundColor: Colors.surface, padding: 12 },
  footer: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  endBtn: {
    alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.danger,
  },
  endBtnText: { color: Colors.danger, fontWeight: '600', fontSize: 14 },

  // Setup
  setupBody: { padding: 16, gap: 12 },
  sectionIntro: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: 4 },
  checkRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border,
  },
  checkIcon: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.surfaceElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  checkTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  checkSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },

  // Lobby
  lobbyCodeCard: {
    marginHorizontal: 16, marginTop: 4, backgroundColor: Colors.surface,
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.border,
  },
  lobbyHeading: { fontSize: 14, fontWeight: '700', color: Colors.text, marginHorizontal: 16, marginTop: 16 },
  lobbyList: { paddingHorizontal: 16, paddingTop: 8 },
  lobbyRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  lobbyName: { fontSize: 15, color: Colors.text, fontWeight: '600' },
  lobbyEmpty: { color: Colors.textSecondary, fontSize: 14, paddingHorizontal: 16, paddingTop: 12, lineHeight: 20 },
  linkBtn: { alignSelf: 'center', paddingVertical: 6 },
  linkBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  deleteLinkText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },

  // Results
  resultHero: { alignItems: 'center', gap: 4, paddingVertical: 24 },
  resultHeroLabel: { color: Colors.textSecondary, fontWeight: '800', letterSpacing: 2, fontSize: 12, marginTop: 8 },
  resultHeroTime: { color: Colors.text, fontSize: 44, fontWeight: '800' },
  resultHeroSub: { color: Colors.textSecondary, fontSize: 13 },
  resultRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  resultName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  resultRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTime: { fontSize: 15, fontWeight: '700', color: Colors.primary, fontVariant: ['tabular-nums'] },
  outTag: {
    fontSize: 10, fontWeight: '800', color: Colors.danger, letterSpacing: 1,
    borderWidth: 1, borderColor: Colors.danger, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
  },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 4 },
  modalSub: { fontSize: 14, color: Colors.textSecondary, marginBottom: 24 },
  codeBlock: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 12, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  gmCodeBlock: { borderColor: Colors.secondary + '66' },
  codeLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  codeValue: { fontSize: 32, fontWeight: '800', color: Colors.text, letterSpacing: 8 },
  copyBtn: { padding: 8 },
  codeDesc: { fontSize: 12, color: Colors.textSecondary },
  closeBtn: {
    marginTop: 8, paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.surfaceElevated, alignItems: 'center',
  },
  closeBtnText: { color: Colors.text, fontWeight: '600', fontSize: 16 },
  rulesInput: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    color: Colors.text, fontSize: 15, padding: 14, minHeight: 120, marginBottom: 16,
  },
  quickAction: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, marginBottom: 12,
  },
  quickActionText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  durationInput: {
    backgroundColor: Colors.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: Colors.border,
    color: Colors.text, fontSize: 18, fontWeight: '700', padding: 14, marginTop: 6,
  },
  settingHint: { fontSize: 12, color: Colors.textMuted, marginTop: 6, marginBottom: 8 },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: Colors.text },
  toggleHint: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 12 },
});
