import AsyncStorage from '@react-native-async-storage/async-storage';
import { submitRation } from './gameService';
import { uploadRationPhoto } from './storage';

/**
 * Durable retry queue for ration submissions (#4, offline / poor-signal resilience).
 *
 * Firestore writes ride the SDK's offline persistence, but the ration *photo* upload
 * goes to Firebase Storage, whose `putFile` is NOT queued offline — it just fails. In a
 * dead zone that would cost the player a ration (= wrongful starvation). So when a live
 * submit fails, the capture is persisted here (local photo URI + metadata) and retried
 * on reconnect / app-foreground until it lands. The submission doc id is deterministic
 * (`${userId}_${intervalIndex}`), so a flush is idempotent — re-running can't duplicate.
 *
 * Caveat: the queued photo is the camera's local cache file. It survives app restarts in
 * practice but the OS may eventually evict cache; this targets short offline windows, not
 * indefinite storage.
 */

const QUEUE_KEY = 'hgl_ration_queue';

export interface PendingRation {
  gameId: string;
  userId: string;
  displayName: string;
  intervalIndex: number;
  /** Local file URI of the captured photo, still to be uploaded. */
  localUri: string;
  cardNumber?: string;
  queuedAt: number;
}

/** Stable identity of a queued item — one per (game, player, interval) window. */
const keyOf = (p: PendingRation) => `${p.gameId}|${p.userId}|${p.intervalIndex}`;

/**
 * Is this a *permanent* submission failure (a server rejection) rather than a transient
 * offline/network one? The `submitRation` callable (#68) throws these for a duplicate card
 * number, a non-member, or a game not in play — retrying can never succeed, so the queue
 * must drop them instead of looping forever, and the live UI must surface them rather than
 * silently queueing. Transient errors (offline, Storage unreachable) are NOT in this set, so
 * they stay queued for the next flush.
 */
export function isPermanentRationError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? '').toLowerCase();
  return ['already-exists', 'permission-denied', 'failed-precondition', 'invalid-argument', 'unauthenticated']
    .some((c) => code.includes(c));
}

async function readQueue(): Promise<PendingRation[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingRation[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: PendingRation[]): Promise<void> {
  if (items.length === 0) {
    await AsyncStorage.removeItem(QUEUE_KEY);
    return;
  }
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

/** Persist a ration capture that couldn't be submitted live. A newer capture for the
 * same window replaces the older queued one. */
export async function enqueueRation(item: PendingRation): Promise<void> {
  const q = await readQueue();
  const filtered = q.filter((p) => keyOf(p) !== keyOf(item));
  filtered.push(item);
  await writeQueue(filtered);
}

export async function pendingRationCount(): Promise<number> {
  return (await readQueue()).length;
}

let flushing = false;

/**
 * Try to upload + submit every queued ration. Removes the ones that succeed; keeps the
 * rest (still offline) for the next attempt. One flush at a time; safe to call often
 * (mount, app-foreground). Re-reads the queue before writing back so an item enqueued
 * mid-flush isn't clobbered. Returns the number flushed.
 */
export async function flushRationQueue(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  try {
    const q = await readQueue();
    if (q.length === 0) return 0;
    const succeeded = new Set<string>();
    const dropped = new Set<string>(); // permanently rejected — remove without counting as flushed
    for (const item of q) {
      try {
        const url = await uploadRationPhoto(item.gameId, item.userId, item.intervalIndex, item.localUri);
        await submitRation(
          item.gameId,
          { userId: item.userId, displayName: item.displayName },
          item.intervalIndex,
          url,
          item.cardNumber
        );
        succeeded.add(keyOf(item));
      } catch (err) {
        // #68: a permanent server rejection (e.g. duplicate card) can never succeed on retry —
        // drop it. Transient offline/Storage errors stay queued for the next flush.
        if (isPermanentRationError(err)) dropped.add(keyOf(item));
      }
    }
    // Merge against the current queue so a capture enqueued during the flush survives.
    const current = await readQueue();
    await writeQueue(current.filter((p) => !succeeded.has(keyOf(p)) && !dropped.has(keyOf(p))));
    return succeeded.size;
  } finally {
    flushing = false;
  }
}
