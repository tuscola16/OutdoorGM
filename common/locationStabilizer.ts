import type { PlayerLocation } from '../types';
import { distanceMeters } from './geo';

/**
 * Display-side jump suppression for the GM map (ROADMAP #82).
 *
 * The problem: with the phone pocketed and locked, Android's fused provider falls back
 * to Wi-Fi/cell trilateration and emits fixes tens of metres from the truth — measured
 * at ~52 m while walking, and once 64 m off while *claiming* 22 m accuracy. Every one of
 * those fixes moves the GM's dot, because the client writes each fix unconditionally and
 * `minFixAccuracyMeters` only gates checkpoint evaluation, not the write. Players
 * therefore appear to teleport around the map while standing still.
 *
 * **Why this lives in the read path and not in the upload path.** Filtering at the write
 * would have been the obvious place, and it is the wrong one:
 *
 *  - `onLocationUpdate` compares `change.before` → `change.after` for #49 pass-through
 *    detection. Suppressing writes changes which crossings fire, i.e. it silently alters
 *    **checkpoint behaviour** — the core mechanic — as a side effect of a display fix.
 *  - A suppressed fix never reaches `locationTrail`, so filtering at the write blinds the
 *    very diagnostic we're relying on to tune this properly later.
 *  - A too-aggressive gate in the background task freezes players on the map, which is
 *    worse than jitter and near-impossible to debug mid-game.
 *
 * Here, the worst case is cosmetic and self-correcting. Firestore still holds every raw
 * fix; only the pixels are held back.
 *
 * **Two independent gates, both fail-open** (revised 2026-09-05 against real field data):
 *
 *  - The **accuracy** gate refuses to draw a fix whose own reported accuracy is worse
 *    than `maxAccuracyM`. This is the one that does the work. The walk showed 11 of 13
 *    large jumps arriving with accuracy *improving* — the dot leaps because GPS
 *    reacquires and snaps back to truth, so the jump is the **correction**, and the fix
 *    worth suppressing is the bad one before it.
 *  - The **speed** gate still catches a teleport that also degrades in quality. It fired
 *    on only 2 of those 13 jumps, so it is a backstop, not the primary mechanism.
 *
 * A step-based motion gate was written and then removed before it ever shipped: replayed
 * against the trail it would have suppressed 556 m and 980 m of two players' genuine
 * movement, because Android batches step delivery (≈70% of fixes read `stepsSincePrev: 0`
 * mid-walk) and delivers nothing at all to a locked phone.
 *
 * **Everything still errs toward accepting.** An unknown accuracy, a missing timestamp, or
 * a disabled threshold all mean "don't judge", never "hold", and `MAX_HOLD_MS` bounds the
 * damage if a gate is wrong anyway.
 */

/** Above this implied speed (m/s) a fix is a candidate jump. ~25 km/h — far above a
 *  sprint, so real movement is never suppressed. */
const MAX_PLAUSIBLE_SPEED_MS = 7;

/** Never hold a stale position longer than this. The critical safety valve: if the
 *  heuristic is wrong, the map lags by at most a minute rather than being stuck
 *  indefinitely. A late position beats a frozen one. */
const MAX_HOLD_MS = 60_000;

/** Past this age, the displayed fix is old enough that the GM should be told. */
export const STALE_AFTER_MS = 45_000;

/**
 * Default accuracy ceiling (m) for drawing a fix — `GameConfig.maxDisplayAccuracyMeters`
 * overrides it, 0 disables the gate.
 *
 * 80 m is chosen from the 2026-09-05 trail rather than invented: median accuracy was
 * 12.9 m for a phone kept awake and 38.4 m for one left locked, with p90s of 89 m and
 * 116 m. A ceiling of 80 m therefore keeps essentially every ordinary fix — including the
 * mediocre-but-usable ones from a pocketed phone under canopy — while dropping the
 * 89–203 m outliers that produced the visible teleporting.
 *
 * Note this is a *display* threshold and is deliberately looser than it might be: holding
 * position is only better than drawing a bad fix for so long, and `MAX_HOLD_MS` caps it.
 */
