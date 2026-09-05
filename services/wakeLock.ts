import { Platform } from 'react-native';
import { acquireWakeLock, isWakeLockHeld, releaseWakeLock } from '@/modules/outdoor-native';

/**
 * Partial CPU wake lock for the duration of location tracking (ROADMAP #82).
 *
 * **Why this exists.** A foreground service keeps the *process* from being killed; it
 * does **not** keep the CPU awake — a widespread misconception, and one this codebase
 * was relying on. `expo-location` holds no wake lock of its own (verified: zero
 * `PowerManager` references in its Android source), so between location callbacks the
 * AP is free to suspend and the OS coalesces our updates.
 *
 * The 2026-09-05 field trail is the evidence: a 3s requested cadence was delivered at a
 * **14–18s median with ~90s maxima**, and a phone left locked for 16 minutes showed a
 * **38m median accuracy** against **13m** for one that was repeatedly woken by its owner
 * checking it. Same walk, same woods. The device settling into deep idle is the single
 * largest effect in the dataset, and it degrades the step sensor's delivery at the same
 * time — one root cause, two symptoms.
 *
 * **This is the one capture-layer change in this build.** Keep it that way: anything else
 * that touches the location request would confound the measurement. It's gated by
 * `GameConfig.wakeLockEnabled` so it can be A/B'd across players within a single walk,
 * which is a far cleaner comparison than two walks on different days.
 *
 * iOS is a deliberate no-op — there's no user-acquirable CPU wake lock, and the
 * `location` background mode already keeps the app scheduled.
 */

/**
 * Safety valve. The OS releases the lock after this even if we never do, so a bug here
 * can strand at most this much of a player's battery. Comfortably longer than any game
 * (`durationMinutes` defaults to 210) and re-armed on every tracking start.
 */
const WAKE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6h

/** Acquire the lock. Returns whether it's actually held afterwards (diagnostics). */
export function startWakeLock(): boolean {
  if (Platform.OS !== 'android') return false;
  acquireWakeLock(WAKE_LOCK_TIMEOUT_MS);
  return isWakeLockHeld();
}

/** Release the lock. Safe to call when nothing is held. */
export function stopWakeLock(): void {
  if (Platform.OS !== 'android') return;
  releaseWakeLock();
}

/** Is the lock currently held? Surfaced in the player-screen tracking diagnostics. */
export function wakeLockHeld(): boolean {
  if (Platform.OS !== 'android') return false;
  return isWakeLockHeld();
}
