import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections } from '@/services/firebase';
import { gamePhase } from '@/services/gameService';
import type {
  Game,
  Checkpoint,
  GameMember,
  PlayerLocation,
  Arrival,
  GamePhase,
  Broadcast,
  RationSubmission,
  ScheduledEvent,
} from '@/types';

interface GameContextValue {
  game: Game | null;
  phase: GamePhase;
  myRole: 'player' | 'gm' | null;
  checkpoints: Checkpoint[];
  members: GameMember[];
  playerLocations: PlayerLocation[];
  arrivals: Arrival[];
  /** GM→player messages. Players see only global + their own targeted messages. */
  broadcasts: Broadcast[];
  /** Ration submissions awaiting/holding GM review (GM only). */
  rations: RationSubmission[];
  /** Run-sheet timed actions (GM only, #11). */
  scheduledEvents: ScheduledEvent[];
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
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [rations, setRations] = useState<RationSubmission[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<ScheduledEvent[]>([]);

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
    setBroadcasts([]);
    setRations([]);
    setScheduledEvents([]);
  }, []);

  // Subscribe to game document
  useEffect(() => {
    if (!gameId) return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .onSnapshot(
        (snap) => {
          if (snap.exists) setGame({ id: snap.id, ...snap.data() } as Game);
        },
        (err) => console.error('[GameContext] game listener error', err)
      );
  }, [gameId]);

  // Subscribe to checkpoints
  useEffect(() => {
    if (!gameId) return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.CHECKPOINTS)
      .onSnapshot(
        (snap) => {
          setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Checkpoint)));
        },
        (err) => console.error('[GameContext] checkpoints listener error', err)
      );
  }, [gameId]);

  // Subscribe to members
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .onSnapshot(
        (snap) => {
          setMembers(snap.docs.map((d) => ({ userId: d.id, ...d.data() } as GameMember)));
        },
        (err) => console.error('[GameContext] members listener error', err)
      );
  }, [gameId, myRole]);

  // Subscribe to player locations (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.LOCATIONS)
      .onSnapshot(
        (snap) => {
          setPlayerLocations(snap.docs.map((d) => ({ ...d.data() } as PlayerLocation)));
        },
        (err) => console.error('[GameContext] locations listener error', err)
      );
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
      .onSnapshot(
        (snap) => {
          setArrivals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arrival)));
        },
        (err) => console.error('[GameContext] arrivals listener error', err)
      );
  }, [gameId]);

  // Subscribe to broadcasts. GMs see every message; players see global messages
  // (targetPlayerId == null) plus ones targeted at them. Firestore can't OR those
  // in one query, so players run two listeners and merge.
  useEffect(() => {
    if (!gameId) return;
    const col = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.BROADCASTS);

    if (myRole === 'gm') {
      return col
        .orderBy('createdAt', 'desc')
        .limit(100)
        .onSnapshot(
          (snap) => setBroadcasts(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Broadcast))),
          (err) => console.error('[GameContext] broadcasts listener error', err)
        );
    }

    const uid = auth().currentUser?.uid;
    const merged = new Map<string, Broadcast>();
    const emit = () =>
      setBroadcasts(
        [...merged.values()].sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        )
      );
    const handle = (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      snap.docChanges().forEach((c) => {
        if (c.type === 'removed') merged.delete(c.doc.id);
        else merged.set(c.doc.id, { id: c.doc.id, ...c.doc.data() } as Broadcast);
      });
      emit();
    };
    const unsubGlobal = col
      .where('targetPlayerId', '==', null)
      .onSnapshot(handle, (err) => console.error('[GameContext] global broadcasts error', err));
    const unsubMine = uid
      ? col
          .where('targetPlayerId', '==', uid)
          .onSnapshot(handle, (err) => console.error('[GameContext] my broadcasts error', err))
      : () => {};
    return () => {
      unsubGlobal();
      unsubMine();
    };
  }, [gameId, myRole]);

  // Subscribe to ration submissions (GM review feed only).
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.RATIONS)
      .orderBy('submittedAt', 'desc')
      .limit(200)
      .onSnapshot(
        (snap) => setRations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RationSubmission))),
        (err) => console.error('[GameContext] rations listener error', err)
      );
  }, [gameId, myRole]);

  // Subscribe to the run-sheet (GM only, #11).
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    return firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.SCHEDULED_EVENTS)
      .orderBy('createdAt', 'asc')
      .onSnapshot(
        (snap) => setScheduledEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduledEvent))),
        (err) => console.error('[GameContext] scheduledEvents listener error', err)
      );
  }, [gameId, myRole]);

  return (
    <GameContext.Provider
      value={{ game, phase: gamePhase(game), myRole, checkpoints, members, playerLocations, arrivals, broadcasts, rations, scheduledEvents, loadGame, clearGame }}
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
