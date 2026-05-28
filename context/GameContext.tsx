import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import firestore from '@react-native-firebase/firestore';
import { Collections } from '@/services/firebase';
import type { Game, Checkpoint, GameMember, PlayerLocation, Arrival } from '@/types';

interface GameContextValue {
  game: Game | null;
  myRole: 'player' | 'gm' | null;
  checkpoints: Checkpoint[];
  members: GameMember[];
  playerLocations: PlayerLocation[];
  arrivals: Arrival[];
  loadGame: (gameId: string, role: 'player' | 'gm') => void;
  clearGame: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'player' | 'gm' | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [members, setMembers] = useState<GameMember[]>([]);
  const [playerLocations, setPlayerLocations] = useState<PlayerLocation[]>([]);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);

  const loadGame = useCallback((id: string, role: 'player' | 'gm') => {
    setGameId(id);
    setMyRole(role);
  }, []);

  const clearGame = useCallback(() => {
    setGameId(null);
    setMyRole(null);
    setGame(null);
    setCheckpoints([]);
    setMembers([]);
    setPlayerLocations([]);
    setArrivals([]);
  }, []);

  // Subscribe to game document
  useEffect(() => {
    if (!gameId) return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .onSnapshot((snap) => {
        if (snap.exists) setGame({ id: snap.id, ...snap.data() } as Game);
      });
  }, [gameId]);

  // Subscribe to checkpoints
  useEffect(() => {
    if (!gameId) return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.CHECKPOINTS)
      .onSnapshot((snap) => {
        setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Checkpoint)));
      });
  }, [gameId]);

  // Subscribe to members
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .onSnapshot((snap) => {
        setMembers(snap.docs.map((d) => ({ userId: d.id, ...d.data() } as GameMember)));
      });
  }, [gameId, myRole]);

  // Subscribe to player locations (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.LOCATIONS)
      .onSnapshot((snap) => {
        setPlayerLocations(snap.docs.map((d) => ({ ...d.data() } as PlayerLocation)));
      });
  }, [gameId, myRole]);

  // Subscribe to arrivals
  useEffect(() => {
    if (!gameId) return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.ARRIVALS)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .onSnapshot((snap) => {
        setArrivals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arrival)));
      });
  }, [gameId]);

  return (
    <GameContext.Provider
      value={{ game, myRole, checkpoints, members, playerLocations, arrivals, loadGame, clearGame }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
