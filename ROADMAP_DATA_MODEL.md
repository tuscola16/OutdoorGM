# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the **outstanding** [ROADMAP.md](ROADMAP.md) items, keyed by the
same item numbers. Everything here extends the existing types in
[types/index.ts](types/index.ts) and the `Collections` map in
[services/firebase.ts](services/firebase.ts); the built foundation (`GameConfig`, `Broadcast`,
`RationSubmission`, `CheckpointEvent`/`eventQueue`, `ScheduledEvent`, member elimination/`district`/
`sos`/`sosAckAt`/`outOfBounds`, `Game.gameDate`, the `markers`/reveal model) is already in those
files and is the baseline below.

New fields stay **optional** so legacy games keep working. Timestamps use the platform-neutral
`FsTimestamp` so types compile in both the mobile app and `web/`.

Only items with a real data-model/infra delta appear here; pure logic/UI/enforcement items are
listed under [No schema change](#no-schema-change-enforcement--logic-only). Built items (1–10,
13–15, 17, 18, 19, 30, 31, 32, 33, 34, 36–40, and the **2026-06-07 field-test batch** 48–52, 54,
53, 54, 55, 56) have shipped and been removed — their numbers are retired. (#53/#54 cover the
`Checkpoint.icon` field and the transition schema — `CheckpointState`/`CheckpointTransition`/
`initialState`/`transitions`/`currentState` — plus their GM authoring UI; see
[No schema change](#no-schema-change-enforcement--logic-only).)

---

## 11. Auto-starvation sweep *(function logic; no new schema)*

Reuses the built `RationSubmission` (`rations/{playerId}_{intervalIndex}`), the interval math
(`rationInterval(game, now)`), and `EliminationCause: 'starvation'`. Scheduled function: at each
interval boundary, every living player lacking a non-rejected submission for the **prior** interval
→ eliminate with `cause: 'starvation'` + death broadcast. Skipped when `rationsEnabled` is false or
`starvationMode === 'gm-confirmed'` (then only flags for GM review). Must be idempotent (item 26).

## 35. Low-battery beacon

```ts
export interface PlayerLocation {
  // ...existing...
  /** Device battery 0–1, reported with each fix; drives the GM low-battery flag. */
  battery?: number;
}
```

Player writes its own `battery` with each location fix (allowed by the existing self-write rule);
the GM roster flags a player below a threshold.

## 41. End-game phase

```ts
phase?: 'setup' | 'lobby' | 'play' | 'endgame' | 'results';
```

Add `'endgame'` between `'play'` and `'results'`; a `startEndgame()` helper alongside
`startGame`/`endGame` in `gameService.ts`. `gamePhase(game)` keeps defaulting legacy games. The
ration loop can auto-disable in this phase. No new collection.

## 43. Practice / dress-rehearsal game

```ts
export interface Game {
  // ...existing...
  /** Disposable on-site rehearsal: PRACTICE badge, relaxed guards, auto-cleanup. */
  practice?: boolean;
}
export interface Checkpoint {
  // ...existing...
  /** "Drop test checkpoint here" marker; badged and bulk-removed with the practice game. */
  test?: boolean;
}
```

- `practice` is GM-write-only, set at creation (`createGame`). Every screen shows a PRACTICE badge.
- The integrity invariants that block destructive actions (items 20, 22, 28) are **bypassed** when
  `practice` — the point is to tear down and re-run freely.
- A "drop test checkpoint here" action creates a `test` checkpoint at current GPS (generous radius,
  test event), firing the real `onLocationUpdate` path so events/pushes can be verified off-venue.
- A GM reset clears `arrivals`/`locations`/`rations`; practice games auto-delete (doc + Storage
  photos) on end, extending `cleanupRationPhotosOnGameEnd` to remove the whole game.
- Readiness view is derived GM-side state (no schema): joined-vs-expected, fresh-fix count
  (`services/locationStatus.ts`), per-device push confirmation.

## 45. Post-game media

```ts
export interface Game {
  // ...existing...
  media?: {
    youtubeUrl?: string;        // validate host: youtube.com / youtu.be
    photosAlbumUrl?: string;    // validate host: photos.google.com / photos.app.goo.gl
    updatedAt: FsTimestamp;
    updatedBy: string;
  };
}
```

GM-authored on the **results** screen (gated on the game being finished). A Firestore-trigger Cloud
Function fires when `media.youtubeUrl`/`photosAlbumUrl` changes, writes a broadcast, and pushes
every member token **except the setter** (reuses the broadcast/push pipeline). Results screens show
outbound `Linking.openURL` / `<a target="_blank">` links — no in-app player. Add `'media'` to the
game-doc `affectedKeys().hasOnly([...])` whitelist in `firestore.rules`.

## 46. App Check enforcement

The per-UID throttle on `joinGameByCode` already shipped (`enforceJoinRateLimit` — an internal,
admin-SDK-only `rateLimits/{uid}` doc, not client-readable, rejecting > N tries / window with
`resource-exhausted`). Remaining: flip `ENFORCE_APP_CHECK → true` in `functions/src/games.ts` after
both platforms are registered and verified. No game-doc change.

## 57. Per-GM teams *(later tier)*

```ts
export interface GameMember {
  // ...existing...
  /** GM (member userId) who owns this player's team; notifications/map filter by it. */
  teamGmId?: string;
}
```

GMs assign players to themselves; the geofence/arrival push routes only to the owning GM's tokens, and
GM map/roster views filter to `teamGmId === me`. Unassigned/legacy players fall back to all-GMs
(today's behavior). Deferred per the 2026-06-07 field test.

---

## No schema change — enforcement / logic only

These items are pure logic, rules, client architecture, or ops — no new fields or collections:

- **48** Early checkpoint reveal — **built**: `onGameStartProjectMarkers` deletes stale non-`always` marker docs at Start, the player map filters markers by an optional `RevealedMarker.visibleFrom`, and #54's `closed` state gates geofence firing. (Schema delta: `RevealedMarker.visibleFrom`.)
- **49** Background notification reliability — **built**: server-side pass-through detection in `onLocationUpdate` (segment `change.before`→`change.after` vs. each checkpoint, capped at 400 m), so a locked-phone crossing between sparse fixes still fires. No schema change. Remaining: on-device locked-phone re-test.
- **50** GPS fix-quality filtering — **built**: `GameConfig.minFixAccuracyMeters` (reject worse fixes from geofence eval) + `geofenceConfirmFixes` (N consecutive in-radius fixes debounce), enforced in `onLocationUpdate` via the `checkpointTrips` latch.
- **51** Web polygon save — **built**: `GameMap` teardown commits the current polygon (`emitPolygonFromDraw`) before removing the draw control, so Done persists it.
- **52** Ration window notification — **built**: eat-window reminders moved out of `RationPanel` into a `useRationReminders` hook mounted unconditionally during play, so they fire even when the player stays on the Map tab.
- **53** Checkpoint authoring redesign — **built**: map screen places checkpoints (name + icon + radius) only; full-screen behavior editor (`app/(app)/gm/[gameId]/checkpoint/[checkpointId].tsx`) owns event/queue, visibility/reveal, timed window, and transitions; run sheet lists checkpoints as the hub. Uses `Checkpoint.icon`, a shared `components/checkpointForm.tsx`, and `constants/checkpointIcons.ts`.
- **54** Transition authoring — **built**: the editor's "Changes over time" mode authors `initialState` + `transitions[]`; `gameService.stateEventFields` makes the initial state effective at game start while the run-sheet sweep applies later transitions.
- **55** Re-trigger / re-notification — **built**: `GameConfig.reNotifyAwayCooldownMinutes` + the server-only `checkpointTrips/{playerId}_{checkpointId}` latch (`inside`/`insideStreak`/`lastEnterAt`/`lastExitAt`/`lastNotifiedState`); GM re-notified past the cooldown, player only on state change.
- **56** Auto-end threshold — **built**: `GameConfig.autoEndThreshold` (`one`/`zero`/`manual`; legacy `winnerDetection:false` ⇒ `manual`) gating the `onMemberWrite` end/winner transaction.
- **58** Single-game test checklist — a doc plus an optional `seedTestGame` helper; no new fields.
- **12** Auto per-interval count — wire the `playerCountBroadcast` toggle to actually seed repeating run-sheet rows each interval (existing `template:'player-count'`); today the toggle is stored but does nothing automatic.
- **16** Geofence read cost — remaining work: cache phase/role per write (lobby short-circuit, zero-checkpoint skip, and checkpoint cache already shipped).
- **20** No mid-game delete — deny member `delete` when `gamePhase(game) === 'play'` (`firestore.rules` + `removePlayer`).
- **21** Reversible elimination — `revivePlayer()` clears `out`/`outAt`/`cause`, posts a correcting broadcast, and reverts `results → play` if needed.
- **22** Monotonic phases — phase-transition helpers; `reopenSetup` warns; End Game confirm-gated and single-fire.
- **23** Start-Game preflight — checks in `startGame` (boundary, ≥1 checkpoint, ≥1 player, ≥1 GM FCM token).
- **24** Config lock — freeze interval-defining fields in `updateGameConfig` once `play` begins.
- **25** Checkpoint-edit history — remaining work: warn when pending run-sheet events still point at a deleted/moved checkpoint (`arrivals` are already preserved as independent docs; the paired reveal row is already cleaned up).
- **26** Idempotent server actions — deterministic ids / `firedAt` across winner/starvation/run-sheet.
- **27** Late-join lock — `joinGameByCode` rejects any join once `gamePhase(game) !== 'lobby'` (today it only checks `status === 'active'`).
- **28** Confirm destructive broadcasts — two-step confirm + log for void-economy / End Game.
- **29** `deleteAccount` — remaining work: sole-GM transfer or server-side end (chunked ≤450-write batches already shipped). Maybe a small `transferGm`/`deleteGameForce` callable.
- **42** Arena map overlay — a GM-uploaded image overlay (asset/storage + map layer; spec when prioritized).
- **44** Voucher-site preset — a one-tap scaffold of open/close/announce run-sheet rows on a time-windowed checkpoint.
- **47** Maps-key restriction — Cloud Console ops task.
