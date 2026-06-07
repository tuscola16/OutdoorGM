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
13–15, 17, 18, 19, 30, 31, 32, 33, 34, 36–40) have shipped and been removed — their numbers are
retired.

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

## 50. GPS fix-quality filtering

```ts
export interface GameConfig {
  // ...existing...
  /** Reject location fixes worse than this horizontal accuracy (meters) before geofence eval. */
  minFixAccuracyMeters?: number;   // default ~30
  /** Consecutive in-radius fixes required before an arrival fires (debounce against jumps). */
  geofenceConfirmFixes?: number;   // default 2
}
```

`PlayerLocation.accuracy` already exists. Filter client-side (drop bad fixes before upload) and/or in
`onLocationUpdate` (ignore a fix whose `accuracy` exceeds the threshold; require N consecutive
in-radius fixes per player-checkpoint before creating an arrival).

## 53. Split checkpoint authoring (map = name + icon)

```ts
export interface Checkpoint {
  // ...existing: name, latitude, longitude, radius, order...
  /** Icon key chosen on the map at placement time; behavior lives in the run sheet. */
  icon?: string;
}
```

Map authoring writes only `name` + `icon` + position. All behavioral config (type, visibility,
timing) is authored in the full-screen run sheet against the existing `CheckpointEvent` /
`ScheduledEvent` / reveal model plus the #54 transition schedule. The work is mostly UI (modal →
full screen); the only new field is `icon`.

## 54. Time-based checkpoint type/state transitions

```ts
export type CheckpointState = 'closed' | 'boon' | 'hazard' | 'notification';

export interface CheckpointTransition {
  /** Game-relative minutes from startedAt (pick one convention and keep it consistent). */
  atMinute: number;
  state: CheckpointState;
}

export interface Checkpoint {
  // ...existing...
  /** State before any transition; default 'closed' for timed checkpoints, legacy = static type. */
  initialState?: CheckpointState;
  /** Ordered schedule of state changes; empty/absent = static checkpoint (legacy behavior). */
  transitions?: CheckpointTransition[];
}
```

A scheduled/triggered evaluator (reuse the existing event-queue path) advances each checkpoint's
current state at its transition times and writes a run-sheet/broadcast row. The resolved state gates
**both** rendering and geofence eval (#48): a `closed` checkpoint is neither shown to players nor able
to fire an arrival. State changes are also what unlock player re-notification in #55.

## 55. Re-trigger / re-notification model

```ts
export interface GameConfig {
  // ...existing...
  /** Minutes a player must be outside a checkpoint radius before a return re-fires it. */
  reNotifyAwayCooldownMinutes?: number;   // global; default ~5
}
```

Per-player/per-checkpoint trip tracking (extend the arrival path — e.g. a
`checkpointTrips/{playerId}_{checkpointId}` doc) records `lastTriggerAt`, whether the player is
currently inside the radius, and the **checkpoint state last notified to that player**. On a fix:
- **GM notification** fires when the player re-enters after being away ≥ `reNotifyAwayCooldownMinutes`.
- **Player notification** fires only when the checkpoint's current state (#54) differs from the state
  last notified to that player — an unchanged checkpoint stays silent for them.

## 56. Auto-end by remaining-player threshold

```ts
export interface GameConfig {
  // ...existing...
  /** When to auto-end based on living non-GM players; default 'manual'. */
  autoEndThreshold?: 'one' | 'zero' | 'manual';
}
```

Reuses GM-excluded winner detection: after each elimination, count living non-GM members; if it meets
the configured threshold (`one` → last-standing, `zero` → all out), invoke the existing `endGame()`
path. Idempotent under double-trigger (#26).

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

- **48** Early checkpoint reveal — logic fix: the resolved state from #54 (and the existing reveal gate) must hide a not-yet-open checkpoint from **both** rendering and geofence eval.
- **49** Background notification reliability — client/infra: background-location fix cadence while locked, the geofence trigger, and FCM delivery to backgrounded/locked devices.
- **51** Web polygon save — `web/` bug: the boundary commit must read the drawn polygon geometry instead of falling back to the prior rectangle (the `boundary` polygon model already exists from #39).
- **52** Ration window notification — client fix to the `scheduleNotificationAsync` eat-window path (trigger-time math, permissions, reschedule on interval rollover).
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
