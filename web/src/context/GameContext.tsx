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
import type { Game, Checkpoint, RunbookEntry, GameMember, PlayerLocation, Arrival, GamePhase, RationSubmission, ScheduledEvent, EntryTrip } from '@shared/types';

interface GameContextValue {
  game: Game | null;
  phase: GamePhase;
  myRole: 'player' | 'gm' | null;
  checkpoints: Checkpoint[];
  /** Runbook entries (GM only, #60) — the behavior attached to checkpoints. */
  runbookEntries: RunbookEntry[];
  members: GameMember[];
  playerLocations: PlayerLocation[];
  arrivals: Arrival[];
  /** Ration submissions awaiting/holding GM review (GM only). */
  rations: RationSubmission[];
  /** Run-sheet timed actions (GM only, #11). */
  scheduledEvents: ScheduledEvent[];
  /** Runbook entries that have actually fired, per player (GM only, #67/#73). */
  entryTrips: EntryTrip[];
  loadGame: (gameId: string, role: 'player' | 'gm') => void;
  clearGame: () => void;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [gameId, setGameId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'player' | 'gm' | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [runbookEntries, setRunbookEntries] = useState<RunbookEntry[]>([]);
  const [members, setMembers] = useState<GameMember[]>([]);
  const [playerLocations, setPlayerLocations] = useState<PlayerLocation[]>([]);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [rations, setRations] = useState<RationSubmission[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<ScheduledEvent[]>([]);
  const [entryTrips, setEntryTrips] = useState<EntryTrip[]>([]);

  const loadGame = useCallback((id: string, role: 'player' | 'gm') => {
    setGameId(id);
    setMyRole(role);
  }, []);

  // Only null the keys here — each subscription effect below clears its own slice of
  // state in its cleanup, which runs exactly when the listener is torn down (gameId →
  // null, or a real game switch). Wiping the data arrays here too would clobber a
  // same-game re-mount: navigating between two screens of the same game (e.g. Game ↔
  // Runbook) batches clearGame()+loadGame() so `gameId` ends unchanged, the listeners
  // never re-fire, and the just-cleared data would never be repopulated.
  const clearGame = useCallback(() => {
    setGameId(null);
    setMyRole(null);
  }, []);

  // Game document
  useEffect(() => {
    if (!gameId) return;
    const unsub = onSnapshot(
      doc(db, Collections.GAMES, gameId),
      (snap) => {
        if (snap.exists()) setGame({ id: snap.id, ...snap.data() } as Game);
      },
      (err) => console.error('[GameContext] game listener error', err)
    );
    return () => { unsub(); setGame(null); };
  }, [gameId]);

  // Checkpoints
  useEffect(() => {
    if (!gameId) return;
    const unsub = onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.CHECKPOINTS),
      (snap) => setCheckpoints(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Checkpoint))),
      (err) => console.error('[GameContext] checkpoints listener error', err)
    );
    return () => { unsub(); setCheckpoints([]); };
  }, [gameId]);

  // Runbook entries (GMs only, #60)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.RUNBOOK),
      (snap) => setRunbookEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RunbookEntry))),
      (err) => console.error('[GameContext] runbook listener error', err)
    );
    return () => { unsub(); setRunbookEntries([]); };
  }, [gameId, myRole]);

  // Members (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.MEMBERS),
      (snap) => setMembers(snap.docs.map((d) => ({ userId: d.id, ...d.data() } as GameMember))),
      (err) => console.error('[GameContext] members listener error', err)
    );
    return () => { unsub(); setMembers([]); };
  }, [gameId, myRole]);

  // Player locations (GMs only)
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      collection(db, Collections.GAMES, gameId, Collections.LOCATIONS),
      (snap) => setPlayerLocations(snap.docs.map((d) => ({ ...d.data() } as PlayerLocation))),
      (err) => console.error('[GameContext] locations listener error', err)
    );
    return () => { unsub(); setPlayerLocations([]); };
  }, [gameId, myRole]);

  // Arrivals
  useEffect(() => {
    if (!gameId) return;
    const unsub = onSnapshot(
      query(
        collection(db, Collections.GAMES, gameId, Collections.ARRIVALS),
        orderBy('timestamp', 'desc'),
        limit(50)
      ),
      (snap) => setArrivals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Arrival))),
      (err) => console.error('[GameContext] arrivals listener error', err)
    );
    return () => { unsub(); setArrivals([]); };
  }, [gameId]);

  // Rations (GMs only) — the review feed.
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      query(
        collection(db, Collections.GAMES, gameId, Collections.RATIONS),
        orderBy('submittedAt', 'desc'),
        limit(200)
      ),
      (snap) => setRations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as RationSubmission))),
      (err) => console.error('[GameContext] rations listener error', err)
    );
    return () => { unsub(); setRations([]); };
  }, [gameId, myRole]);

  // Run-sheet (GM only, #11).
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      query(
        collection(db, Collections.GAMES, gameId, Collections.SCHEDULED_EVENTS),
        orderBy('createdAt', 'asc')
      ),
      (snap) => setScheduledEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduledEvent))),
      (err) => console.error('[GameContext] scheduledEvents listener error', err)
    );
    return () => { unsub(); setScheduledEvents([]); };
  }, [gameId, myRole]);

  // Entry trips (GM only, #67/#73) — the authoritative log of runbook entries that fired.
  useEffect(() => {
    if (!gameId || myRole !== 'gm') return;
    const unsub = onSnapshot(
      query(
        collection(db, Collections.GAMES, gameId, Collections.ENTRY_TRIPS),
        orderBy('trippedAt', 'desc'),
        limit(100)
      ),
      (snap) => setEntryTrips(snap.docs.map((d) => ({ id: d.id, ...d.data() } as EntryTrip))),
      (err) => console.error('[GameContext] entryTrips listener error', err)
    );
    return () => { unsub(); setEntryTrips([]); };
  }, [gameId, myRole]);

  return (
    <GameContext.Provider
      value={{ game, phase: gamePhase(game), myRole, checkpoints, runbookEntries, members, playerLocations, arrivals, rations, scheduledEvents, entryTrips, loadGame, clearGame }}
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
