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
 * **The thresholds are deliberately loose.** This is a teleport detector, not a smoother.
 * We have no field data yet to tune against, so it only rejects movement that is
 * physically implausible *and* worse-quality than what it already has — which makes a
 * false rejection of a genuinely fast player essentially impossible.
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

/** A player's position as it should be drawn, plus why. */
export interface StabilizedLocation extends PlayerLocation {
  /** True when we're showing an older fix because the newest one looked like a jump. */
  held: boolean;
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

  /** Drop all state (game teardown / role change). */
  reset(): void {
    this.held.clear();
  }

  stabilize(incoming: PlayerLocation[], now: number = Date.now()): StabilizedLocation[] {
    return incoming.map((next) => {
      const prev = this.held.get(next.userId);

      if (!prev) {
        this.held.set(next.userId, { loc: next, acceptedAt: now });
        return this.decorate(next, now, now, false);
      }

      const heldFor = now - prev.acceptedAt;
      const prevTs = toMillis(prev.loc.updatedAt);
      const nextTs = toMillis(next.updatedAt);

      // Same fix re-delivered (a snapshot can refire without the doc changing) — keep
      // the existing acceptance time so `ageMs` keeps growing honestly.
      if (prevTs !== null && nextTs !== null && nextTs === prevTs) {
        return this.decorate(prev.loc, prev.acceptedAt, now, false);
      }

      if (this.isImplausible(prev, next) && heldFor < MAX_HOLD_MS) {
        return this.decorate(prev.loc, prev.acceptedAt, now, true);
      }

      this.held.set(next.userId, { loc: next, acceptedAt: now });
      return this.decorate(next, now, now, false);
    });
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
  private isImplausible(prev: Held, next: PlayerLocation): boolean {
    const moved = distanceMeters(
      prev.loc.latitude, prev.loc.longitude,
      next.latitude, next.longitude
    );

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
    held: boolean
  ): StabilizedLocation {
    const ts = toMillis(loc.updatedAt) ?? acceptedAt;
    const ageMs = Math.max(now - ts, 0);
    return {
      ...loc,
      held,
      ageMs,
      confidenceM: typeof loc.accuracy === 'number' ? loc.accuracy : null,
      stale: ageMs > STALE_AFTER_MS,
    };
  }
}
