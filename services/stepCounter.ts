import { Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Step counting — a RECORDING instrument, not a gameplay input (ROADMAP #82).
 *
 * Nothing in the app reads this to make a decision. Every step count we gather is
 * written alongside the location fix and read back after the game, to answer the one
 * question a `locationTrail` otherwise can't: when a player's dot jumped 60 m, were
 * they actually walking? Δsteps between two fixes bounds the displacement that was
 * physically possible, which is the foundation any future motion gate would need.
 *
 * Why the hardware counter and not the accelerometer: both platforms count steps on a
 * low-power coprocessor that keeps counting through Doze and app suspension for well
 * under 1% of a battery per day. Sampling the accelerometer ourselves would need the
 * CPU awake — which is exactly what we don't have when the phone is pocketed and
 * locked, i.e. the case we're trying to measure.
 *
 * **Everything here fails soft.** The pedometer is optional hardware behind an optional
 * runtime permission (`ACTIVITY_RECOGNITION` on Android 10+). A device without it, or a
 * player who declines, must play exactly as they do today — so every function swallows
 * its errors and the counter simply reports `undefined`.
 */

/** Persisted running total, so a background-task process restart doesn't reset to zero. */
const STEP_BASELINE_KEY = 'hgl_step_baseline';

/** Steps accumulated before the current subscription started (restored from storage). */
let baseline = 0;
/** Steps reported by the live subscription — Expo counts from when the listener started. */
let sinceSubscribe = 0;
/** Null until a subscription is running; cleared on stop. */
let sub: { remove: () => void } | null = null;
/** True once we've confirmed hardware + permission. Gates `getSteps()`. */
let available = false;

/**
 * Start counting. Best-effort and non-blocking by contract: callers must never await
 * this in a path that gates location tracking, and must never let it throw.
 *
 * Requests `ACTIVITY_RECOGNITION` on Android. Call this only AFTER location permission
 * has been granted — stacking an optional prompt in front of the critical one is how a
 * player ends up declining both.
 */
export async function startStepCounting(): Promise<void> {
  try {
    if (sub) return; // already running

    if (!(await Pedometer.isAvailableAsync())) {
      available = false;
      return;
    }

    // Ask, but never insist. A decline is a normal outcome, not an error.
    const { granted } = await Pedometer.requestPermissionsAsync();
    if (!granted) {
      available = false;
      return;
    }

    const stored = await AsyncStorage.getItem(STEP_BASELINE_KEY);
    baseline = stored ? Number(stored) || 0 : 0;
    sinceSubscribe = 0;

    // NOTE: on Android, Expo's Pedometer reports steps since THIS listener started
    // (it subtracts the hardware counter's value at subscribe time), not the raw
    // cumulative device count. iOS behaves the same way. So the running total is
    // always `baseline + result.steps`, and persisting the baseline is what keeps the
    // series monotonic across a process restart.
    sub = Pedometer.watchStepCount((result) => {
      sinceSubscribe = result.steps;
      // Fire-and-forget: losing a write just means a restart resumes from slightly
      // behind, which is far better than blocking the sensor callback.
      AsyncStorage.setItem(STEP_BASELINE_KEY, String(baseline + sinceSubscribe)).catch(
        () => {}
      );
    });
    available = true;
  } catch {
    // Optional instrument — a failure here must be invisible to the player.
    available = false;
  }
}

/**
 * Running total for this tracking session, or `undefined` when the pedometer isn't
 * available or the permission was declined.
 *
 * `undefined` is meaningful and must be preserved by callers: it means "we don't know",
 * which is a different reading from "they took zero steps".
 */
export function getSteps(): number | undefined {
  return available ? baseline + sinceSubscribe : undefined;
}

/** Stop counting and reset the session total (called when tracking stops). */
export async function stopStepCounting(): Promise<void> {
  try {
    sub?.remove();
  } catch {
    /* best effort */
  }
  sub = null;
  available = false;
  baseline = 0;
  sinceSubscribe = 0;
  await AsyncStorage.removeItem(STEP_BASELINE_KEY).catch(() => {});
}
