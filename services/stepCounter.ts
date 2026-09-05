import { Platform } from 'react-native';
import { Pedometer } from 'expo-sensors';
import { getNativeStepCount } from '@/modules/outdoor-native';

/**
 * Step counting — a RECORDING instrument, not a gameplay input (ROADMAP #82).
 *
 * **Rewritten 2026-09-05 after the field trail proved the listener approach doesn't
 * work.** The original implementation accumulated `Pedometer.watchStepCount` callbacks.
 * That listener does not fire while the app is backgrounded, which is the entire window
 * we care about. The trail is unambiguous: a phone locked for the full 16 minutes
 * reported **2 steps**, while a phone that was periodically unlocked flushed backlogs of
 * **367, 211, 319 and 147** steps — one per wake. The hardware counter was correct all
 * along; nothing was reading it.
 *
 * So: **poll, don't listen.** Both platforms expose the accrued total on demand, and
 * both keep counting on a low-power coprocessor through Doze and app suspension:
 *  - Android — the cumulative `TYPE_STEP_COUNTER`, read through our native shim
 *    (`modules/outdoor-native`); expo-sensors offers no historical read here.
 *  - iOS — `Pedometer.getStepCountAsync(start, end)` against CMPedometer's 7-day cache,
 *    which already covers time the app was suspended.
 *
 * Everything still fails soft. `undefined` means "we don't know", which is emphatically
 * not "they took zero steps" — the distinction the stabilizer and the trail both depend
 * on. A missing sensor, a declined permission, or any error must leave the player
 * playing exactly as they do today.
 */

/** Boot-relative baseline (Android) captured when tracking started, so the reported
 *  count is steps *this session* rather than steps since the phone last rebooted. */
let androidBaseline: number | null = null;
/** Session start (iOS), the lower bound of the CMPedometer historical query. */
let sessionStart: Date | null = null;
/** Set once permission is confirmed; gates every read. */
let permitted = false;

/**
 * Prepare step counting. Best-effort and non-blocking by contract: callers must never
 * await this in a path that gates location tracking, and must never let it throw.
 *
 * Requests `ACTIVITY_RECOGNITION` on Android via expo-sensors (which owns the runtime
 * prompt) even though reads go through the native shim. Call only AFTER location
 * permission is granted — stacking an optional prompt in front of the critical one is
 * how a player ends up declining both.
 */
export async function startStepCounting(): Promise<void> {
  try {
    if (permitted) return; // already prepared

    const { granted } = await Pedometer.requestPermissionsAsync();
    if (!granted) {
      permitted = false;
      return;
    }
    permitted = true;
    sessionStart = new Date();
    androidBaseline = Platform.OS === 'android' ? await getNativeStepCount() : null;
  } catch {
    permitted = false;
  }
}

/**
 * Steps taken since tracking started, or `undefined` when unknown.
 *
 * Async by necessity — both platforms' accrued totals are a query, not a cached value.
 * Callers are background-task upload paths that already await, so this costs nothing
 * they weren't already paying.
 */
export async function getSteps(): Promise<number | undefined> {
  if (!permitted) return undefined;
  try {
    if (Platform.OS === 'android') {
      const total = await getNativeStepCount();
      if (total == null) return undefined;
      // First successful read establishes the baseline if startStepCounting()'s attempt
      // came back null (sensor not yet warm). Without this the whole session reports
      // undefined because the baseline never got set.
      if (androidBaseline == null) {
        androidBaseline = total;
        return 0;
      }
      // A counter reset (device reboot mid-game) would make this negative. Re-baseline
      // rather than report nonsense.
      if (total < androidBaseline) {
        androidBaseline = total;
        return 0;
      }
      return total - androidBaseline;
    }

    if (!sessionStart) return undefined;
    const { steps } = await Pedometer.getStepCountAsync(sessionStart, new Date());
    return typeof steps === 'number' ? steps : undefined;
  } catch {
    return undefined;
  }
}

/** Stop counting and clear the session baseline (called when tracking stops). */
export async function stopStepCounting(): Promise<void> {
  permitted = false;
  androidBaseline = null;
  sessionStart = null;
}
