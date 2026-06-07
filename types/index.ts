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
 * The four things a checkpoint can do when a player crosses it:
 * - `hazard`       — a danger (beast attack, poison, …); themed push to the crossing player.
 * - `boon`         — a positive find; themed push to the crossing player.
 * - `player-notify`— a plain message to the crossing player, or to all players.
 * - `gm-only`      — only the GM is alerted; the player sees nothing (the default ping).
 */
export type CheckpointKind = 'hazard' | 'boon' | 'player-notify' | 'gm-only';

/**
 * Declarative time-based state a checkpoint can be in (ROADMAP #54). Applied by the
 * run-sheet sweep from `Checkpoint.transitions[]`. `'closed'` shuts the site window;
 * `'boon'`/`'hazard'`/`'notification'` map to the corresponding CheckpointKind and
 * open the window.
 */
export type CheckpointState = 'closed' | 'boon' | 'hazard' | 'notification';

/**
 * A single timed state transition on a checkpoint (ROADMAP #54). The sweep applies
 * the latest transition whose `atMinute ≤ elapsed game time` — ordering matters when
 * multiple transitions are due. `atMinute` is relative to `game.startedAt`.
 */
export interface CheckpointTransition {
  atMinute: number;
  state: CheckpointState;
  /** Optional message to surface when this state becomes active. */
  message?: string;
}

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
   * The resolved checkpoint state (event.kind or currentState) at the last time a
   * player notification was sent (#55). Used to re-notify only on state changes.
   */
  lastNotifiedState?: string | null;
}

export type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';

/** What firing a checkpoint geofence does for one crossing. */
export interface CheckpointEvent {
  kind: CheckpointKind;
  /** Body shown in the push/broadcast, e.g. "A beast attacks! Defend or flee." */
  message?: string;
  /**
   * Who sees it. Only meaningful for `player-notify` (crossing-player | all-players).
   * `hazard`/`boon` imply `crossing-player`; `gm-only` implies `gm-only`. Resolved per
   * kind when omitted.
   */
  audience?: EventAudience;
  // Reserved for a future "snap a photo of the gear" gate (rations-style). Not used yet.
  // requirePhoto?: boolean;
}

/**
 * Whether (and when) a checkpoint's marker is shown to players (ROADMAP #48). This is
 * ORTHOGONAL to its `event`/`eventQueue` payload: visibility = whether/when/to-whom the
 * marker shows on the player map; the payload = what happens on crossing. A marker only
 * ever carries the checkpoint's name + location (never the secret event body).
 * - `gm-only` — never shown to players (the default; legacy invisible-to-players behavior).
 * - `always`  — shown to all players from Start Game (case C: a named location whose
 *               effect is still secret until crossed).
 * - `on-reveal`— hidden until a `reveal` trigger fires (cases A trap, B drop, D sponsor).
 */
export type CheckpointVisibility = 'gm-only' | 'always' | 'on-reveal';

/** How an `on-reveal` checkpoint becomes visible. */
export type RevealTrigger =
  | 'game-time' // revealed at `offsetMinutes` after startedAt (run-sheet reveal-checkpoint row)
  | 'gm-manual' // GM taps "Reveal now"
  | 'on-crossing'; // revealed the moment a player enters (case A trap)

/** Who can see an `on-reveal` checkpoint once it's revealed. */
export type RevealAudience =
  | 'all' // every player (case B)
  | 'specific-players' // a named subset, usually 1 (case D sponsor drop)
  | 'triggerer'; // only the player who crossed (case A trap)

/** For `visibility: 'on-reveal'` — how/when/to-whom the marker becomes visible. */
export interface CheckpointReveal {
  trigger: RevealTrigger;
  audience: RevealAudience;
  /** `game-time` trigger: minutes after the game's `startedAt`. */
  offsetMinutes?: number | null;
  /** `game-time` trigger: an absolute fire time (reserved; offsetMinutes is primary). */
  revealAt?: FsTimestamp | null;
  /** `specific-players` audience: member ids allowed to see it once revealed. */
  recipientPlayerIds?: string[];
}

export interface Checkpoint {
  id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  order?: number;
  /**
   * Single event fired for EVERY distinct arriver (same event each time). Absent →
   * a GM-only arrival ping (today's default). Mutually exclusive with `eventQueue`.
   */
  event?: CheckpointEvent;
  /**
   * Arrival-order queue: the Nth distinct arriver (0-based) gets `eventQueue[N]`. When
   * the queue is exhausted, no player event fires (the GM is still pinged). Used for
   * "different by arrival number" checkpoints (traps). Mutually exclusive with `event`.
   */
  eventQueue?: CheckpointEvent[];
  /**
   * Active window (ROADMAP #12). The checkpoint only fires while live, i.e. while
   * `now ∈ [opensAt ?? -∞, closesAt ?? +∞]`. Both absent → always live (default;
   * legacy checkpoints keep working). Crossings outside the window are ignored (not
   * recorded). Set manually by the GM (open/close now) or by the run-sheet (#11).
   */
  opensAt?: FsTimestamp | null;
  closesAt?: FsTimestamp | null;
  /**
   * Who can see this checkpoint's marker (ROADMAP #48). Absent → `gm-only` (legacy:
   * invisible to players). Independent of the `event`/`eventQueue` payload above.
   */
  visibility?: CheckpointVisibility;
  /** For `visibility: 'on-reveal'`: how/when/to-whom it becomes visible. */
  reveal?: CheckpointReveal;
  /** Latched when the reveal fires (set by the run-sheet / geofence / GM "reveal now"). */
  revealedAt?: FsTimestamp | null;
  /** For `specific-players`/`triggerer` audiences: member ids it's been revealed to so far. */
  revealedTo?: string[];
  /**
   * Initial state before any transition fires (ROADMAP #54). Typically `'closed'` for
   * timed checkpoints. Absent → static checkpoint (existing behavior unchanged).
   */
  initialState?: CheckpointState;
  /**
   * Ordered time-based state transitions applied by the run-sheet sweep (ROADMAP #54).
   * Absent or empty → static checkpoint. Each `atMinute` is relative to `game.startedAt`.
   */
  transitions?: CheckpointTransition[];
  /**
   * Currently-applied state, written by the run-sheet sweep on each transition (ROADMAP #54).
   * Never set by clients. Read by the geofence for player re-notification (#55).
   */
  currentState?: CheckpointState;
  /** Icon key for map authoring (ROADMAP #53). Rendered via Ionicons. */
  icon?: string;
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

/** Run-sheet action types (ROADMAP #11) — the in-app replacement for the paper schedule. */
export type ScheduledActionType =
  | 'broadcast' // write a Broadcast (free text, or templated player-count)
  | 'open-site' // set a checkpoint's window live (#12)
  | 'close-site' // close a checkpoint's window (#12)
  | 'reveal-checkpoint' // make a checkpoint marker visible to players (#48 game-time reveal)
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