const DEFAULT_MAX_DISPLAY_ACCURACY_M = 80;

/** Why a fix was held, for field-tuning the heuristics. `null` when nothing was held. */
export type HoldReason = 'accuracy' | 'speed';

/** A player's position as it should be drawn, plus why. */
export interface StabilizedLocation extends PlayerLocation {
  /** True when we're showing an older fix because the newest one looked like a jump. */
  held: boolean;
  /**
   * Which gate held it (#82). Recorded so the constants above can be re-derived from a
   * real `locationTrail` capture instead of remaining guesses — a hold we can see the
   * reason for is one we can argue about with data.
   */
  heldReason: HoldReason | null;
  /** Age (ms) of the fix actually being displayed. */
  ageMs: number;
  /** Radius (m) to draw as the uncertainty circle — the fix's own reported accuracy. */
  confidenceM: number | null;
  /** `ageMs > STALE_AFTER_MS` — dim/annotate the marker. */
  stale: boolean;
}

interface Held {
  loc: PlayerLocation;
  /** Client-clock ms when we accepted this fix (Firestore timestamps can be null in
   *  flight, so we can't rely on `updatedAt` alone for hold accounting). */
  acceptedAt: number;
}

const toMillis = (t: unknown): number | null => {
  const v = t as { toMillis?: () => number } | null | undefined;
  return typeof v?.toMillis === 'function' ? v.toMillis() : null;
};

/**
 * Stateful per-player stabilizer. Hold one instance per mounted GM map (a ref in the
 * context provider) and feed it every snapshot; it returns what to draw.
 */
export class LocationStabilizer {
  private held = new Map<string, Held>();
  private maxAccuracyM: number;

  /**
   * @param maxAccuracyM Accuracy ceiling for drawing a fix, from
   *   `GameConfig.maxDisplayAccuracyMeters`. 0 disables the gate; omit for the default.
   */
  constructor(maxAccuracyM: number = DEFAULT_MAX_DISPLAY_ACCURACY_M) {
    this.maxAccuracyM = maxAccuracyM;
  }

  /** Re-read the threshold when the game's config changes mid-session. */
  setMaxAccuracy(maxAccuracyM: number): void {
    this.maxAccuracyM = maxAccuracyM;
  }

  /** Drop all state (game teardown / role change). */
  reset(): void {
    this.held.clear();
  }

  stabilize(incoming: PlayerLocation[], now: number = Date.now()): StabilizedLocation[] {
    return incoming.map((next) => {
      const prev = this.held.get(next.userId);

      if (!prev) {
        this.held.set(next.userId, { loc: next, acceptedAt: now });
        return this.decorate(next, now, now, null);
      }

      const heldFor = now - prev.acceptedAt;
      const prevTs = toMillis(prev.loc.updatedAt);
      const nextTs = toMillis(next.updatedAt);

      // Same fix re-delivered (a snapshot can refire without the doc changing) — keep
      // the existing acceptance time so `ageMs` keeps growing honestly.
      if (prevTs !== null && nextTs !== null && nextTs === prevTs) {
        return this.decorate(prev.loc, prev.acceptedAt, now, null);
      }

      const reason = this.holdReason(prev, next);
      if (reason !== null && heldFor < MAX_HOLD_MS) {
        return this.decorate(prev.loc, prev.acceptedAt, now, reason);
      }

      this.held.set(next.userId, { loc: next, acceptedAt: now });
      return this.decorate(next, now, now, null);
    });
  }

  /**
   * Should this fix be held, and by which gate? `null` to accept it.
   *
   * The two gates are independent and deliberately so. The speed gate asks "did the dot
   * move faster than a human can?", which needs both fixes' timestamps and only fires
   * when the incoming fix is *also* lower quality. The step gate asks the blunter
   * physical question — "did their legs move at all?" — and needs neither, which is what
   * lets it catch the case the speed gate provably misses: the field-observed Pixel 8
   * sitting 64 m off while *claiming* 22 m accuracy. Accuracy never degraded there, so
   * the speed gate's quality clause vetoed the hold. A pedometer reading zero doesn't
   * care what the fix claims about itself.
   */
  private holdReason(prev: Held, next: PlayerLocation): HoldReason | null {
    const moved = distanceMeters(
      prev.loc.latitude, prev.loc.longitude,
      next.latitude, next.longitude
    );
    if (this.tooInaccurate(next)) return 'accuracy';
    if (this.exceedsPlausibleSpeed(prev, next, moved)) return 'speed';
    return null;
  }

