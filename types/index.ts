/**
 * Platform-neutral Firestore timestamp shape. Both the React Native SDK's
 * `FsTimestamp` and the Firebase JS SDK's `Timestamp`
 * satisfy this structurally, so these types compile in both the mobile app and
 * the web GM dashboard (web/) without either importing the other's Firestore SDK.
 */
export interface FsTimestamp {
  toMillis(): number;
  toDate(): Date;
  seconds: number;
  nanoseconds: number;
}

export type UserRole = 'player' | 'gm';
export type GameStatus = 'active' | 'ended';

/**
 * The lifecycle phase of a game:
 * - `setup`   — GMs define boundary, checkpoints, and rules. Not yet open to players.
 * - `lobby`   — Open for players to join, name themselves, and read the tutorial. Not started.
 * - `play`    — Game is live; the play timer runs and players share location.
 * - `results` — Game over; players can see how they did.
 */
export type GamePhase = 'setup' | 'lobby' | 'play' | 'results';

/** Play-area boundary, defined by the GM from a map view. */
export interface MapBoundary {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /**
   * Ordered polygon vertices (≥ 3). When present, this takes precedence over the
   * min/max box for both rendering and framing — the box is kept as a legacy/
   * fallback bounding rectangle (creators should set it to the polygon's bbox).
   * Polygon authoring is web-only; viewing is supported on mobile + web.
   */
  polygon?: { latitude: number; longitude: number }[];
}

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  fcmToken?: string;
  createdAt: FsTimestamp;
}

export interface Game {
  id: string;
  name: string;
  playerCode: string;
  gmCode: string;
  creatorId: string;
  status: GameStatus;
  phase: GamePhase;
  /** Free-text rules the GM writes during setup; shown to players in the tutorial. */
  rules?: string;
  /** Rectangular play area, set by the GM during setup. */
  boundary?: MapBoundary;
  /** When the GM pressed Start (phase → play). */
  startedAt?: FsTimestamp | null;
  /** When the GM pressed End (phase → results). */
  endedAt?: FsTimestamp | null;
  /**
   * GM-set event date (ROADMAP #36), distinct from the system `createdAt`. When present
   * it's used to sort/label "My Games"; absent → fall back to `createdAt`. Editable by the
   * GM in setup. An all-day date (stored as that day's local midnight).
   */
  gameDate?: FsTimestamp | null;
  /** GM-tunable parameters; absent on legacy games (resolve with BASE_GAME_CONFIG). */
  config?: Partial<GameConfig>;
  /**
   * This is a guided Test Event (created from the "This is a test" checkbox). It's a
   * real, auto-configured game whose GM is walked through verifying every feature in a
   * tight space. Set server-side by the createGame Cloud Function.
   */
  isTest?: boolean;
  /**
   * The GM's current position in the Test Runner walkthrough (a resumable cursor). Only
   * meaningful when `isTest`. Most step progress is derived live from Firestore; this just
   * survives an app restart. See app/(app)/gm/[gameId]/test.tsx.
   */
  testStepIndex?: number;
  createdAt: FsTimestamp;
}

/**
 * GM-tunable game parameters. All fields are stored optionally on `Game.config`;
 * resolve a complete config by spreading over `BASE_GAME_CONFIG` (the base game rules).
 */
export interface GameConfig {
  /** Total game length in minutes. Rule 5 → 210 (3.5h). */
  durationMinutes: number;

  // --- Ration / starvation loop (Rules 6–9) ---
  rationsEnabled: boolean;
  /** Length of each ration interval in minutes — the cadence of "eat or starve". Rule 6/7 → 30. */
  rationIntervalMinutes: number;
  /**
   * How long the eat-window stays *open* at the end of each interval, in minutes. The
   * capture panel is hidden until this window opens (so a player isn't pestered for a
   * card 5 minutes in) and the player is alerted when it opens. Clamped to ≤
   * `rationIntervalMinutes`; setting it ≥ the interval keeps the panel open all interval
   * (the legacy behavior). With a 30-min interval and a 10-min window the panel opens at
   * the 20-min mark and the deadline is the 30-min interval boundary.
   */
  rationWindowMinutes: number;
  /** What happens when a player misses a window. */
  starvationMode: 'auto' | 'gm-confirmed';
  /** Reject a ration photo whose card number was already used (Rule 6). */
  enforceUniqueRationCards: boolean;

  // --- Broadcast (Rule 24) ---
  /** Auto-push the living-player count every interval. */
  playerCountBroadcast: boolean;

