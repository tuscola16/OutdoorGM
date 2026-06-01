import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  doc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from 'firebase/firestore';
import { db, Collections } from '@/services/firebase';
import { gamePhase } from '@/services/gameService';
import type { Game, Checkpoint, GameMember, PlayerLocation, Arrival, GamePhase } from '@shared/types';

interface GameContextValue {
  game: Game | null;
  phase: GamePhase;
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

  // Game document
  useEffect(() => {
    if (!gameId) return;
    return onSnapshot(
      doc(db, Collections.GAMES, gameId),
      (snap) => {
        if (snap.exists()) setGame({ id: snap.id, ...snap.data() } as Game);
      },
      (err) => console.error('[GameContext] game listener error', err)
    );
  }, [gameId]);

  // Checkpoints
  useEffect(() => {
    if (!gameId) return;
    return onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.CHECKPOINTS),
      (snap) => setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Checkpoint))),
      (err) => console.error('[GameContext] checkpoints listener error', err)
    );
  }, [gameId]);

  // Members (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.MEMBERS),
      (snap) => setMembers(snap.docs.map((d) => ({ userId: d.id, ...d.data() } as GameMember))),
      (err) => console.error('[GameContext] members listener error', err)
    );
  }, [gameId, myRole]);

  // Player locations (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.LOCATIONS),
      (snap) => setPlayerLocations(snap.docs.map((d) => ({ ...d.data() } as PlayerLocation))),
      (err) => console.error('[GameContext] locations listener error', err)
    );
  }, [gameId, myRole]);

  // Arrivals
  useEffect(() => {
    if (!gameId) return;
    return onSnapshot(
      query(
        collection(db, Collections.GAMES, gameId, Collections.ARRIVALS),
        orderBy('timestamp', 'desc'),
        limit(50)
      ),
      (snap) => setArrivals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arrival))),
      (err) => console.error('[GameContext] arrivals listener error', err)
    );
  }, [gameId]);

  return (
    <GameContext.Provider
      value={{ game, phase: gamePhase(game), myRole, checkpoints, members, playerLocations, arrivals, loadGame, clearGame }}
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
