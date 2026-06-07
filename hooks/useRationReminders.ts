import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import type { GameConfig } from '@/types';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

type Ts = FirebaseFirestoreTypes.Timestamp | null;

/**
 * Schedule eat-window open notifications for all future ration intervals. Must be
 * mounted unconditionally during play — not inside a tab-gated component — so the
 * player is alerted even when the Stats tab (which hosts RationPanel) is not active.
 * Deterministic ids (`ration-<game>-<i>`) keep it idempotent across re-mounts;
 * cleanup cancels pending alerts on unmount / phase change / elimination.
 */
export function useRationReminders({
  gameId,
  startedAt,
  config,
  active,
}: {
  gameId: string | undefined;
  startedAt: Ts;
  config: GameConfig;
  active: boolean;
}) {
  const startedMs = startedAt?.toMillis?.() ?? null;
  useEffect(() => {
    if (!active || !gameId || !startedMs || !config.rationsEnabled) return;
    let cancelled = false;
    const scheduled: string[] = [];
    (async () => {
      let perm = await Notifications.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) return;
      const windowMs = config.rationIntervalMinutes * 60_000;
      const total = Math.ceil(config.durationMinutes / config.rationIntervalMinutes);
      const openMs =
        Math.min(Math.max(config.rationWindowMinutes, 0), config.rationIntervalMinutes) * 60_000;
      const nowMs = Date.now();
      for (let i = 0; i < total; i++) {
        const opensAt = startedMs + (i + 1) * windowMs - openMs;
        if (opensAt <= nowMs + 1000) continue; // already open or past
        try {
          const id = await Notifications.scheduleNotificationAsync({
            identifier: `ration-${gameId}-${i}`,
            content: {
              title: '🍖 Ration window open',
              body: 'Photograph your ration card before the window closes — or you starve.',
              sound: true,
            },
            trigger: { date: new Date(opensAt), channelId: 'broadcasts' },
          });
          if (cancelled) {
            Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
            return;
          }
          scheduled.push(id);
        } catch {
          // permissions may have changed since the check above — ignore silently
        }
      }
    })();
    return () => {
      cancelled = true;
      scheduled.forEach((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => {}));
    };
  }, [
    active,
    gameId,
    startedMs,
    config.rationsEnabled,
    config.rationIntervalMinutes,
    config.rationWindowMinutes,
    config.durationMinutes,
  ]);
}
