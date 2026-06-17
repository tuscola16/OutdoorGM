/**
 * Shared Start-Game preflight (#23). Pure — no web/RN imports — so the web `LobbyView`
 * (`@shared/common/startPreflight`) and the mobile GM screen (`@/common/startPreflight`)
 * enforce the same go/no-go before a game leaves the lobby.
 *
 * `blockers` are hard preconditions: without them geofencing, alerts, or play itself
 * are impossible, so the GM cannot start until each is resolved. `warnings` are
 * confirm-past advisories (e.g. some joined players haven't reported a location yet).
 */

export interface StartPreflightInput {
  /** A play boundary has been drawn (geofence/out-of-bounds need it). */
  hasBoundary: boolean;
  /** Number of checkpoints defined (arrivals/runbook need at least one). */
  checkpointCount: number;
  /** Number of joined players (a game with no players can't be played). */
  playerCount: number;
  /** At least one GM member holds a non-empty FCM token (alerts can be delivered). */
  gmHasToken: boolean;
  /** Joined players who haven't reported a location fix yet (soft warning only). */
  unlocatedPlayerCount?: number;
}

export interface StartPreflightResult {
  blockers: string[];
  warnings: string[];
}

/** Resolve the four hard Start preconditions + the soft unlocated-players warning. */
export function startGamePreflight(input: StartPreflightInput): StartPreflightResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!input.hasBoundary) {
    blockers.push('Draw the play boundary before starting — it defines the out-of-bounds edge.');
  }
  if (input.checkpointCount <= 0) {
    blockers.push('Add at least one checkpoint before starting — there are no objectives to reach.');
  }
  if (input.playerCount <= 0) {
    blockers.push('No players have joined yet — share the player code and wait for at least one.');
  }
  if (!input.gmHasToken) {
    blockers.push('No Game Master can receive alerts — open the app on a GM device to register for notifications, then try again.');
  }

  const unlocated = input.unlocatedPlayerCount ?? 0;
  if (unlocated > 0) {
    warnings.push(
      `${unlocated} ${unlocated === 1 ? 'player has' : 'players have'} joined but aren’t on the map yet — they may still be granting location permission.`
    );
  }

  return { blockers, warnings };
}
