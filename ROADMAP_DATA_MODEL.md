# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the [ROADMAP.md](ROADMAP.md) items. Everything here
extends the existing types in [types/index.ts](types/index.ts) and the `Collections`
map in [services/firebase.ts](services/firebase.ts). New fields are **optional** so
legacy games keep working (same convention as the `phase` field today).

All timestamps use the existing platform-neutral `FsTimestamp` interface so the types
compile in both the mobile app and `web/`.

---

## 1. `game.config` — per-GM configurability

Today `game.rules` is free text. Add a structured `config` object to the `Game` doc.
The "base game rules" become the seed defaults when a GM creates a game; the GM config
screen (P3) edits them.

```ts
/** GM-tunable game parameters. All optional; resolver applies BASE_GAME_CONFIG defaults. */
export interface GameConfig {
  /** Total game length in minutes. Rule 5 → 210 (3.5h). */
  durationMinutes: number;

  // --- Ration / starvation loop (Rules 6–9) ---
  rationsEnabled: boolean;
  /** Length of each ration interval in minutes — the eat-or-starve cadence. Rule 6/7 → 30. */
  rationIntervalMinutes: number;
  /** How long the eat-window is *open* at the end of each interval, in minutes (#21).
   *  Capture is hidden until then; the player is alerted on open. Clamped to ≤ the interval. */
  rationWindowMinutes: number;
  /** What happens when a player misses a window. */
  starvationMode: 'auto' | 'gm-confirmed';
  /** Reject a ration photo whose card number was already used (Rule 6). */
  enforceUniqueRationCards: boolean;

  // --- Broadcast (Rules 24) ---
  /** Auto-push the living-player count every interval. Rule 24. */
  playerCountBroadcast: boolean;

  // --- Elimination (Rules 1, 16) ---
  /** Surface a winner when one living player remains. Rule 1. */
  winnerDetection: boolean;

  // --- Tracking (Rule 21) ---
  /** Coarser GPS cadence when the player is stationary. */
  batterySaver: boolean;
}

/** Seed defaults = the base game rules. */
export const BASE_GAME_CONFIG: GameConfig = {
  durationMinutes: 210,
  rationsEnabled: true,
  rationIntervalMinutes: 30,
  rationWindowMinutes: 10,
  starvationMode: 'gm-confirmed',
  enforceUniqueRationCards: true,
  playerCountBroadcast: true,
  winnerDetection: true,
  batterySaver: true,
};
```

Add to `Game`:

```ts
export interface Game {
  // ...existing fields...
  /** GM-tunable parameters; absent on legacy games (use BASE_GAME_CONFIG). */
  config?: Partial<GameConfig>;
}
```

Resolver (mirrors the existing `gamePhase(game)` pattern in `gameService.ts`):

```ts
export const gameConfig = (game: Game): GameConfig => ({
  ...BASE_GAME_CONFIG,
  ...(game.config ?? {}),
});
```

