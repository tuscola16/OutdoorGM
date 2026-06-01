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
  createdAt: FsTimestamp;
}

export interface Checkpoint {
  id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  radius: number; // meters
  order?: number;
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
  /** This member hid the game from their own "My Games" list (finished games only). */
  archived?: boolean;
  joinedAt: FsTimestamp;
}

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

export interface ActiveGame {
  gameId: string;
  role: UserRole;
  displayName: string;
}
