# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the **outstanding** [ROADMAP.md](ROADMAP.md) items, keyed by the
same item numbers. Everything here extends the existing types in
[types/index.ts](types/index.ts) and the `Collections` map in
[services/firebase.ts](services/firebase.ts); the built foundation (`GameConfig`, `Broadcast`,
`RationSubmission`, `CheckpointEvent`/`eventQueue`, `ScheduledEvent`, member elimination/`district`/
`sos`/`sosAckAt`/`outOfBounds`, `Game.gameDate`, the `markers`/reveal model) is already in those
files and is the baseline below.

New fields stay **optional** so legacy games keep working — the **one exception is the now-shipped
[§60](#60-checkpoint--runbook-overhaul)** overhaul, which removed fields (and chose a fresh start over
running its migration). Timestamps use the platform-neutral `FsTimestamp` so types compile in both the
mobile app and `web/`.

Only items with a real data-model/infra delta appear here; pure logic/UI/enforcement items are
listed under [No schema change](#no-schema-change-enforcement--logic-only). Built items (1–10,
13–15, 17, 18, 19, 30, 31, 32, 33, 34, 36–40, and the **2026-06-07 field-test batch** 48–52, 54,
53, 54, 55, 56) have shipped and been removed — their numbers are retired. (#53/#54 cover the
`Checkpoint.icon` field and the transition schema — `CheckpointState`/`CheckpointTransition`/
`initialState`/`transitions`/`currentState` — plus their GM authoring UI; see
[No schema change](#no-schema-change-enforcement--logic-only).)

---

## 60. Checkpoint & runbook overhaul — **BUILT**

> Shipped. The canonical schema now lives in [types/index.ts](types/index.ts)
> (`Checkpoint`, `RunbookEntry`, `RunbookEffect`, `TimedBound`, `CheckpointVisibility`,
> `RevealTrigger`, `CheckpointKind`) and the `RUNBOOK` collection in both `services/firebase.ts`
> files. The detail below is retained as the design record. A one-time converter
> (`functions/scripts/migrateRunbook.js`) exists but was **not run** (fresh-start milestone).

**Full replacement** of the per-checkpoint behavior model. A checkpoint shrinks to identity +
visibility; all behavior moves to a `runbook` collection of priority-ranked entries. This is the
one place in this file that **removed** existing fields rather than adding optional ones.

### 60.A `Checkpoint` — slimmed to identity + visibility

```ts
export type CheckpointVisibility = 'hidden' | 'shown' | 'shown-on-trigger';
export type RevealTrigger = 'player' | 'gm' | 'timed'; // only when shown-on-trigger
export type RevealAudience = 'all' | 'specific-players' | 'triggerer';

export interface CheckpointReveal {
  trigger: RevealTrigger;
  audience: RevealAudience;
  atMinute?: number | null;          // 'timed' trigger: minutes after startedAt
  revealAt?: FsTimestamp | null;     // 'timed' trigger: absolute (reserved)
  recipientPlayerIds?: string[];     // 'specific-players' audience
}

export interface Checkpoint {
  id: string;
  name: string;
  icon?: string;
  latitude: number;
  longitude: number;
  radius: number;                    // meters — intrinsic geofence geometry, stays
  order?: number;
  visibility: CheckpointVisibility;  // default 'hidden' (legacy gm-only)
  reveal?: CheckpointReveal;         // when visibility === 'shown-on-trigger'
  revealedAt?: FsTimestamp | null;   // reveal latch (unchanged)
  revealedTo?: string[];             // targeted-reveal latch (unchanged)
}
```

**Removed from `Checkpoint`:** `event`, `eventQueue`, `opensAt`, `closesAt`, `initialState`,
`transitions`, `currentState`, `description`. **Renamed in place:** `gm-only → hidden`,
`always → shown`, `on-reveal → shown-on-trigger`; reveal trigger `on-crossing → player`,
`gm-manual → gm`, `game-time → timed`. Visibility (the marker) stays **orthogonal** to the runbook
(the effect): a `shown` checkpoint can still carry a secret hazard; a `hidden` one can still fire boons.

### 60.B `RunbookEntry` — the behavior unit

New collection `games/{gameId}/runbook/{entryId}` — **top-level** (not a checkpoint subcollection) so
the GM dashboard groups/sorts all entries with one listener; **GM-only** read/write in
`firestore.rules` (same posture as `checkpoints`; it holds the secret payloads). The geofence reads it
via the admin SDK.

```ts
export type RunbookTriggerType = 'fixed-order' | 'always-on' | 'timed' | 'gm-prompted';
export type CheckpointKind = 'hazard' | 'boon' | 'gm-notify' | 'notify';

/** What a player receives. A fixed-order slot can carry its own kind+message. */
export interface RunbookEffect {
  kind: CheckpointKind;
  message?: string;
}

export type TimedBound =
  | { kind: 'game-start' } | { kind: 'game-end' }
  | { kind: 'time'; atMinute?: number; fireAt?: FsTimestamp }; // minutes after startedAt (primary)

export interface RunbookEntry {
  id: string;
  checkpointId: string;
  name: string;
  priority: number;                  // higher wins per crossing; also drives sidebar sort
  trigger: RunbookTriggerType;
  effect: RunbookEffect;             // entry's type+message; also the fixed-order default

  // trigger: 'fixed-order' (keyed by ARRIVAL ORDER, not player identity)
  queueSlots?: (RunbookEffect | null)[]; // position N → its own effect, or null = "nothing fires";
                                          // positions past the array fall back to `effect`
  defaultNone?: boolean;                  // true → the default position (past the slots, and revisits)
                                          // fires nothing instead of `effect`; entry-level mirror of a
                                          // null slot. `effect` is still stored (drives pin color).

  // trigger: 'timed'
  startAt?: TimedBound;              // default { kind: 'game-start' }
  endAt?: TimedBound;               // default { kind: 'game-end' }

  // trigger: 'gm-prompted' — no schedule; GM taps to fire and picks target player(s).
  firedAt?: FsTimestamp | null;     // latch for idempotency / results view (open sub-point)

  createdAt: FsTimestamp;
}
```

**Triggers:**
- **fixed-order** — the Nth distinct arriver (0-based, counted via the `checkpointTrips` latch) gets
  `queueSlots[N]`, falling back to the default (`effect`, or **nothing** when `defaultNone` is set);
  a `null` slot fires nothing for that arriver. Replaces `eventQueue`.
- **always-on** — fires `effect` for every crossing. Replaces the single `event`.
- **timed** — eligible only while `now ∈ [startAt, endAt]`. Replaces `opensAt`/`closesAt` **and** the
  `transitions`/`currentState` schedule.
- **gm-prompted** — fired manually during play; the GM picks the target player(s), writing a targeted
  broadcast.

### 60.C Resolution

On each crossing (`onLocationUpdate`, `functions/src/geofence.ts`): gather every entry for that
checkpoint that currently matches (always-on always; timed if in window; fixed-order if this arriver's
slot is non-null; gm-prompted only when fired), then deliver **exactly one — the highest `priority`**.
Tie-break: earliest eligibility, then `createdAt`. The GM-only arrival ping fires independently
(the GM always sees arrivals). Reuses the `checkpointTrips` latch for arrival-order counting and the
existing re-notify / away-cooldown logic. Must be idempotent (item 26).

### 60.D Web editor

Full page (`web/`): a left sidebar of runbook **entries** in two groups — **Always-on** (priority
desc) and **Timed** (priority desc, then start time asc; earlier higher) — each row labeled with its
checkpoint; an entry with both kinds of triggers can't exist (one trigger per entry), but a checkpoint
with mixed entries appears in both groups. The right pane edits the selected entry (name, checkpoint,
type, priority, trigger-specific fields: queue-slot table / timed start–end / gm-prompted target
rules). Checkpoint placement (name + icon + visibility + radius) stays on the map screen.

### 60.E Migration *(full replacement)*

- New `runbook` collection + slimmed `Checkpoint`; old behavior fields dropped from `types/index.ts`
  and the authoring UIs (`components/checkpointForm.tsx`,
  `app/(app)/gm/[gameId]/checkpoint/[checkpointId].tsx`, web equivalents).
- One-time migration over existing games: `event → always-on entry`, `eventQueue → fixed-order entry`
  (each item → a `queueSlots` slot), `opensAt/closesAt`+`transitions → timed entries`, visibility/reveal
  renamed in place. Per the trusted-APK milestone, migrate-in-place or reset stale games rather than
  carry dual code paths.
- The run sheet (`ScheduledEvent`: timed broadcasts, GM reminders, player-count) stays a **separate**
  schedule tool — only checkpoint *effects* move to the runbook. Its `open-site`/`close-site`/
  `reveal-checkpoint` action types are superseded by timed entries + the reveal model and can be retired.
  **Update (web run-sheet UI removed):** the web GM dashboard's run-sheet pane has now been deleted —
  the remaining clock-triggered, crossing-independent actions (timed announcement, player-count,
  gear-drop, GM reminder) are tracked by **[§61](#61)** to fold into the Runbook; the
  `runScheduledEvents` sweep + `scheduledEvents` collection + mobile run-sheet still drive them meanwhile.
- `firestore.rules`: add `runbook` (GM-only); the geofence/sweep functions read it via admin SDK.

**Open sub-points (don't block):** per-slot effect overrides are in (above); whether `gm-prompted`
latches recipients for a results view; priority is a single number serving both per-checkpoint
resolution and global sidebar sort.

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

## 65. Clone a game *(setup only)* — **BUILT (2026-06-07)**

A `cloneGame(sourceGameId, displayName)` callable (server-side, mirroring `createGame` so the GM
role + codes are never client-assigned). It reads the source and writes a **new** game doc plus
sub-collections, **copying setup only**:

| Copied (setup) | Reset / not copied (runtime + participants) |
| --- | --- |
| `boundary`, `rules`, `config` (all knobs), `gameDate?` | `members` (cloner becomes sole GM), `locations`, `arrivals`, `rations`, `checkpointTrips`, `entryTrips` (#67), `broadcasts` |
| `checkpoints/*` (new ids) — `name`/`icon`/geometry/`visibility`/`reveal` **minus** `revealedAt`/`revealedTo` | `winner`, `phase` → `setup`, `startedAt`/`endedAt`, `status` → `active` |
| `runbook/*` (re-keyed to the new checkpoint ids) **minus** `firedAt` | fresh `playerCode`/`gmCode` (CSPRNG, like `createGame`) |

Implementation notes: build an **old→new checkpointId map** first, then rewrite each runbook entry's
`checkpointId` (and any checkpoint-id references) through it. Do it in a batch/transaction. No new
*fields* — this is a write-fan-out function + a "Clone" button (web `GamesScreen`/`GameScreen`,
mobile games list). **Open decision:** rules/config travel with the clone by default (the ask is to
re-run the same setup); flip to opt-out checkboxes if testers want a bare clone.

## 67. Per-runbook-event tripping + periodic re-trip — **BUILT (2026-06-07)**

Today's latch is per **player × checkpoint** (`checkpointTrips/{playerId}_{checkpointId}`) and one
effect is delivered per crossing. Move dedup to per **player × runbook entry** and re-evaluate on a
cadence so newly-live entries fire without a re-entry.

```ts
export interface GameConfig {
  // ...existing...
  /** #67: while a player stays inside a checkpoint, eligible runbook entries are re-evaluated
   *  every this-many minutes (so a timed/queued entry that goes live later still trips). Default 2. */
  tripIntervalMinutes?: number; // > 0; default 2
}
```

New server-only latch collection (admin-SDK only in `firestore.rules`, like `checkpointTrips`):

```
games/{gameId}/entryTrips/{playerId}_{entryId}
  playerId, entryId, checkpointId,
  trippedAt: FsTimestamp           // set once — a player trips a given entry at most once
```

`onLocationUpdate` change: keep `checkpointTrips` for presence/streak/pass-through, but resolve
**every** eligible entry for the checkpoint (not just the top priority), and for each, fire only if
`entryTrips/{playerId}_{entryId}` doesn't exist (then create it). Gate re-evaluation while still
inside on `now − lastTripCheckAt ≥ tripIntervalMinutes` (store `lastTripCheckAt` on the
`checkpointTrips` latch). Effect ordering/priority still decides what a *single* tick delivers if
multiple new entries become eligible at once (or deliver each — decide during build; default: one
per tick, highest priority, so a burst doesn't spam). Idempotent (item 26).

## 68. Server-enforced unique ration card numbers

No new field — enforce the existing `enforceUniqueRationCards` at write time. Route `submitRation`
through a callable (or a Firestore rule + transaction) that rejects a `cardNumber` already used by a
non-rejected `rations/*` doc in the same game, returning a typed error
(`failed-precondition: 'card-in-use'`) the client shows inline. The deterministic
`rations/{playerId}_{intervalIndex}` id stays (idempotent re-submit of the *same* card by the same
player is fine; a *different* player reusing a number is blocked). GM "reused" flag stays as backstop.

## 69. Broadcast push (onBroadcastCreate) — **BUILT (2026-06-07)**

No new field. Add a Firestore-trigger Cloud Function on `games/{gameId}/broadcasts/{id}` that pushes
FCM on the `broadcasts` channel:
- skip docs with `audience: 'gm-only'` (co-GM messages) and any with a `firedAt`/server-origin marker
  to avoid double-push (the geofence/run-sheet/members paths already push *and* write a doc — gate
  the trigger to client-written `kind: 'gm-message'` broadcasts, or add a `pushed: true` marker on
  the server-written ones so the trigger ignores them);
- `targetPlayerId` set → push that one player's token; else → all living (non-`out`) player tokens;
- send a **notification** message (title/body), not data-only, so it shows on a backgrounded/closed
  phone. Reuses `sendPushToTokens`.

## 70 & 71. Player notification ack / dismiss model — **#70 BUILT (2026-06-07)** (local); #71 deferred

Players need (70) the in-app event modal to survive a dismissed OS push, and (71) a way to clear
notifications in their list. Shared per-player ack state:

```ts
export interface Broadcast {
  // ...existing (kind, message, targetPlayerId, audience?, createdAt)...
  /** #70/#71: per-player handling. userIds who have seen/dismissed this broadcast in-app. */
  dismissedBy?: string[];   // arrayUnion(uid) on dismiss; filter the player's list by it
}
```

- **70** — the player screen derives "modal to show" from broadcasts/events where `createdAt` is
  after session start (or unacked) **and** `uid ∉ dismissedBy`, independent of whether the OS push
  was tapped/dismissed. Opening the app re-surfaces anything pending.
- **71** — a dismiss control writes `dismissedBy: arrayUnion(uid)` (allowed by a narrow
  `firestore.rules` clause: a player may update *only* `dismissedBy` to add their own uid). Per-player,
  so one player's dismiss doesn't affect others. (Alt: a player-doc `dismissedBroadcastIds` set if we
  don't want players writing broadcast docs — pick during build; the rules-narrow `arrayUnion` is
  simpler.)

> **Built (2026-06-07) — #70 only, local approach:** shipped with a **device-local** dismissed set
> (`AsyncStorage` key `acked_broadcasts_{gameId}`) in `components/AlertOverlay.tsx`, not the server
> `Broadcast.dismissedBy` field — no rules change, no extra writes, and it solves the single-device
> closed-phone case: unacked broadcasts re-pop on reopen; dismissals (tap or auto) persist; the first
> open on a device seeds the backlog as handled so history isn't replayed. **#71** (an in-list dismiss
> control) and the cross-device server `dismissedBy` field remain deferred (P2).

## 72. Reliable ration-window-open notification

No new game-doc field necessarily. Two-pronged: (a) harden the on-device schedule
(`useRationReminders`) — reschedule on config/`startedAt` change, schedule the *exact* next
`windowStartsAt`, and don't rely on a single long timer; (b) add a **server** push as source of
truth: a scheduled function (sibling to `runScheduledEvents`) that, each minute, finds games whose
ration window just opened and pushes living players once (dedupe via a per-interval
`rationWindowPings/{gameId}_{intervalIndex}` latch, idempotent — item 26). Prefer the server push as
authoritative; keep the local notification as a fast-path fallback.

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
- **62** `/demo` parity audit — content/UI only; walk `web/src/screens/DemoScreen.tsx` against the live app (#60 runbook, terminal rations) and refresh the mocks. No schema.
- **66** Ration-review-before-window-open — **built (2026-06-07)**: the "Not eaten this window" list (web `RationsModal`, mobile `rations.tsx`) now gates on `rationInterval().isOpen`, so it's empty until the eat-window actually opens; the web header shows "window not open yet".
- **63** Numeric validation — logic/UI only; add `> 0` + ordering checks (window ≤ interval ≤ game length; radius ≥ 10) in the web `ConfigModal`/editors and mobile equivalents, plus a shared validator. No new fields (the numbers already exist in `GameConfig`/`Checkpoint`).
- **64** Boundary-constrained checkpoints — logic only; reuse the geofence `pointInBoundary` (polygon ≥3 verts else bbox) client-side on placement/edit in web + mobile. No schema.
