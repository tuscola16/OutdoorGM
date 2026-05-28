import { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

export type UserRole = 'player' | 'gm';
export type GameStatus = 'active' | 'ended';

export interface UserProfile {
  id: string;
  phoneNumber: string;
  displayName: string;
  fcmToken?: string;
  createdAt: FirebaseFirestoreTypes.Timestamp;
}

export interface Game {
  id: string;
  name: string;
  playerCode: string;
  gmCode: string;
  creatorId: string;
  status: GameStatus;
  createdAt: FirebaseFirestoreTypes.Timestamp;
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
  phoneNumber: string;
  fcmToken?: string;
  joinedAt: FirebaseFirestoreTypes.Timestamp;
}

export interface PlayerLocation {
  userId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  updatedAt: FirebaseFirestoreTypes.Timestamp;
}

export interface Arrival {
  id: string;
  playerId: string;
  playerName: string;
  checkpointId: string;
  checkpointName: string;
  timestamp: FirebaseFirestoreTypes.Timestamp;
  latitude: number;
  longitude: number;
}

export interface ActiveGame {
  gameId: string;
  role: UserRole;
  displayName: string;
}