**Interval math** (used by ration UI, the scheduled starvation function, and the clock):
given `startedAt` and `rationIntervalMinutes = M`, the current interval index is
`floor((now - startedAt) / (M * 60_000))`; total intervals = `durationMinutes / M`. The
**eat-window** for interval `i` is the last `rationWindowMinutes` (≤ M) before that interval's
boundary: open over `[boundary − window, boundary)`. `rationInterval(game, now)` returns
`windowStartsAt` / `windowEndsAt` / `isOpen` so the panel hides until open and players are
alerted (a scheduled local notification) the moment it opens (#21).

---

## 2. Checkpoint-triggered events, traps & site windows (ROADMAP #5, #12)

Checkpoints become **event triggers**, not just alert beacons. A checkpoint can hold a
single event *or* an **ordered queue** of events consumed by arrival order (the trap
pattern: the Nth tribute to arrive gets the Nth entry). It can also be **time-gated** to an
active window. Extend `Checkpoint`:

```ts
export type CheckpointEventType =
  | 'arrival-alert'   // current behavior: notify GM only
  | 'beast-attack'    // push a hazard prompt to the crossing player
  | 'trap'            // assigned-by-arrival-order hazard (ROADMAP #5)
  | 'gear-drop'       // sponsor/gear drop reveal (Rules 31, 32)
  | 'announcement'    // GM-authored message
  | 'silent-alert';   // GM sees it; player gets nothing

export type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';

export interface CheckpointEvent {
  type: CheckpointEventType;
  /** Body shown in the push/broadcast, e.g. "A beast attacks! Defend or flee." */
  message?: string;
  /** Trap/voucher display name, e.g. "Tracker Jackers". */
  name?: string;
  audience: EventAudience;
  /** Fire only the first time anyone (or this player) enters. Default true. */
  once?: boolean;
  /** Gear-drop only: name the drop is marked for (Rule 32). */
  recipientPlayerId?: string;
}

export interface Checkpoint {
  // ...existing fields...
  /** Single event fired on every qualifying crossing. Absent → 'arrival-alert'. */
  event?: CheckpointEvent;
  /**
   * Ordered queue consumed by arrival ordinal: the Nth distinct tribute to arrive
   * gets queue[N-1]. Used for traps (ROADMAP #5). Mutually exclusive with `event`.
   * Entries are consumed once; the geofence fn ranks arrivals to index this.
   */
  eventQueue?: CheckpointEvent[];
  /**
   * Active window (ROADMAP #12). Crossings outside [opensAt, closesAt] don't fire.
   * Either bound may be absent (open-ended). Toggled by the run-sheet (§6).
   */
  opensAt?: FsTimestamp | null;
  closesAt?: FsTimestamp | null;
}
```

**Trigger pipeline** — extend the existing geofence Cloud Function
(`functions/src/geofence.ts`). On entry it already creates an `Arrival` and notifies GMs.
Add, in order:

1. **Window gate (#12):** if `opensAt`/`closesAt` are set and `now` is outside the window,
   record the arrival but fire nothing.
2. **Co-arrival / same-district suppression (§7 traps):** look back over recent arrivals at
   this checkpoint within a short window (e.g. 60–90s, configurable). If another tribute
   from the **same district** (`member.district`) arrived in that window, **withhold** the
   trap for both and log it GM-only ("District N pair arrived together — trap withheld").
3. **Pick the payload:** for `eventQueue`, compute this player's **arrival ordinal** at the
   checkpoint (count of prior distinct, non-suppressed arrivers) and select
   `eventQueue[ordinal]`; if the queue is exhausted, no event. For a single `event`, honor
   `once` (dedupe against `arrivals` for that checkpoint/player).
4. **Route by `audience`:** write a `Broadcast` (§3) and/or send push. A `gear-drop` with
   `recipientPlayerId` only notifies that one player; a non-recipient crossing is logged
   GM-only (Rule 32's "don't take someone else's drop").

   *Voucher turn-in sites are not handled here* — they mint nothing on crossing (§7). They
   are plain time-windowed checkpoints whose opening the run-sheet (§6) announces.

The arrival ordinal and same-district check need each member's `district` (§5 above) and an
index on `arrivals` by (`checkpointId`, `timestamp`).

---

## 3. New collection: `broadcasts` (ROADMAP #4)

GM→player one-way messaging. **No player↔player channel** (Rule 23). Path:
`games/{gameId}/broadcasts/{broadcastId}`.

```ts
export type BroadcastKind =
  | 'gm-message'      // free-text GM announcement
  | 'player-count'    // auto "N tributes remain" (Rule 24)
  | 'death'           // "[X] has fallen" (Rules 2, 8)
  | 'checkpoint-event'// emitted by §2
  | 'winner';         // Rule 1

export interface Broadcast {
  id: string;
  kind: BroadcastKind;
  message: string;
  /** Omitted = all players. Set = targeted to one player (Rule 32 drops). */
  targetPlayerId?: string;
  createdAt: FsTimestamp;
}
```

- `GameContext` adds a `broadcasts` listener (ordered by `createdAt`), visible to players
  filtered to `targetPlayerId == null || == me`. This replaces the dead "waiting" screen.
- `firestore.rules`: members can **read** broadcasts; only the GM (or Cloud Functions) can
  **write** them.

---

## 4. New collection: `rations` (ROADMAP #1)

Path: `games/{gameId}/rations/{playerId}_{intervalIndex}` (deterministic ID =
idempotent submit, one doc per player per window).

```ts
export type RationStatus = 'pending' | 'valid' | 'rejected';

export interface RationSubmission {
  id: string;             // `${playerId}_${intervalIndex}`
  playerId: string;
  playerName: string;
  intervalIndex: number;  // §1 interval math
  photoUrl: string;       // Firebase Storage download URL
  /** Card number the player typed/OCR'd; for uniqueness check (Rule 6). */
  cardNumber?: string;
  status: RationStatus;
  submittedAt: FsTimestamp;
  reviewedAt?: FsTimestamp | null;
}
```

- **Player:** capture timestamped photo → upload to Storage
  `rations/{gameId}/{playerId}/{intervalIndex}.jpg` → write submission as `pending`.
- **GM:** review feed marks `valid`/`rejected`; if `enforceUniqueRationCards`, reject a
  `cardNumber` already `valid` elsewhere in the game.
- **Starvation** (`functions/src/rations.ts`, scheduled): at each interval boundary, every
  living player lacking a non-rejected submission for the **prior** interval →
  eliminate (§5) with `cause: 'starvation'`. Skipped entirely when `rationsEnabled` is
  false or `starvationMode === 'gm-confirmed'` (then it only flags for GM review).

---

## 5. Elimination & safety — extend `GameMember`

Builds on the existing `out`/`outAt`. The "I'm Out" action is reframed as
"I've been killed" (Rule 16); add cause + GM-initiated eliminations + SOS.

```ts
export type EliminationCause =
  | 'self'        // honor-system self-report (Rule 16)
  | 'starvation'  // Rule 8
  | 'bad-sport'   // Rule 14
  | 'stole-drop'  // Rule 32
  | 'comms'       // Rule 23
  | 'cold-tapout' // Rule 28 (safe retreat, not combat)
  | 'gm-other';

export interface GameMember {
  // ...existing fields (out, outAt, archived)...
  /** Why this member is out. Pairs with `out`/`outAt`. */
  cause?: EliminationCause;
  /** Where they dropped pack/weapons on death (Rules 19, 20). */
  deathLocation?: { latitude: number; longitude: number } | null;

  /**
   * District / tribute pairing (ROADMAP #10). Two tributes share a district.
   * Set by the GM when seeding, or on join + GM confirm. Read by the geofence fn
   * for the same-district trap-suppression rule (§2). Absent on solo/legacy games.
   */
  district?: string | number;

  // --- Safety SOS (Rules 22, 27, 28) ---
  sos?: boolean;
  sosAt?: FsTimestamp | null;
  sosLocation?: { latitude: number; longitude: number } | null;
}
```

- **Self-report / GM eliminate:** generalize `markPlayerOut` →
  `eliminatePlayer(gameId, playerId, cause)`; write a `death` Broadcast (§3); if
  `winnerDetection` and one living non-GM member remains, write a `winner` Broadcast and
  move the game to `results`.
- **SOS:** `raiseSos(gameId)` sets the flag + location and sends high-priority push/SMS to
  all GM tokens. Surfaced prominently on the GM map. `cold-tapout` reuses the elimination
  path with its own cause so it's distinguishable from a combat death.

---

## 6. New collection: `scheduledEvents` — the run-sheet (ROADMAP #11)

Path: `games/{gameId}/scheduledEvents/{eventId}`. A GM-authored timeline of timed actions
(the in-app replacement for the spreadsheet). A scheduled Cloud Function (or a GM-side timer
with a server backstop) sweeps for due, unfired actions and executes them.

```ts
export type ScheduledActionType =
  | 'broadcast'    // write a Broadcast (§3); free text or templated
  | 'open-site'    // set a checkpoint's opensAt window live (§2 #12)
  | 'close-site'   // close a checkpoint's window
  | 'gear-drop'    // announce a drop location (broadcast)
  | 'gm-reminder'; // GM-only nudge ("send Aaron to The Dock")

export interface ScheduledEvent {
  id: string;
  type: ScheduledActionType;
  /** Absolute fire time, OR offsetMinutes from game.startedAt (exactly one set). */
  fireAt?: FsTimestamp | null;
  offsetMinutes?: number | null;
  /** Target checkpoint for open-site/close-site. */
  checkpointId?: string;
  /** Message body for broadcast / gear-drop / gm-reminder. */
  message?: string;
  /** Broadcast audience; gm-reminder is implicitly GM-only. */
  audience?: EventAudience;
  /** Templated payloads, e.g. 'player-count' fills in the living count. */
  template?: 'player-count' | null;
  /** Set when executed → idempotent; the sweep skips fired rows. */
  firedAt?: FsTimestamp | null;
}
```

- The sweep resolves `fireAt` (or `startedAt + offsetMinutes`); when `now >= fireAt` and
  `firedAt == null`, it runs the action and stamps `firedAt` in a transaction (dedupe).
- `open-site`/`close-site` write `opensAt`/`closesAt` on the target checkpoint (§2).
- `broadcast`/`gear-drop` write a `Broadcast` (§3); `template: 'player-count'` fills the
  living-tribute count (reuses ROADMAP #4's count).
- `gm-reminder` pushes only to GM tokens.

## 7. Voucher turn-in sites — *no new collection* (ROADMAP #13)

Vouchers are **physical tokens** a player turns in to the GM, at a timed/located site, to
receive a **ration card** (the card the Rules 6–9 loop consumes). The exchange is paper and
in-person, so the app holds **no voucher/claim state** — there is **no `vouchers` collection**
and **no `voucher` checkpoint event type**. The earlier auto-mint-on-crossing model is
dropped. The app does only the two things the schedule and the GM need:

- **Announce the turn-in window.** A voucher site is just a checkpoint with an
  `[opensAt, closesAt]` window (§2 #12); the run-sheet (§6) `open-site`/`close-site` actions
  toggle it and emit the announcing `Broadcast` ("Voucher turn-in open at The Dock until
  12:55"). This is the concrete "open a location at a set time" mechanic — nothing
  voucher-specific is needed beyond a time-windowed checkpoint plus a run-sheet entry.
- **Global supply control.** "Rip up all vouchers" / "Rip up all ration cards" are ordinary
  GM free-text broadcasts (§3, `kind: 'gm-message'`) — a deliberate lever to choke or reset
  the food economy. No new kind, collection, or server state; the effect plays out physically
  and surfaces in the next ration window's submissions.

## 8. `Collections` additions

In [services/firebase.ts](services/firebase.ts):

```ts
export const Collections = {
  // ...existing...
  BROADCASTS: 'broadcasts',
  RATIONS: 'rations',
  SCHEDULED_EVENTS: 'scheduledEvents',
} as const;
```

---

## 9. Firestore rules & indexes — checklist

- `broadcasts`: members read; GM/functions write.
- `rations`: a player writes only their own submission; GM reads all + updates `status`.
- `scheduledEvents`: GM read/write (authoring the run-sheet); functions write `firedAt`.
  Players don't read it (they see only its *output* broadcasts).
- Member self-writes already allow `out`/`archived`; extend the allowed-field set to
  `cause`, `deathLocation`, `sos*` (player may set their own `sos`/self `cause`; GM may set
  any member's `cause`). `district` is **GM-only** to write (so tributes can't reassign their
  own pairing).
- New composite indexes likely needed: `broadcasts` by `createdAt`; `rations` by
  (`intervalIndex`, `status`) for the GM feed and the starvation sweep; `arrivals` by
  (`checkpointId`, `timestamp`) for the per-checkpoint arrival ordinal + co-arrival window
  (§2); `scheduledEvents` by `fireAt` for the sweep.

---

## 10. End-game phase (ROADMAP P3)

The schedule has a distinct **end-game** block before the game concludes. Add `'endgame'` to
the phase union between `'play'` and `'results'`:

```ts
phase?: 'setup' | 'lobby' | 'play' | 'endgame' | 'results';
```

GM-triggered (a new `startEndgame()` helper alongside `startGame`/`endGame` in
`gameService.ts`); `gamePhase(game)` keeps defaulting legacy games to `play`/`results`.
Players see an "end-game" banner (e.g. final-convergence / sudden-death instructions); the
ration loop can be auto-disabled in this phase. No new collection — just one phase value and
the transition helper.

## 11. Build order recap

Schema-wise the dependency chain is: **`game.config` (§1)** and **`broadcasts` (§3)** are
foundational — land them first, since elimination (§5), rations (§4), checkpoint events (§2)
and the run-sheet (§6) all emit broadcasts and read config. Then
§5 → §4 → **`district` (in §5)** → **site windows (in §2)** → checkpoint events/traps (§2) →
run-sheet (§6), matching the ROADMAP build order
(3 → 2 → 1 → 4 → 6 → 10 → 12 → 5 → 11). Voucher turn-in (§7) adds no schema — it falls out of
site windows + the run-sheet once both exist.

---

## 12. Safety-net invariants — schema & enforcement deltas (ROADMAP "Safety nets")

Most safety nets are **enforcement, not schema**: last-GM, no-mid-game-delete, monotonic
phases, the Start-Game preflight, the config-lock, and server idempotency live in
`firestore.rules`, the `gameService` transition helpers, and the Cloud Functions — no new
fields. The handful that touch the schema:

For MVP the late-join lock is **unconditional** — there is no `allowLateJoin` knob; joining
is closed once the game reaches `play`. (A GM opt-in for stragglers is a post-MVP addition.)

```ts
export interface GameMember {
  // ...existing (out, cause, sos*, district)...
  /** GM acknowledged this member's SOS; the SOS stays "open" until set. Null = unacked. */
  sosAckAt?: FsTimestamp | null;
  /** Latched true while the player is outside game.boundary, so the exit alert fires once. */
  outOfBounds?: boolean;
}

export interface PlayerLocation {
  // ...existing...
  /** Device battery 0–1, reported with each fix; drives the GM low-battery flag. */
  battery?: number;
}
```

- **Revive** needs no field — `revivePlayer(gameId, playerId)` clears `out`/`outAt`/`cause`
  and writes a correcting `Broadcast` (`kind: 'gm-message'`). If the game had flipped to
  `results` on a now-undone winner, it returns to `play`.
- **Boundary-exit** and **tracking-stopped** alerts reuse the GM-only broadcast/push path
  (no new collection): the location/geofence function sets `outOfBounds` on a player who
  leaves `game.boundary` and emits a GM alert; the existing stale-fix logic
  (`services/locationStatus.ts`) feeds the tracking-stopped alarm.
- **Rules deltas:** member `delete` denied when `gamePhase(game) == 'play'`; a member `role`
  change or `delete` that would leave **zero GMs** is denied; `sosAckAt` is GM-write-only;
  the `joinGameByCode` function rejects any join once `gamePhase(game) != 'lobby'` (it
  already rejects non-active games); players keep writing their own `battery`/location as
  today.
- **Enforcement-only invariants** (no schema): Start-Game preflight and the interval-config
  lock live in the `startGame`/`updateGameConfig` helpers; phase monotonicity in the
  transition helpers; idempotency in the winner/starvation/run-sheet functions (deterministic
  ids + `firedAt`, already the pattern for `rations` and `scheduledEvents`).

---

## 13. Test / practice game mode (ROADMAP #15)

A disposable, on-site dress-rehearsal game — players physically present walk the checkpoints
so the **real** geofence/event/push pipeline runs — flagged so it never mixes with real data.

```ts
export interface Game {
  // ...existing...
  /** Marks a disposable dress-rehearsal game: PRACTICE badge, relaxed guards, auto-cleanup. */
  practice?: boolean;
}
```

- **Badge:** every GM/player screen shows a PRACTICE banner when `game.practice` is set.
- **Relaxed guards:** the §12 invariants that block destructive actions (mid-game delete lock,
  end-while-unaccounted-for, the two-step destructive-broadcast/End-Game confirms) are
  **bypassed** when `practice` — the whole point is to tear down and re-run freely.
- **Test checkpoint:** a `Checkpoint.test?: boolean` flag (extends §2). A GM "drop test
  checkpoint here" action creates one at the device's current GPS with a default generous
  radius and a test event, firing the normal `onLocationUpdate` geofence path — so the team
  can verify events/pushes from wherever they're gathered, off-venue. Test checkpoints are
  badged distinctly and bulk-removed with the practice game (or via a "clear test checkpoints"
  action before a real game goes live), so they never reach the real course.
- **Re-run / reset:** a GM action clears the game's `arrivals`, `locations`, and `rations`
  subcollections so the drill repeats without recreating the game.
- **Cleanup:** practice games auto-delete (game doc + Storage photos) on end or after a short
  TTL, extending the `cleanupRationPhotosOnGameEnd` Cloud Function to remove the whole game.
- **Readiness view:** GM-side derived state (no schema) — joined vs. expected count, players
  with a fresh fix (reuses `services/locationStatus.ts`), and per-device push-delivery
  confirmation. The "green check before kickoff."
- **Rules delta:** `practice` is GM-write-only and set at creation (in the `createGame`
  function); the relaxed-guard branches in `firestore.rules` / the service helpers key off it.

---

## 14. Ration review & single-submission UX (ROADMAP #22–#24)

**No schema change** — these are UI-state deltas over the existing `RationSubmission` doc (§4)
and its `status: 'pending' | 'valid' | 'rejected'`. The deterministic id
`rations/{playerId}_{intervalIndex}` already gives one doc per player per window; the work is to
make both the GM review and the player panel render purely off that doc's `status`.

- **#22 — terminal review action (GM).** In the mobile feed (`app/(app)/gm/[gameId]/rations.tsx`)
  and the web `RationsModal`, branch on `submission.status`:
  - `pending` → show the **Approve** / **Reject** button pair (both call `reviewRation()`).
  - `valid` / `rejected` → show a **resolved chip** ("✓ Approved" / "✕ Rejected"), **no live
    opposite button**. Any change-of-mind is a separate explicit "change decision" control, not a
    standing second button. `reviewRation()` itself is unchanged — it already writes
    `status` + `reviewedAt`; this is purely which controls render for a non-`pending` doc.

- **#23 — viewport-fit, scrollable photo review.** The lightbox/review image uses
  `resizeMode: 'contain'` sized to the available width/height (mobile: `useWindowDimensions()`
  minus chrome; web: `max-width:100%; max-height:100vh; object-fit:contain`), inside a scrollable
  container (`ScrollView` / overflow-auto modal body) so an over-tall portrait card can be panned
  rather than clipped. No data change.

- **#24 — one submission per window, state-driven panel.** `RationPanel.tsx` already receives the
  player's submissions via the rations listener; select the doc for the **current** `intervalIndex`
  (`rationInterval(game, now)`, §1) and drive the panel off it:

  | current-window doc | window open? | panel state |
  | --- | --- | --- |
  | none | open | **capture UI** (camera) |
  | `pending` | open | **"approval pending"** — capture hidden |
  | `valid` | open or closed | **"ration approved"** → countdown to next window's open |
  | `rejected` | open | **capture UI re-enabled** (still owes a valid card this interval) |
  | `rejected` | closed | normal **missed/closed** state |
  | none | closed | normal **"opens in …"** / missed state |

  The countdown after a `valid` reuses the same `windowStartsAt` math the closed-window branch
  already shows — an approved card simply ends this window early for that player. No new field;
  re-submit after a rejection overwrites the same deterministic doc back to `pending`.

---

## 15. Production hardening & go-live (ROADMAP #25–#39)

Mostly **config, infra, and enforcement deltas — almost no schema change.** These are the
deploy-blockers and cost/lifecycle gaps from the 2026-06-04 code review. Grouped by the same
severity tiers as the roadmap.

### Critical (#25–#28)

- **#25 — Twilio off `functions.config()`.** Replace the `functions.config().twilio.*` reads in
  `functions/src/sms.ts` with `defineSecret('TWILIO_SID' | 'TWILIO_TOKEN' | 'TWILIO_FROM')` (or
  params), declare them on the SMS-sending functions' `runWith({ secrets: [...] })`, and set them
  with `firebase functions:secrets:set`. No app-side change; `sendArrivalSMS` still no-ops when a
  secret is unset (same graceful-skip as today).
- **#26 — App Check + callable throttle.** Flip `ENFORCE_APP_CHECK → true` in
  `functions/src/games.ts` *after* both platforms are registered and verified. Add a lightweight
  per-UID rate limit to `joinGameByCode`: a `rateLimits/{uid}` doc (or a counter on the user doc)
  stamped each attempt, rejecting > N tries / window with `resource-exhausted`. Schema: an
  internal, admin-SDK-only `rateLimits` collection (not in `Collections`, not client-readable) —
  no game-doc change.
- **#27 — Maps key restriction.** Pure ops/console task — restrict each `app.json` Maps key to its
  bundle ID / SHA-1 + Maps SDK in Google Cloud Console. No code, no schema.
- **#28 — run-sheet index.** Add the missing single-field override to `firestore.indexes.json` so
  the `collectionGroup('scheduledEvents').where('firedAt','==',null)` sweep (`runsheet.ts`) has a
  collection-group index:

  ```jsonc
  // firestore.indexes.json → fieldOverrides[]
  {
    "collectionGroup": "scheduledEvents",
    "fieldPath": "firedAt",
    "indexes": [
      { "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }
    ]
  }
  ```

  Mirrors the existing `members.userId` override. Redeploy with `firebase deploy --only firestore:indexes`.

### High (#29–#32)

- **#29 — geofence read cost.** No schema. In `onLocationUpdate`, avoid the per-write game+member
  reads where possible: e.g. short-circuit lobby writes before the second read, skip when the
  game has zero checkpoints, or cache the game-phase/member-role on a cheap lookup. Goal is fewer
  reads per location write, not a data change.
- **#30 — data retention.** Extend `cleanupRationPhotosOnGameEnd` (`functions/src/cleanup.ts`),
  which already fires on the `status: active → ended` game-doc transition, to also
  `recursiveDelete` (or batch-delete) the game's `locations` (and optionally `arrivals`)
  subcollections. No schema; a lifecycle/cleanup delta. Document the retention window in the
  privacy policy.
- **#31 — `getMyGames` N+1.** `services/gameService.ts` — replace the sequential `for … await`
  per-game read with `Promise.all(memberDocs.map(...))`. No schema.
- **#32 — shared broadcast subscription.** Lift the global+targeted broadcast listeners out of
  `AlertOverlay`/`BroadcastFeed` into one source (a small `useBroadcasts(gameId)` hook or a
  player-side `GameContext` subscription) and pass results down as props. No schema — a
  client-architecture change to cut concurrent listeners.

### Medium / Low (#33–#39)

- **#33 — transactional single-event arrival dedup.** `functions/src/geofence.ts` — wrap the
  single-`event` arrival write in the same `runTransaction` idempotency guard the `eventQueue`
  path uses (re-read arrivals for `checkpointId`, bail if this `playerId` already recorded). No
  schema.
- **#34 — `deleteAccount` robustness.** `services/gameService.ts` — chunk deletes into ≤ 500-write
  batches (or `recursiveDelete` per game via a callable), and detect sole-GM games (offer GM
  transfer, or delete the game server-side). May warrant a small `transferGm`/`deleteGameForce`
  callable; no game-doc schema change.
- **#35 — tracking controller.** `app/(app)/player/game.tsx` — collapse the tracking effect +
  AppState re-assert into one controller gated on a stable `shouldTrack` boolean so deps like
  `displayName` arriving don't stop/restart the background service. Client-only.
- **#36 — coordinate range rule.** `firestore.rules` locations `create, update` — add
  `request.resource.data.latitude >= -90 && <= 90` and `longitude >= -180 && <= 180` to the
  existing `is number` checks.
- **#37 — rebrand SMS prefix.** `functions/src/sms.ts` — change the `[HungerGamesLocator]` body
  prefix to the Outdoor GM brand. Cosmetic.
- **#38 — login loading reset.** `app/(auth)/login.tsx` — add `finally { setLoading(false) }` (or
  a mounted guard) so the submit button can't spin forever if navigation stalls. Client-only.
- **#39 — drop unused index.** Remove the unused `arrivals` (playerId ASC, timestamp DESC)
  composite from `firestore.indexes.json` (no query references it), or add the query that needs it.
