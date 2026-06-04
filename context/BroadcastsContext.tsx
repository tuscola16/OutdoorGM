import React, { createContext, useContext, useEffect, useState } from 'react';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections } from '@/services/firebase';
import type { Broadcast } from '@/types';

/**
 * One shared subscription to a game's player-visible broadcasts (#32). A player sees
 * global messages (`targetPlayerId == null`) plus ones targeted at them; Firestore can't
 * OR those, so we run two listeners and merge — but we do it **once** here instead of
 * inside every `BroadcastFeed`/`AlertOverlay` instance (which previously meant 4–6
 * concurrent listeners on the same collection). Both components now read from this context.
 *
 * `initialized` flips true once the first snapshot from each listener has arrived, so a
 * consumer (the AlertOverlay) can treat the mount-time backlog as "already seen" and only
 * pop genuinely new broadcasts — without owning its own listeners to detect the backlog.
 */
interface BroadcastsContextValue {
  /** Global + own-targeted broadcasts, newest first. */
  broadcasts: Broadcast[];
  /** True once the initial backlog from both listeners has loaded. */
  initialized: boolean;
}

const BroadcastsContext = createContext<BroadcastsContextValue | null>(null);

export function BroadcastsProvider({
  gameId,
  children,
}: {
  gameId: string;
  children: React.ReactNode;
}) {
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setBroadcasts([]);
    setInitialized(false);
    if (!gameId) return;

    const col = firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.BROADCASTS);
    const uid = auth().currentUser?.uid;

    const merged = new Map<string, Broadcast>();
    const emit = () =>
      setBroadcasts(
        [...merged.values()].sort(
          (a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0)
        )
      );

    // Mark initialized only after the first snapshot from each active listener.
    let globalPrimed = false;
    let minePrimed = !uid; // no uid → no "mine" listener, so it's trivially primed
    const maybeInit = () => {
      if (globalPrimed && minePrimed) setInitialized(true);
    };

    const makeHandler = (markPrimed: () => void) => (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      snap.docChanges().forEach((c) => {
        if (c.type === 'removed') merged.delete(c.doc.id);
        else merged.set(c.doc.id, { id: c.doc.id, ...c.doc.data() } as Broadcast);
      });
      emit();
      markPrimed();
      maybeInit();
    };

    const unsubGlobal = col
      .where('targetPlayerId', '==', null)
      .onSnapshot(
        makeHandler(() => { globalPrimed = true; }),
        (err) => console.error('[Broadcasts] global error', err)
      );
    const unsubMine = uid
      ? col
          .where('targetPlayerId', '==', uid)
          .onSnapshot(
            makeHandler(() => { minePrimed = true; }),
            (err) => console.error('[Broadcasts] mine error', err)
          )
      : () => {};

    return () => {
      unsubGlobal();
      unsubMine();
    };
  }, [gameId]);

  return (
    <BroadcastsContext.Provider value={{ broadcasts, initialized }}>
      {children}
    </BroadcastsContext.Provider>
  );
}

export function useBroadcasts(): BroadcastsContextValue {
  const ctx = useContext(BroadcastsContext);
  if (!ctx) throw new Error('useBroadcasts must be used within BroadcastsProvider');
  return ctx;
}