  // --- Elimination (Rules 1, 16) ---
  /** Surface a winner when one living player remains. */
  winnerDetection: boolean;

  // --- Tracking (Rule 21) ---
  /** Coarser GPS cadence when the player is stationary. */
  batterySaver: boolean;

  // --- Geofence quality (#50/#55) ---
  /**
   * GPS fix quality gate for checkpoint evaluation. Fixes with reported accuracy (m)
   * worse than this threshold are skipped for checkpoint eval — the map dot still
   * updates. Default 30 m.
   */
  minFixAccuracyMeters?: number;
  /**
   * Consecutive in-radius location fixes required before recording a checkpoint arrival.
   * Debounces a lone jumpy fix. Default 2.
   */
  geofenceConfirmFixes?: number;
  /**
   * GM re-notification cooldown: the GM is re-alerted when a player returns to a
   * checkpoint they previously visited and was away at least this many minutes. Default 5.
   */
  reNotifyAwayCooldownMinutes?: number;
  /**
   * #67: while a player stays inside a checkpoint, its runbook entries are re-evaluated
   * every this-many minutes, so an entry that becomes eligible later (a `timed` window
   * opening) still trips without the player leaving and re-entering. Each entry trips at
   * most once per player (tracked in `entryTrips`). Default 2.
   */
  tripIntervalMinutes?: number;

  // --- Auto-end (#56) ---
  /**
   * When to auto-end the game based on living-player count.
   * - `'one'`    — end when 1 living player remains and crown them winner (default).
   * - `'zero'`   — end only when 0 living players remain ("no winner").
   * - `'manual'` — never auto-end; maps from legacy `winnerDetection: false`.
   */
  autoEndThreshold?: 'one' | 'zero' | 'manual';
}

/** Seed defaults for a new game = the base game rules. */
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

/**
 * The four things a runbook entry can do when it fires for a player (ROADMAP #60):
 * - `hazard`    — a danger (beast attack, poison, …); themed push to the crossing player.
 * - `boon`      — a positive find; themed push to the crossing player.
 * - `notify`    — a plain message to the crossing player, or to all players.
 * - `gm-notify` — only the GM is alerted; the player sees nothing (the default ping).
 */
export type CheckpointKind = 'hazard' | 'boon' | 'gm-notify' | 'notify';

/**
 * Per-player/per-checkpoint crossing latch (ROADMAP #50/#55). Written only by Cloud
 * Functions (admin SDK); never readable by clients. Tracks inside/outside state and
 * consecutive-fix streak for arrival debouncing, plus the away timestamp for GM
 * re-notification and the last surfaced state for player re-notification.
 * Path: games/{gameId}/checkpointTrips/{playerId}_{checkpointId}.
 */
export interface CheckpointTrip {
  playerId: string;
  checkpointId: string;
  /** True while the player is confirmed inside the radius. */
  inside: boolean;
  /** Consecutive in-radius fixes since last non-inside write. Feeds #50 debounce. */
  insideStreak: number;
  /** Timestamp of the most recent confirmed entry. */
  lastEnterAt?: FsTimestamp | null;
  /** Timestamp of the most recent confirmed exit. */
  lastExitAt?: FsTimestamp | null;
  /**
   * The resolved runbook effect kind at the last time a player notification was sent
   * (#55). Used to re-notify only when the resolved effect changes.
   */
  lastNotifiedState?: string | null;
  /** #67: this player's 0-based arrival ordinal at the checkpoint, latched on first entry
   * so the periodic re-evaluation resolves fixed-order slots consistently. */
  arrivalOrdinal?: number | null;
  /** #67: last time the runbook entries were re-evaluated for this player while inside,
   * gating the `tripIntervalMinutes` cadence. */
  lastTripCheckAt?: FsTimestamp | null;
}

/**
 * Per-player/per-runbook-entry trip latch (ROADMAP #67). Written only by Cloud Functions
 * (admin SDK); never client-readable. Its mere existence means the player has already
 * tripped that entry — each entry fires at most once per player, independent of other
 * entries on the same checkpoint. Path: games/{gameId}/entryTrips/{playerId}_{entryId}.
 */
export interface EntryTrip {
  /** Doc id (`${playerId}_${entryId}`); present when read client-side. */
  id?: string;
  playerId: string;
  entryId: string;
  checkpointId: string;
  trippedAt: FsTimestamp;
  // Denormalized snapshot of the fired effect (#73), so the GM feed renders one accurate row
  // per actual trip without re-joining the runbook. Written by the geofence on the crossing.
  playerName?: string;
  entryName?: string | null;
  checkpointName?: string;
  effectKind?: CheckpointKind;
  message?: string | null;
}

