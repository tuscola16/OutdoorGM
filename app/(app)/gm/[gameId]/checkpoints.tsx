import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, FlatList, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Circle, Polygon, UrlTile, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import * as Location from 'expo-location';
import firestore from '@react-native-firebase/firestore';
import { useGame } from '@/context/GameContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Colors } from '@/constants/colors';
import { TOPO_TILE_URL, TOPO_TILE_SIZE, TOPO_MAX_ZOOM, TOPO_MAX_NATIVE_ZOOM } from '@/constants/map';
import {
  addCheckpoint, updateCheckpoint, deleteCheckpoint,
  openCheckpointNow, closeCheckpointNow, clearCheckpointWindow, checkpointWindowState,
  revealCheckpointNow, setRevealSchedule,
} from '@/services/gameService';
import { friendlyError } from '@/services/errorUtils';
import { useNow } from '@/hooks/useNow';
import type {
  MapBoundary, Checkpoint, CheckpointEvent, CheckpointKind, EventAudience,
  CheckpointVisibility, RevealTrigger, RevealAudience, CheckpointReveal,
} from '@/types';

const DEFAULT_RADIUS = 100;
const DEFAULT_REGION: Region = { latitude: 37.0902, longitude: -95.7129, latitudeDelta: 0.05, longitudeDelta: 0.05 };
const USER_DELTA = 0.02;

// Per-kind presentation: chip label/icon, map pin color, and a message placeholder.
const KIND_META: Record<
  CheckpointKind,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string; placeholder: string }
> = {
  hazard: { label: 'Hazard', icon: 'warning', color: Colors.danger, placeholder: 'e.g. A beast attacks! Defend or flee.' },
  boon: { label: 'Boon', icon: 'sparkles', color: Colors.success, placeholder: 'e.g. You found a hidden cache. Claim it.' },
  'player-notify': { label: 'Notify', icon: 'megaphone', color: Colors.playerDot, placeholder: 'e.g. The storm is closing in — head for high ground.' },
  'gm-only': { label: 'GM only', icon: 'eye-off', color: Colors.textSecondary, placeholder: '' },
};
const KIND_ORDER: CheckpointKind[] = ['hazard', 'boon', 'player-notify', 'gm-only'];

// Visibility (#48): who can see the marker, independent of what the checkpoint does.
const VIS_META: Record<CheckpointVisibility, { label: string; icon: keyof typeof Ionicons.glyphMap; hint: string }> = {
  'gm-only': { label: 'Hidden', icon: 'eye-off', hint: 'Only you see it. Players never see this checkpoint on their map.' },
  always: { label: 'Always shown', icon: 'eye', hint: 'Players see this location from the start — but not what it does until they cross it.' },
  'on-reveal': { label: 'Reveal later', icon: 'time', hint: 'Hidden until a reveal trigger fires (a trap, a timed/triggered drop, or a sponsor drop).' },
};
const VIS_ORDER: CheckpointVisibility[] = ['gm-only', 'always', 'on-reveal'];

function checkpointKind(cp: Checkpoint): CheckpointKind {
  return cp.event?.kind ?? cp.eventQueue?.[0]?.kind ?? 'gm-only';
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}

function buildEvent(kind: CheckpointKind, message: string, audience: EventAudience): CheckpointEvent {
  const e: CheckpointEvent = { kind };
  if (kind !== 'gm-only' && message.trim()) e.message = message.trim();
  if (kind === 'player-notify' && audience === 'all-players') e.audience = 'all-players';
  return e;
}

