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
  /** Length of each eat window in minutes. Rule 6/7 → 30. */
  rationIntervalMinutes: number;
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
`floor((now - startedAt) / (M * 60_000))`; total intervals = `durationMinutes / M`.

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
  | 'voucher'         // time-windowed sponsor-gear claim (§9)
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
4. **Route by `audience`:** write a `Broadcast` (§3) and/or send push. A `gear-drop`/
   `voucher` with `recipientPlayerId` only notifies that one player; a non-recipient
   crossing is logged GM-only (Rule 32's "don't take someone else's drop"). A `voucher`
   crossing also writes a redemption row (§7).

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

## 7. New collection: `vouchers` — sponsor-gear redemption (ROADMAP #13)

Path: `games/{gameId}/vouchers/{playerId}_{checkpointId}` (deterministic ID → one claim per
player per site, idempotent). Written by the geofence function when a player crosses a live
`voucher` checkpoint (§2).

```ts
export interface VoucherClaim {
  id: string;            // `${playerId}_${checkpointId}`
  playerId: string;
  playerName: string;
  checkpointId: string;
  checkpointName: string;
  /** Display name of the gear/voucher granted. */
  voucherName?: string;
  claimedAt: FsTimestamp;
}
```

- A claim is only created while the site is within its `[opensAt, closesAt]` window (§2 #1);
  a crossing after close is logged GM-only ("site closed"). The deterministic ID stops a
  player double-claiming.
- GM sees a redemption feed (who claimed which site). Pairs with the timed gear drops the
  run-sheet (§6) announces.

## 8. `Collections` additions

In [services/firebase.ts](services/firebase.ts):

```ts
export const Collections = {
  // ...existing...
  BROADCASTS: 'broadcasts',
  RATIONS: 'rations',
  SCHEDULED_EVENTS: 'scheduledEvents',
  VOUCHERS: 'vouchers',
} as const;
```

---

## 9. Firestore rules & indexes — checklist

- `broadcasts`: members read; GM/functions write.
- `rations`: a player writes only their own submission; GM reads all + updates `status`.
- `scheduledEvents`: GM read/write (authoring the run-sheet); functions write `firedAt`.
  Players don't read it (they see only its *output* broadcasts).
- `vouchers`: members read; **functions only** write (server-authoritative redemption, like
  `arrivals`) — a client must not be able to mint its own claim.
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
foundational — land them first, since elimination (§5), rations (§4), checkpoint events (§2),
the run-sheet (§6) and vouchers (§7) all emit broadcasts and read config. Then
§5 → §4 → **`district` (in §5)** → **site windows (in §2)** → checkpoint events/traps (§2) →
run-sheet (§6) → vouchers (§7), matching the ROADMAP build order
(3 → 2 → 1 → 4 → 6 → 10 → 12 → 5 → 11 → 13).