/** Who a `notify` effect reaches. Only meaningful for `kind: 'notify'`. */
export type NotifyAudience = 'crossing-player' | 'all-players';

/**
 * What a runbook entry delivers to a player when it fires (ROADMAP #60). A fixed-order
 * entry can carry a distinct effect per arrival slot; other triggers use the entry's
 * single `effect`.
 */
export interface RunbookEffect {
  kind: CheckpointKind;
  /** Body shown in the push/broadcast, e.g. "A beast attacks! Defend or flee." */
  message?: string;
  /**
   * For `kind: 'notify'` only: the crossing player (default) or all players.
   * `hazard`/`boon` always go to the crossing player; `gm-notify` to the GM only.
   */
  audience?: NotifyAudience;
}

/** The four ways a runbook entry becomes eligible to fire (ROADMAP #60). */
export type RunbookTriggerType = 'fixed-order' | 'always-on' | 'timed' | 'gm-prompted';

/**
 * A start/end bound for a `timed` runbook entry (ROADMAP #60). `game-start`/`game-end`
 * anchor to the game's lifecycle; `time` is an explicit minute offset after `startedAt`
 * (primary) or an absolute `fireAt` (reserved).
 */
export type TimedBound =
  | { kind: 'game-start' }
  | { kind: 'game-end' }
  | { kind: 'time'; atMinute?: number; fireAt?: FsTimestamp };

/**
 * One behavior attached to a checkpoint (ROADMAP #60). A checkpoint owns 0..N entries;
 * on a crossing a player receives exactly one — the highest-`priority` matching entry.
 * Stored at games/{gameId}/runbook/{entryId} (top-level, GM-only).
 */
export interface RunbookEntry {
  id: string;
  /** The checkpoint this entry is attached to. */
  checkpointId: string;
  /** GM-facing label, e.g. "Sponsor drop" or "Midnight hazard". */
  name: string;
  /** Higher wins on a crossing; also the primary sidebar sort key. */
  priority: number;
  trigger: RunbookTriggerType;
  /** The entry's effect; also the fixed-order default for positions past `queueSlots`. */
  effect: RunbookEffect;
  /**
   * `fixed-order` only: the Nth distinct arriver (0-based) gets `queueSlots[N]`; a `null`
   * slot fires nothing for that arriver; positions beyond the array fall back to `effect`
   * (or to nothing when `defaultNone` is set).
   */
  queueSlots?: (RunbookEffect | null)[];
  /**
   * `fixed-order` only: when true, the default position (arrivers past `queueSlots`, and
   * revisits) fires nothing instead of `effect` — the entry-level mirror of a `null` slot.
   * `effect` is still stored (it drives the entry's pin color) but is not delivered.
   */
  defaultNone?: boolean;
  /** `timed` only: window start (default `{ kind: 'game-start' }`). */
  startAt?: TimedBound;
  /** `timed` only: window end (default `{ kind: 'game-end' }`). */
  endAt?: TimedBound;
  /**
   * `gm-prompted` only: latched when the GM fires it, for the results view / idempotency.
   * Cleared/reset on re-arm. Not used by crossing resolution.
   */
  firedAt?: FsTimestamp | null;
  createdAt: FsTimestamp;
}

/**
 * Whether (and when) a checkpoint's marker is shown to players (ROADMAP #60, formerly #48).
 * ORTHOGONAL to the runbook: visibility = whether/when/to-whom the marker shows on the
 * player map; the runbook = what happens on crossing. A marker only ever carries the
 * checkpoint's name + location (never any secret effect body).
 * - `hidden`           — never shown to players (the default; invisible-to-players).
 * - `shown`            — shown to all players from Start Game (a named location whose
 *                        effect is still secret until crossed).
 * - `shown-on-trigger` — hidden until a `reveal` trigger fires (trap, timed drop, sponsor).
 */
export type CheckpointVisibility = 'hidden' | 'shown' | 'shown-on-trigger';

/** How a `shown-on-trigger` checkpoint becomes visible. */
export type RevealTrigger =
  | 'player' // revealed the moment a player enters (the trap they just sprang)
  | 'gm' // GM taps "Reveal now"
  | 'timed'; // revealed at `offsetMinutes` after startedAt (run-sheet reveal row)

/** Who can see a `shown-on-trigger` checkpoint once it's revealed. */
export type RevealAudience =
  | 'all' // every player
  | 'specific-players' // a named subset, usually 1 (sponsor drop)
  | 'triggerer'; // only the player who crossed (a trap)

