/**
 * Shared Start-Game preflight (#23). Pure — no web/RN imports — so the web `LobbyView`
 * (`@shared/common/startPreflight`) and the mobile GM screen (`@/common/startPreflight`)
 * enforce the same go/no-go before a game leaves the lobby.
 *
 * `blockers` are hard preconditions: without them geofencing or play itself are
 * impossible, so the GM cannot start until each is resolved. `warnings` are
 * confirm-past advisories (some joined players unlocated; no GM push token).
 */

export interface StartPreflightInput {
  /** A play boundary has been drawn (geofence/out-of-bounds need it). */
  hasBoundary: boolean;
  /** Number of checkpoints defined (arrivals/runbook need at least one). */
  checkpointCount: number;
  /** Number of joined players (a game with no players can't be played). */
  playerCount: number;
  /** A GM can receive alerts: at least one GM member holds a push token, OR the GM is
   * watching a live surface (the web dashboard passes `true` — it shows arrivals in real
   * time, so no FCM token is needed). Missing → a *warning*, not a blocker: a foregrounded
   * GM still sees alerts, so push only affects the closed-app case. */
  gmHasToken: boolean;
  /** Joined players who haven't reported a location fix yet (soft warning only). */
  unlocatedPlayerCount?: number;
}

export interface StartPreflightResult {
  blockers: string[];
  warnings: string[];
}

/** Resolve the three hard Start preconditions (boundary, checkpoints, players) +
 * the soft warnings (unlocated players; no GM push token). */
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

  const unlocated = input.unlocatedPlayerCount ?? 0;
  if (unlocated > 0) {
    warnings.push(
      `${unlocated} ${unlocated === 1 ? 'player has' : 'players have'} joined but aren’t on the map yet — they may still be granting location permission.`
    );
  }
  if (!input.gmHasToken) {
    warnings.push('No Game Master is registered for push notifications — GMs will only see alerts while actively watching the app or dashboard.');
  }

  return { blockers, warnings };
}
