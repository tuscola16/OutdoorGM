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

/** Rectangular play-area boundary, defined by the GM from a map view. */
export interface MapBoundary {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
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
  /** GM-tunable parameters; absent on legacy games (resolve with BASE_GAME_CONFIG). */
  config?: Partial<GameConfig>;
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
  /** Length of each eat window in minutes. Rule 6/7 → 30. */
  rationIntervalMinutes: number;
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
}

/** Seed defaults for a new game = the base game rules. */
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

export type CheckpointEventType =
  | 'arrival-alert' // current behavior: notify GM only
  | 'beast-attack' // push a hazard prompt to the crossing player
  | 'gear-drop' // sponsor/gear drop reveal (Rules 31, 32)
  | 'announcement' // GM-authored message
  | 'silent-alert'; // GM sees it; player gets nothing

export type EventAudience = 'crossing-player' | 'all-players' | 'gm-only';

/** What firing a checkpoint geofence does. */
export interface CheckpointEvent {
  type: CheckpointEventType;
  /** Body shown in the push/broadcast, e.g. "A beast attacks! Defend or flee." */
  message?: string;
  audience: EventAudience;
  /** Fire only the first time (anyone, or this player) enters. Default true. */
  once?: boolean;
  /** Gear-drop only: the player this drop is marked for (Rule 32). */
  recipientPlayerId?: string;
}

export interface Checkpoint {
  id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  order?: number;
  /** What entering this geofence does. Absent → behaves as 'arrival-alert'. */
  event?: CheckpointEvent;
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
  /** This member hid the game from their own "My Games" list (finished games only). */
  archived?: boolean;
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

export interface Broadcast {
  id: string;
  kind: BroadcastKind;
  message: string;
  /** Omitted = all players. Set = targeted to one player (Rule 32 drops). */
  targetPlayerId?: string;
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