function ordinalLabel(i: number): string {
  const n = i + 1;
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix} arriver`;
}

function corners(b: MapBoundary) {
  return [
    { latitude: b.maxLat, longitude: b.minLng },
    { latitude: b.maxLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.maxLng },
    { latitude: b.minLat, longitude: b.minLng },
  ];
}

function KindChips({ value, onChange }: { value: CheckpointKind; onChange: (k: CheckpointKind) => void }) {
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

function AudienceToggle({ value, onChange }: { value: EventAudience; onChange: (a: EventAudience) => void }) {
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

export default function CheckpointsScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const { game, checkpoints, members, loadGame } = useGame();
  const router = useRouter();
  const now = useNow(10000);
  const boundary: MapBoundary | undefined = game?.boundary;
  const players = members.filter((m) => m.role === 'player');

  const [displayRegion, setDisplayRegion] = useState<Region | null>(null);
  const [renderKey, setRenderKey] = useState(0);
  const gotInitialFix = useRef(false);
  const mapMountedRef = useRef(false);
  const regionRef = useRef<Region | null>(DEFAULT_REGION);
  const mapRef = useRef<MapView>(null);

  const showRegion = useCallback((region: Region) => {
    regionRef.current = region;
    if (mapMountedRef.current) setRenderKey((k) => k + 1);
    mapMountedRef.current = true;
    setDisplayRegion(region);
  }, []);

  const regionFromCoords = (c: { latitude: number; longitude: number }): Region => ({
    latitude: c.latitude, longitude: c.longitude, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA,
  });

  const [mode, setMode] = useState<'map' | 'list'>('map');
  const [locating, setLocating] = useState(false);

  // Checkpoint add/edit modal state
  const [showCpModal, setShowCpModal] = useState(false);
  const [editTarget, setEditTarget] = useState<Checkpoint | null>(null);
  const [pendingCoord, setPendingCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpRadius, setCpRadius] = useState(String(DEFAULT_RADIUS));
  const [savingCp, setSavingCp] = useState(false);
  const [cpMode, setCpMode] = useState<'single' | 'queue'>('single');
  const [cpKind, setCpKind] = useState<CheckpointKind>('gm-only');
  const [cpMessage, setCpMessage] = useState('');
  const [cpAudience, setCpAudience] = useState<EventAudience>('crossing-player');
  const [cpQueue, setCpQueue] = useState<CheckpointEvent[]>([]);
  // Visibility / reveal (#48)
  const [cpVisibility, setCpVisibility] = useState<CheckpointVisibility>('gm-only');
  const [cpRevealTrigger, setCpRevealTrigger] = useState<RevealTrigger>('on-crossing');
  const [cpRevealAudience, setCpRevealAudience] = useState<RevealAudience>('all');
  const [cpRevealOffset, setCpRevealOffset] = useState('');
  const [cpRecipients, setCpRecipients] = useState<string[]>([]);

  useEffect(() => {
    if (gameId) loadGame(gameId, 'gm');
  }, [gameId]);

  const centerOnUser = useCallback(async (showPromptOnDenied = false) => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        if (showPromptOnDenied) {
          Alert.alert('Location off', 'Enable location access for Outdoor GM in Settings to center the map on you.');
        }
        return;
      }
      const pos = (await Location.getLastKnownPositionAsync())
        ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!pos) return;
      showRegion(regionFromCoords(pos.coords));
    } catch {
      /* location unavailable */
    } finally {
      setLocating(false);
    }
  }, [showRegion]);

  // Frame on the boundary if set, else the GM's location.
  useEffect(() => {
    if (gotInitialFix.current) return;
    if (boundary) {
      gotInitialFix.current = true;
      showRegion({
        latitude: (boundary.minLat + boundary.maxLat) / 2,
        longitude: (boundary.minLng + boundary.maxLng) / 2,
        latitudeDelta: Math.max(0.01, boundary.maxLat - boundary.minLat),
        longitudeDelta: Math.max(0.01, boundary.maxLng - boundary.minLng),
      });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== 'granted') { if (!gotInitialFix.current) showRegion(DEFAULT_REGION); return; }
        const last = await Location.getLastKnownPositionAsync();
        if (cancelled) return;
        if (last && !gotInitialFix.current) { gotInitialFix.current = true; showRegion(regionFromCoords(last.coords)); }
      } catch {
        if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION);
      }
    })();
    const fallback = setTimeout(() => { if (!cancelled && !gotInitialFix.current) showRegion(DEFAULT_REGION); }, 9000);
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [boundary, showRegion]);

  function resetEventFields() {
    setCpMode('single');
    setCpKind('gm-only');
    setCpMessage('');
    setCpAudience('crossing-player');
    setCpQueue([]);
    setCpVisibility('gm-only');
    setCpRevealTrigger('on-crossing');
    setCpRevealAudience('all');
    setCpRevealOffset('');
    setCpRecipients([]);
  }

  function openAddCheckpoint(coord: { latitude: number; longitude: number }) {
    setPendingCoord(coord);
    setEditTarget(null);
    setCpName(`Checkpoint ${checkpoints.length + 1}`);
    setCpRadius(String(DEFAULT_RADIUS));
    resetEventFields();
    setShowCpModal(true);
  }

  function openEditCheckpoint(cp: Checkpoint) {
    setEditTarget(cp);
    setPendingCoord({ latitude: cp.latitude, longitude: cp.longitude });
    setCpName(cp.name);
    setCpRadius(String(cp.radius));
    if (cp.eventQueue && cp.eventQueue.length > 0) {
      setCpMode('queue');
      setCpQueue(cp.eventQueue);
      setCpKind('gm-only');
      setCpMessage('');
      setCpAudience('crossing-player');
    } else {
      setCpMode('single');
      const e = cp.event;
      setCpKind(e?.kind ?? 'gm-only');
      setCpMessage(e?.message ?? '');
      setCpAudience(e?.audience ?? 'crossing-player');
      setCpQueue([]);
    }
    setCpVisibility(cp.visibility ?? 'gm-only');
    setCpRevealTrigger(cp.reveal?.trigger ?? 'on-crossing');
    setCpRevealAudience(cp.reveal?.audience ?? 'all');
    setCpRevealOffset(cp.reveal?.offsetMinutes != null ? String(cp.reveal.offsetMinutes) : '');
    setCpRecipients(cp.reveal?.recipientPlayerIds ?? []);
    setShowCpModal(true);
  }

  function updateQueueItem(index: number, patch: Partial<CheckpointEvent>) {
    setCpQueue((q) => q.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }
  function addQueueItem() { setCpQueue((q) => [...q, { kind: 'hazard' }]); }
  function removeQueueItem(index: number) { setCpQueue((q) => q.filter((_, i) => i !== index)); }
  function toggleRecipient(id: string) {
    setCpRecipients((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));
  }

  /** Assemble the reveal config from the modal state, or undefined for gm-only/always. */
  function buildReveal(): CheckpointReveal | undefined {
    if (cpVisibility !== 'on-reveal') return undefined;
    // On-crossing always targets the crossing player (case A trap).
    const audience: RevealAudience = cpRevealTrigger === 'on-crossing' ? 'triggerer' : cpRevealAudience;
    const reveal: CheckpointReveal = { trigger: cpRevealTrigger, audience };
    if (cpRevealTrigger === 'game-time') {
      reveal.offsetMinutes = Math.max(0, Math.round(Number(cpRevealOffset) || 0));
    }
    if (audience === 'specific-players') reveal.recipientPlayerIds = cpRecipients;
    return reveal;
  }

  async function handleSaveCheckpoint() {
    if (!cpName.trim()) { Alert.alert('Enter a checkpoint name'); return; }
    const radius = parseInt(cpRadius, 10);
    if (isNaN(radius) || radius < 10) { Alert.alert('Enter a valid radius (minimum 10m)'); return; }
    if (!pendingCoord || !gameId) return;

    const reveal = buildReveal();
    if (cpVisibility === 'on-reveal' && reveal?.audience === 'specific-players' && cpRecipients.length === 0) {
      Alert.alert('Pick at least one player', 'A sponsor drop needs at least one recipient, or choose “All players”.');
      return;
    }

    let event: CheckpointEvent | undefined;
    let eventQueue: CheckpointEvent[] | undefined;
    if (cpMode === 'queue') {
      const cleaned = cpQueue.map((e) => buildEvent(e.kind, e.message ?? '', e.audience ?? 'crossing-player'));
      if (cleaned.length === 0) { Alert.alert('Add at least one step, or switch to “Same for everyone”.'); return; }
      eventQueue = cleaned;
    } else {
      event = buildEvent(cpKind, cpMessage, cpAudience);
    }

    // Reveal-at-game-time: the offset in minutes after Start, or null when not game-time.
    const revealOffset = cpVisibility === 'on-reveal' && cpRevealTrigger === 'game-time'
      ? Math.max(0, Math.round(Number(cpRevealOffset) || 0))
      : null;

    setSavingCp(true);
    try {
      let checkpointId = editTarget?.id;
      if (editTarget) {
        await updateCheckpoint(gameId, editTarget.id, {
          name: cpName.trim(),
          radius,
          event: (eventQueue ? firestore.FieldValue.delete() : event) as never,
          eventQueue: (eventQueue ?? firestore.FieldValue.delete()) as never,
          visibility: cpVisibility,
          reveal: (reveal ?? firestore.FieldValue.delete()) as never,
        });
      } else {
        const created = await addCheckpoint(gameId, {
          name: cpName.trim(),
          latitude: pendingCoord.latitude,
          longitude: pendingCoord.longitude,
          radius,
          visibility: cpVisibility,
          ...(reveal ? { reveal } : {}),
          ...(eventQueue ? { eventQueue } : { event }),
        });
        checkpointId = created.id;
      }
      // Keep the paired game-time reveal run-sheet row in sync (#48).
      if (checkpointId) await setRevealSchedule(gameId, checkpointId, revealOffset);
      setShowCpModal(false);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    } finally {
      setSavingCp(false);
    }
  }

  async function handleWindowAction(action: 'open' | 'close' | 'clear') {
    if (!gameId || !editTarget) return;
    try {
      if (action === 'open') await openCheckpointNow(gameId, editTarget.id);
      else if (action === 'close') await closeCheckpointNow(gameId, editTarget.id);
      else await clearCheckpointWindow(gameId, editTarget.id);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  async function handleRevealNow() {
    if (!gameId || !editTarget) return;
    try {
      await revealCheckpointNow(gameId, editTarget);
      Alert.alert('Revealed', `${editTarget.name} is now visible to players.`);
    } catch (err) {
      Alert.alert('Error', friendlyError(err));
    }
  }

  function confirmDeleteCheckpoint(cp: Checkpoint) {
    if (!gameId) return;
    Alert.alert(`Delete "${cp.name}"?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await deleteCheckpoint(gameId, cp.id); setShowCpModal(false); }
          catch (err) { Alert.alert('Error', friendlyError(err)); }
        },
      },
    ]);
  }

  const editCp = editTarget ? checkpoints.find((c) => c.id === editTarget.id) ?? editTarget : null;
  const windowState = editCp ? checkpointWindowState(editCp, now) : 'always';
  const windowStatusText = {
    always: 'Always live — fires whenever a player crosses.',
    open: 'Open — firing now.',
    pending: 'Scheduled — not open yet.',
    closed: 'Closed — not firing.',
  }[windowState];
  const isRevealed = !!editCp?.revealedAt;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Checkpoints</Text>
        <View style={styles.headerRight}>
          <View style={styles.cpCount}>
            <Ionicons name="location" size={14} color={Colors.primary} />
            <Text style={styles.cpCountText}>{checkpoints.length}</Text>
          </View>
          <View style={styles.modeToggle}>
            <TouchableOpacity style={[styles.modeBtn, mode === 'map' && styles.activeModeBtn]} onPress={() => setMode('map')}>
              <Ionicons name="map" size={18} color={mode === 'map' ? Colors.primary : Colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.modeBtn, mode === 'list' && styles.activeModeBtn]} onPress={() => setMode('list')}>
              <Ionicons name="list" size={18} color={mode === 'list' ? Colors.primary : Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {mode === 'list' ? (
        <>
          <FlatList
            data={checkpoints}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              checkpoints.length > 0
                ? <Text style={styles.listHeading}>{checkpoints.length} checkpoint{checkpoints.length === 1 ? '' : 's'}</Text>
                : null
            }
            renderItem={({ item }) => {
              const kind = checkpointKind(item);
              const meta = KIND_META[kind];
              const steps = item.eventQueue?.length ?? 0;
              const vis = item.visibility ?? 'gm-only';
              return (
                <View style={styles.checkpointRow}>
                  <Ionicons name={meta.icon} size={20} color={meta.color} style={{ marginRight: 10 }} />
                  <View style={styles.cpInfo}>
                    <View style={styles.cpNameRow}>
                      <Text style={styles.cpName}>{item.name}</Text>
                      {vis !== 'gm-only' && (
                        <View style={styles.visBadge}>
                          <Ionicons name={VIS_META[vis].icon} size={10} color={Colors.secondary} />
                          <Text style={styles.visBadgeText}>{VIS_META[vis].label}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.cpSub}>{meta.label}{steps > 1 ? ` · ${steps} steps` : ''} · {item.radius}m radius</Text>
                  </View>
                  <TouchableOpacity onPress={() => openEditCheckpoint(item)} style={styles.iconBtn}>
                    <Ionicons name="pencil-outline" size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => confirmDeleteCheckpoint(item)} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={40} color={Colors.textMuted} />
                <Text style={styles.emptyText}>No checkpoints yet.{'\n'}Switch to the map and long-press to add one.</Text>
              </View>
            }
          />
          <View style={styles.footer}>
            <Button title="Add Checkpoints on Map" onPress={() => setMode('map')} variant="ghost" />
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.mapWrapper}>
            {!displayRegion ? (
              <View style={[StyleSheet.absoluteFill, styles.mapLoading]}>
                <ActivityIndicator color={Colors.primary} />
                <Text style={styles.mapLoadingText}>Finding your location…</Text>
              </View>
            ) : (
              <MapView
                key={String(renderKey)}
                ref={mapRef}
                style={StyleSheet.absoluteFill}
                provider={PROVIDER_GOOGLE}
                mapType="none"
                initialRegion={displayRegion}
                showsUserLocation
                showsMyLocationButton={false}
                onRegionChangeComplete={(r) => { regionRef.current = r; }}
                onLongPress={(e) => openAddCheckpoint(e.nativeEvent.coordinate)}
              >
                <UrlTile urlTemplate={TOPO_TILE_URL} tileSize={TOPO_TILE_SIZE} maximumZ={TOPO_MAX_ZOOM} maximumNativeZ={TOPO_MAX_NATIVE_ZOOM} zIndex={-1} />
                {boundary && (
                  <Polygon coordinates={corners(boundary)} strokeColor={Colors.secondary} strokeWidth={2} fillColor="rgba(212, 137, 63, 0.08)" />
                )}
                {checkpoints.map((cp) => {
                  const color = KIND_META[checkpointKind(cp)].color;
                  return (
                    <Circle
                      key={`c-${cp.id}`}
                      center={{ latitude: cp.latitude, longitude: cp.longitude }}
                      radius={cp.radius}
                      fillColor={hexToRgba(color, 0.15)}
                      strokeColor={color}
                      strokeWidth={2}
                    />
                  );
                })}
                {checkpoints.map((cp) => (
                  <Marker
                    key={`m-${cp.id}`}
                    coordinate={{ latitude: cp.latitude, longitude: cp.longitude }}
                    title={cp.name}
                    description={`${KIND_META[checkpointKind(cp)].label} · ${cp.radius}m — tap to edit`}
                    pinColor={KIND_META[checkpointKind(cp)].color}
                    onPress={() => openEditCheckpoint(cp)}
                  />
                ))}
              </MapView>
            )}

            <TouchableOpacity style={styles.locateBtn} onPress={() => centerOnUser(true)} disabled={locating}>
              <Ionicons name={locating ? 'ellipsis-horizontal' : 'locate'} size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={styles.hint}>
              {boundary ? 'Long-press anywhere on the map to drop a checkpoint.' : 'No boundary set yet — set it from the previous screen. Long-press to drop a checkpoint.'}
            </Text>
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </>
      )}

      {/* Add / edit checkpoint modal */}
      <Modal visible={showCpModal} transparent animationType="slide" onRequestClose={() => setShowCpModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{editTarget ? 'Edit Checkpoint' : 'New Checkpoint'}</Text>
              {pendingCoord && (
                <Text style={styles.coords}>📍 {pendingCoord.latitude.toFixed(5)}, {pendingCoord.longitude.toFixed(5)}</Text>
              )}
              <Input label="Name" value={cpName} onChangeText={setCpName} placeholder="e.g. Cornucopia" />
              <Input label="Detection Radius (meters)" value={cpRadius} onChangeText={setCpRadius} keyboardType="number-pad" placeholder="100" />

              {/* What the checkpoint does when a player crosses it */}
              <Text style={styles.sectionLabel}>What happens here?</Text>
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

              {/* Player visibility (#48) — orthogonal to the event payload above */}
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

                  {editTarget && cpRevealTrigger === 'gm-manual' && (
                    <TouchableOpacity onPress={handleRevealNow} style={[styles.chip, { alignSelf: 'flex-start', borderColor: Colors.secondary }]}>
                      <Ionicons name={isRevealed ? 'eye' : 'eye-outline'} size={14} color={Colors.secondary} />
                      <Text style={[styles.chipText, { color: Colors.secondary }]}>{isRevealed ? 'Revealed — reveal again' : 'Reveal now'}</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Timed site window (#12) — existing checkpoint only */}
              {editTarget && (
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

              <View style={styles.modalActions}>
                <Button title="Cancel" onPress={() => setShowCpModal(false)} variant="ghost" fullWidth={false} style={{ flex: 1 }} />
                <Button title={editTarget ? 'Save' : 'Add'} onPress={handleSaveCheckpoint} loading={savingCp} fullWidth={false} style={{ flex: 1 }} />
              </View>
              {editTarget && (
                <TouchableOpacity onPress={() => confirmDeleteCheckpoint(editTarget)} style={styles.deleteRow}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                  <Text style={styles.deleteText}>Delete checkpoint</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text, marginLeft: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpCount: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpCountText: { color: Colors.text, fontWeight: '700', fontSize: 13 },
  modeToggle: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  modeBtn: { padding: 8, paddingHorizontal: 12 },
  activeModeBtn: { backgroundColor: Colors.surfaceElevated },
  list: { paddingHorizontal: 16, paddingVertical: 8, flexGrow: 1 },
  listHeading: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  checkpointRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  cpInfo: { flex: 1 },
  cpNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cpName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  cpSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  visBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: Colors.secondary, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1,
  },
  visBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, color: Colors.secondary },
  iconBtn: { padding: 6, marginLeft: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 22 },
  mapWrapper: { flex: 1, position: 'relative' },
  mapLoading: { alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.surface },
  mapLoadingText: { color: Colors.textSecondary, fontSize: 14 },
  locateBtn: {
    position: 'absolute', right: 16, bottom: 16, width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  footer: { padding: 16, gap: 10 },
  hint: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%' },
  modalContent: { padding: 24, paddingBottom: 40, gap: 12 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.text },
  coords: { fontSize: 12, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 4 },
  deleteText: { color: Colors.danger, fontSize: 14, fontWeight: '600' },

  sectionLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
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
});