  /**
   * Accuracy gate (#82): is this fix simply too poor to draw?
   *
   * **This replaced the step-based motion gate on 2026-09-05, because the field data
   * killed it.** Replaying the motion gate against the real trail would have held 556 m
   * of one player's genuine movement and 980 m of the other's — 69% of everything they
   * did. The cause: Android delivers step counts in batches, so `stepsSincePrev` reads 0
   * on roughly 70% of fixes *while the player is actively walking*, and on a phone that
   * stays locked the listener never fires at all (one tester's counter sat at 2 for
   * sixteen minutes). "Sensor reporting a stale zero" is indistinguishable from "stood
   * still", so the gate's fail-open guard couldn't save it.
   *
   * This gate is the opposite move, and it's the one the data supports. Of 13 large
   * jumps on that walk, **11 had accuracy improving, not worsening** — the dot leaps
   * because GPS reacquires and snaps back to truth. The jump *is* the correction. So
   * suppressing the incoming fix is exactly backwards; what you want is to never have
   * drawn the bad fix that preceded it. Reject on absolute accuracy and the 89–203 m
   * fixes never move the dot in the first place.
   *
   * Unknown accuracy means unknown, so it is never held — a device that doesn't report
   * accuracy behaves exactly as it does today.
   */
  private tooInaccurate(next: PlayerLocation): boolean {
    if (this.maxAccuracyM <= 0) return false; // gate disabled
    return typeof next.accuracy === 'number' && next.accuracy > this.maxAccuracyM;
  }

  /**
   * Is this fix a teleport? Requires BOTH an implausible implied speed AND a fix that is
   * no better than the one we're already showing.
   *
   * The second clause is what makes this safe: a genuinely fast-moving player reporting a
   * good fix is always accepted, however fast they're going. We only ever hold when the
   * incoming fix is both implausible and lower quality — i.e. when the jump is much better
   * explained by GPS error than by movement.
   */
  private exceedsPlausibleSpeed(prev: Held, next: PlayerLocation, moved: number): boolean {
    // Both server timestamps are required. Falling back to wall-clock time since WE
    // accepted the previous fix measures the wrong interval: if the map mounted 2s ago but
    // these two fixes were recorded 60s apart on the device, the implied speed comes out
    // ~30x too high and a perfectly good fix gets suppressed for a minute. When we can't
    // measure the real interval we simply don't judge — an unfiltered fix is a far cheaper
    // mistake than a frozen player.
    const prevTs = toMillis(prev.loc.updatedAt);
    const nextTs = toMillis(next.updatedAt);
    if (prevTs === null || nextTs === null || nextTs <= prevTs) return false;

    const impliedSpeed = moved / ((nextTs - prevTs) / 1000);
    if (impliedSpeed <= MAX_PLAUSIBLE_SPEED_MS) return false;

    // Quality comparison. An unknown accuracy is treated as no-worse, so a device that
    // never reports accuracy behaves exactly as it does today (nothing is ever held).
    const prevAcc = prev.loc.accuracy;
    const nextAcc = next.accuracy;
    if (typeof prevAcc !== 'number' || typeof nextAcc !== 'number') return false;

    return nextAcc > prevAcc;
  }

  private decorate(
    loc: PlayerLocation,
    acceptedAt: number,
    now: number,
    heldReason: HoldReason | null
  ): StabilizedLocation {
    const ts = toMillis(loc.updatedAt) ?? acceptedAt;
    const ageMs = Math.max(now - ts, 0);
    return {
      ...loc,
      held: heldReason !== null,
      heldReason,
      ageMs,
      confidenceM: typeof loc.accuracy === 'number' ? loc.accuracy : null,
      stale: ageMs > STALE_AFTER_MS,
    };
  }
}
