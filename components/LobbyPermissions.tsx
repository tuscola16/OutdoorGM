import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, AppState, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/colors';
import {
  getPlayerPermissions,
  requestAllPlayerPermissions,
  type PermState,
  type PlayerPermissions,
} from '@/services/permissions';

type RowKind = 'location' | 'notifications' | 'camera';

interface Row {
  kind: RowKind;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  state: PermState;
  note: string;
  show: boolean;
}

/**
 * Lobby permission primer (shown on the player's waiting screen). On mount it asks
 * for everything the player needs — location "Allow all the time", notifications, and
 * (if the game uses rations) the camera — so nothing prompts mid-game. Shows a live
 * checklist with a per-item fix (re-request, or open Settings when the OS won't ask
 * again), and re-checks when the player returns from Settings.
 */
export function LobbyPermissions({ rationsEnabled }: { rationsEnabled: boolean }) {
  const [perms, setPerms] = useState<PlayerPermissions | null>(null);
  const [busy, setBusy] = useState(false);
  const requestedOnce = useRef(false);

  const refresh = useCallback(
    () => getPlayerPermissions(rationsEnabled).then(setPerms).catch(() => {}),
    [rationsEnabled]
  );

  // Ask for everything once on entry, then keep the checklist in sync.
  useEffect(() => {
    if (requestedOnce.current) return;
    requestedOnce.current = true;
    setBusy(true);
    requestAllPlayerPermissions(rationsEnabled)
      .then(setPerms)
      .catch(() => refresh())
      .finally(() => setBusy(false));
  }, [rationsEnabled, refresh]);

  // Returning from Settings (or any resume) re-reads the live statuses.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') refresh(); });
    return () => sub.remove();
  }, [refresh]);

  if (!perms) return null;

  // The location row tracks the *background* grant ("Allow all the time") — that's
  // what keeps the player on the map when locked — but notes the while-using step.
  const rows: Row[] = ([
    {
      kind: 'location',
      icon: 'location-outline',
      label: 'Location — Allow all the time',
      state: perms.locationAlways,
      note:
        perms.locationWhenInUse !== 'granted'
          ? 'Needed so your Game Master can see you, even when your screen is locked.'
          : 'Set Location to “Allow all the time” so you stay on the map when locked.',
      show: true,
    },
    {
      kind: 'notifications',
      icon: 'notifications-outline',
      label: 'Notifications',
      state: perms.notifications,
      note: 'Get GM alerts, event warnings, and your ration-window reminders.',
      show: true,
    },
    {
      kind: 'camera',
      icon: 'camera-outline',
      label: 'Camera',
      state: perms.camera,
      note: 'Photograph your numbered ration card each eat window.',
      show: rationsEnabled,
    },
  ] as Row[]).filter((r) => r.show);

  const allGranted = rows.every((r) => r.state === 'granted');

  async function fix(kind: RowKind, state: PermState) {
    // Once the OS has stopped asking, the only path is the system Settings screen.
    if (state === 'blocked') { Linking.openSettings(); return; }
    setBusy(true);
    try {
      if (kind === 'location') {
        let fg = await Location.getForegroundPermissionsAsync();
        if (fg.status !== 'granted') fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status === 'granted') {
          const bg = await Location.getBackgroundPermissionsAsync();
          if (bg.status !== 'granted') await Location.requestBackgroundPermissionsAsync().catch(() => {});
        }
        // Android grants "Allow all the time" only via Settings — send them there if
        // a direct request didn't upgrade it.
        const after = await Location.getBackgroundPermissionsAsync();
        if (after.status !== 'granted') Linking.openSettings();
      } else if (kind === 'notifications') {
        const r = await Notifications.requestPermissionsAsync();
        if (!r.granted && r.canAskAgain === false) Linking.openSettings();
      } else if (kind === 'camera') {
        const r = await ImagePicker.requestCameraPermissionsAsync();
        if (!r.granted && r.canAskAgain === false) Linking.openSettings();
      }
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  if (allGranted) {
    return (
      <View style={[styles.card, styles.cardDone]}>
        <Ionicons name="shield-checkmark" size={18} color={Colors.success} />
        <Text style={styles.doneText}>You're all set — permissions ready.</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Finish setup before kickoff</Text>
      {rows.map((r) => {
        const granted = r.state === 'granted';
        return (
          <View key={r.kind} style={styles.row}>
            <Ionicons name={r.icon} size={20} color={granted ? Colors.success : Colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{r.label}</Text>
              {!granted && <Text style={styles.rowNote}>{r.note}</Text>}
            </View>
            {granted ? (
              <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
            ) : (
              <TouchableOpacity
                style={styles.fixBtn}
                disabled={busy}
                onPress={() => fix(r.kind, r.state)}
              >
                <Text style={styles.fixText}>{r.state === 'blocked' ? 'Settings' : 'Allow'}</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', marginTop: 16,
    backgroundColor: Colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: Colors.border, gap: 12,
  },
  cardDone: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  doneText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600', flex: 1 },
  heading: { color: Colors.text, fontSize: 15, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { color: Colors.text, fontSize: 14, fontWeight: '700' },
  rowNote: { color: Colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
  fixBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: Colors.warning,
  },
  fixText: { color: Colors.black, fontSize: 13, fontWeight: '800' },
});