/** For `visibility: 'shown-on-trigger'` — how/when/to-whom the marker becomes visible. */
export interface CheckpointReveal {
  trigger: RevealTrigger;
  audience: RevealAudience;
  /** `timed` trigger: minutes after the game's `startedAt`. */
  offsetMinutes?: number | null;
  /** `timed` trigger: an absolute fire time (reserved; offsetMinutes is primary). */
  revealAt?: FsTimestamp | null;
  /** `specific-players` audience: member ids allowed to see it once revealed. */
  recipientPlayerIds?: string[];
}

/**
 * A checkpoint after the runbook overhaul (ROADMAP #60): identity + geofence geometry +
 * visibility only. All behavior lives in `RunbookEntry` docs keyed by this checkpoint's id.
 */
export interface Checkpoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  order?: number;
  /** Icon key for map authoring. Rendered via Ionicons. */
  icon?: string;
  /** Who can see this checkpoint's marker. Absent → `hidden` (invisible to players). */
  visibility?: CheckpointVisibility;
  /** For `visibility: 'shown-on-trigger'`: how/when/to-whom it becomes visible. */
  reveal?: CheckpointReveal;
  /** Latched when the reveal fires (set by the run-sheet / geofence / GM "reveal now"). */
  revealedAt?: FsTimestamp | null;
  /** For `specific-players`/`triggerer` audiences: member ids it's been revealed to so far. */
  revealedTo?: string[];
}

/**
 * A checkpoint marker projected into a player-readable surface (ROADMAP #48). The
 * `checkpoints` collection stays GM-only-readable (it holds every objective's coords +
 * secret payload); the server (and the trusted GM client) writes a marker here carrying
 * ONLY the label + location once a checkpoint is visible to a player.
 * Path: games/{gameId}/markers/{checkpointId}.
 */
export interface RevealedMarker {
  checkpointId: string;
  /** Marker label only — never the secret event payload (case C). */
  name: string;
  latitude: number;
  longitude: number;
  /** Null/absent = visible to all players; set = only these uids may read/see it (A/D). */
  audiencePlayerIds?: string[] | null;
  revealedAt: FsTimestamp;
  /**
   * Client-side visibility gate (ROADMAP #48 defense-in-depth). The player map hides
   * this marker until `visibleFrom` is in the past. Absent/null → visible immediately.
   * Set for game-time reveals so stale markers from a prior run are suppressed until
   * their reveal time.
   */
  visibleFrom?: FsTimestamp | null;
}

export interface GameMember {
  userId: string;
  role: UserRole;
  displayName: string;
  email: string;
  fcmToken?: string;
  /** Player marked themselves out of the game (phase: play). */
  out?: boolean;
  outAt?: FsTimestamp | null;
  /** Why this member is out. Pairs with `out`/`outAt`. */
  cause?: EliminationCause;
  /** Where they dropped pack/weapons on death (Rules 19, 20). */
  deathLocation?: { latitude: number; longitude: number } | null;
  /** Player raised a safety alert (Rules 22, 27, 28). */
  sos?: boolean;
  sosAt?: FsTimestamp | null;
  sosLocation?: { latitude: number; longitude: number } | null;
  /**
   * GM acknowledged this member's SOS (ROADMAP #5). The SOS stays the live, escalating
   * state — `sos === true && sosAckAt == null` — until a GM sets this; nothing auto-clears
   * it. GM-write-only (firestore.rules); raising a fresh SOS resets it to null. Blocks End
   * Game while any player has an open, unacked SOS (#6).
   */
  sosAckAt?: FsTimestamp | null;
  /**
   * Latched true while the player is outside `game.boundary` (ROADMAP #7). Set by the
   * geofence Cloud Function on exit (fires the GM alert once) and cleared on re-entry,
   * so a player straying outside the play area pings the GM exactly once per excursion.
   */
  outOfBounds?: boolean;
  /** This member hid the game from their own "My Games" list (finished games only). */
  archived?: boolean;
  /**
   * District / tribute pairing (ROADMAP #10). Two tributes share a district. Set by the
   * GM (players can't reassign their own — enforced in firestore.rules). Read by the
   * geofence function for the same-district trap-suppression rule (#5). Absent on
   * solo/legacy games.
   */
  district?: string | number;
  joinedAt: FsTimestamp;
}

export type EliminationCause =
  | 'self' // honor-system self-report (Rule 16)
  | 'starvation' // Rule 8
  | 'bad-sport' // Rule 14
  | 'stole-drop' // Rule 32
  | 'comms' // Rule 23
  | 'cold-tapout' // Rule 28 (safe retreat, not combat)
  | 'gm-other';

