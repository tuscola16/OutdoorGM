import { requireOptionalNativeModule } from 'expo';

/**
 * JS surface for the #82 native shims (see the Kotlin module for why each exists).
 *
 * `requireOptionalNativeModule`, not `requireNativeModule`: an older dev client or a
 * JS-only reload that predates this module must not throw on import. Every function
 * below degrades to "unknown / no-op" when the native side is absent, which is the same
 * contract the managed paths already have.
 */
/** A satellite-only fix from Android's GPS_PROVIDER (#82). */
export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** Device clock ms for the fix itself. */
  timestamp: number;
  /** Always 'gps' here — recorded so a trail row states its own provenance. */
  provider: string;
  /** Satellites used, when the OEM reports it. Low counts mean canopy starvation. */
  satellites: number | null;
}

interface OutdoorNativeModule {
  /** Cumulative steps since boot, or null when unavailable. Android only. */
  getStepCount(): Promise<number | null>;
  /** One satellite-only fix, bypassing the fused provider. Null on timeout/GPS off. */
  getGpsFix(timeoutMs: number): Promise<GpsFix | null>;
  /** Hold a partial CPU wake lock, auto-released by the OS after `timeoutMs`. */
  acquireWakeLock(timeoutMs: number): boolean;
  releaseWakeLock(): boolean;
  isWakeLockHeld(): boolean;
}

const native = requireOptionalNativeModule<OutdoorNativeModule>('OutdoorNative');

/** Is the native shim actually linked in this build? */
export const hasNativeShims = native != null;

export async function getNativeStepCount(): Promise<number | null> {
  try {
    return (await native?.getStepCount()) ?? null;
  } catch {
    return null;
  }
}

/**
 * One satellite-only fix, or null when GPS is off, times out, or the shim is absent.
 * Null is always safe: every caller falls back to the fused fix it already holds.
 */
export async function getNativeGpsFix(timeoutMs: number): Promise<GpsFix | null> {
  try {
    return (await native?.getGpsFix(timeoutMs)) ?? null;
  } catch {
    return null;
  }
}

export function acquireWakeLock(timeoutMs: number): boolean {
  try {
    return native?.acquireWakeLock(timeoutMs) ?? false;
  } catch {
    return false;
  }
}

export function releaseWakeLock(): void {
  try {
    native?.releaseWakeLock();
  } catch {
    /* best effort */
  }
}

export function isWakeLockHeld(): boolean {
  try {
    return native?.isWakeLockHeld() ?? false;
  } catch {
    return false;
  }
}
