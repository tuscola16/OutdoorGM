/**
 * Shared numeric-config validation (G2 / ROADMAP #63). Pure — no web/RN imports — so the
 * web `ConfigModal` (`@shared/common/gameConfigValidation`) and the mobile config screen
 * (`@/common/gameConfigValidation`) enforce the same rules. Returns inline messages keyed
 * by field; callers block the save and surface the reason rather than silently clamping.
 */

/** The numeric config fields the GM edits, already parsed from their inputs. */
export interface GameConfigDraft {
  durationMinutes: number;
  rationsEnabled: boolean;
  rationIntervalMinutes: number;
  rationWindowMinutes: number;
  tripIntervalMinutes: number;
}

/** Error message if `value` isn't a whole number > 0, else null. */
export function requirePositiveInt(value: number, label: string): string | null {
  if (!Number.isFinite(value)) return `${label} is required.`;
  if (value <= 0) return `${label} must be greater than 0.`;
  if (!Number.isInteger(value)) return `${label} must be a whole number.`;
  return null;
}

/** Error message if `value` isn't a whole number ≥ `min`, else null. */
export function requireMinInt(value: number, min: number, label: string): string | null {
  if (!Number.isFinite(value)) return `${label} is required.`;
  if (value < min) return `${label} must be at least ${min}.`;
  if (!Number.isInteger(value)) return `${label} must be a whole number.`;
  return null;
}

/**
 * Validate the game-settings numeric fields + their cross-field ordering
 * (`rationWindow ≤ rationInterval ≤ gameLength`). Empty result = valid.
 */
export function validateGameConfig(d: GameConfigDraft): Record<string, string> {
  const errors: Record<string, string> = {};

  const duration = requirePositiveInt(d.durationMinutes, 'Game length');
  if (duration) errors.durationMinutes = duration;

  const trip = requirePositiveInt(d.tripIntervalMinutes, 'Checkpoint re-trigger interval');
  if (trip) errors.tripIntervalMinutes = trip;

  if (d.rationsEnabled) {
    const interval = requirePositiveInt(d.rationIntervalMinutes, 'Ration interval');
    if (interval) errors.rationIntervalMinutes = interval;

    const window = requirePositiveInt(d.rationWindowMinutes, 'Open window');
    if (window) errors.rationWindowMinutes = window;

    // Cross-field ordering — only when both endpoints are themselves valid, so we don't
    // pile a confusing ordering error on top of an "out of range" one.
    if (!interval && !window && d.rationWindowMinutes > d.rationIntervalMinutes) {
      errors.rationWindowMinutes = 'Open window can’t be longer than the ration interval.';
    }
    if (!interval && !duration && d.rationIntervalMinutes > d.durationMinutes) {
      errors.rationIntervalMinutes = 'Ration interval can’t be longer than the game length.';
    }
  }

  return errors;
}