export interface PlayerLocation {
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  updatedAt: FsTimestamp;
}

export interface Arrival {
  id: string;
  playerId: string;
  playerName: string;
  checkpointId: string;
  checkpointName: string;
  timestamp: FsTimestamp;
  latitude: number;
  longitude: number;
}

/** GM→player one-way message. There is no player↔player channel (Rule 23). */
export type BroadcastKind =
  | 'gm-message' // free-text GM announcement
  | 'player-count' // auto "N tributes remain" (Rule 24)
  | 'death' // "[X] has fallen" (Rules 2, 8)
  | 'checkpoint-event' // emitted by a CheckpointEvent
  | 'winner'; // Rule 1

/**
 * Sentinel `targetPlayerId` for a GM↔GM (co-GM) message (ROADMAP #40). It is neither
 * `null` (the players' "global" query) nor any real player uid (their "mine" query), so
 * a player's broadcast listeners never fetch it — keeping co-GM chatter off their feed
 * without a separate collection. Paired with `audience: 'gm-only'` for clarity + a
 * defense-in-depth rule.
 */
export const GM_BROADCAST_TARGET = '__gm__';

export interface Broadcast {
  id: string;
  kind: BroadcastKind;
  message: string;
  /** Omitted = all players. Set = targeted to one player (Rule 32 drops), or the
   * `GM_BROADCAST_TARGET` sentinel for a co-GM message (#40). */
  targetPlayerId?: string;
  /** For `kind: 'checkpoint-event'` — the checkpoint kind, so the feed can theme it. */
  eventKind?: CheckpointKind;
  /** `'gm-only'` = a co-GM message, readable only by GMs (#40); absent = player-visible. */
  audience?: 'gm-only';
  /** Display name of the GM who sent a co-GM message (#40), so the feed can attribute it. */
  senderName?: string;
  /**
   * #69: set by the server when the writing function already pushed FCM for this broadcast,
   * so the `onBroadcastCreate` trigger doesn't double-push. Client-written broadcasts omit it
   * and the trigger delivers the push.
   */
  pushed?: boolean;
  createdAt: FsTimestamp;
}

export type RationStatus = 'pending' | 'valid' | 'rejected';

/** A player's ration-card photo for one eat window (Rules 6–9). */
export interface RationSubmission {
  id: string; // `${playerId}_${intervalIndex}` — deterministic, idempotent submit
  playerId: string;
  playerName: string;
  intervalIndex: number;
  photoUrl: string; // Firebase Storage download URL
  /** Card number the player typed/OCR'd; for the uniqueness check (Rule 6). */
  cardNumber?: string;
  status: RationStatus;
  submittedAt: FsTimestamp;
  reviewedAt?: FsTimestamp | null;
}

export interface ActiveGame {
  gameId: string;
  role: UserRole;
  displayName: string;
}

/** Run-sheet action types (ROADMAP #11) — the in-app replacement for the paper schedule.
 * Checkpoint open/close windows moved to `timed` runbook entries (#60); the run sheet keeps
 * the timed broadcasts, the GM reminders, and the timed marker reveal. */
export type ScheduledActionType =
  | 'broadcast' // write a Broadcast (free text, or templated player-count)
  | 'reveal-checkpoint' // make a checkpoint marker visible to players (#60 timed reveal)
  | 'gear-drop' // announce a drop location (a broadcast to all)
  | 'gm-reminder'; // GM-only nudge ("send Aaron to The Dock")

/** A GM-authored timed action on the run-sheet. A scheduled Cloud Function sweeps for
 * due, unfired actions and executes them, stamping `firedAt` (idempotent). */
export interface ScheduledEvent {
  id: string;
  type: ScheduledActionType;
  /** Minutes after the game's `startedAt` to fire. Primary scheduling model. */
  offsetMinutes?: number | null;
  /** Absolute fire time (alternative to offsetMinutes; reserved for future authoring). */
  fireAt?: FsTimestamp | null;
  /** Target checkpoint for `open-site`/`close-site`. */
  checkpointId?: string;
  /** Message body for `broadcast`/`gear-drop`/`gm-reminder`. */
  message?: string;
  /** Templated payloads, e.g. 'player-count' fills in the living tribute count. */
  template?: 'player-count' | null;
  /** Set when executed → idempotent; the sweep skips fired rows. */
  firedAt?: FsTimestamp | null;
  createdAt: FsTimestamp;
}
