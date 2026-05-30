import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendArrivalPushNotifications } from './notifications';
import { sendArrivalSMS } from './sms';

/** Haversine formula — returns distance in meters between two coordinates. */
function distanceMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const onLocationUpdate = functions.firestore
  .document('games/{gameId}/locations/{userId}')
  .onWrite(async (change, context) => {
    // Only process on create or update (not delete)
    if (!change.after.exists) return;

    const { gameId, userId } = context.params;
    const location = change.after.data() as {
      latitude: number;
      longitude: number;
      displayName: string;
    };

    // Skip if the player is a GM (GMs don't trigger checkpoint arrivals)
    const memberSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('members')
      .doc(userId)
      .get();

    if (!memberSnap.exists || memberSnap.data()?.role === 'gm') return;

    // Fetch all checkpoints for this game
    const checkpointsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('checkpoints')
      .get();

    if (checkpointsSnap.empty) return;

    // Fetch existing arrivals for this player (to avoid duplicate notifications)
    const existingArrivalsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('arrivals')
      .where('playerId', '==', userId)
      .get();

    const arrivedCheckpointIds = new Set(
      existingArrivalsSnap.docs.map((d) => d.data().checkpointId as string)
    );

    const db = admin.firestore();
    const batch = db.batch();
    const newArrivals: Array<{ checkpointName: string; playerName: string }> = [];

    for (const cpDoc of checkpointsSnap.docs) {
      const cp = cpDoc.data() as {
        latitude: number;
        longitude: number;
        radius: number;
        name: string;
      };
      const checkpointId = cpDoc.id;

      if (arrivedCheckpointIds.has(checkpointId)) continue;

      const dist = distanceMeters(
        location.latitude,
        location.longitude,
        cp.latitude,
        cp.longitude
      );

      if (dist <= cp.radius) {
        const arrivalRef = db
          .collection('games')
          .doc(gameId)
          .collection('arrivals')
          .doc();

        batch.set(arrivalRef, {
          playerId: userId,
          playerName: location.displayName,
          checkpointId,
          checkpointName: cp.name,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          latitude: location.latitude,
          longitude: location.longitude,
        });

        newArrivals.push({ checkpointName: cp.name, playerName: location.displayName });
        // Prevent duplicate arrivals within the same batch
        arrivedCheckpointIds.add(checkpointId);
      }
    }

    if (newArrivals.length === 0) return;

    await batch.commit();

    // Fetch all GMs to notify
    const gmsSnap = await admin.firestore()
      .collection('games')
      .doc(gameId)
      .collection('members')
      .where('role', '==', 'gm')
      .get();

    const gmTokens: string[] = [];
    const gmPhones: string[] = [];

    for (const gmDoc of gmsSnap.docs) {
      const gm = gmDoc.data();
      if (gm.fcmToken) gmTokens.push(gm.fcmToken as string);
      if (gm.phone) gmPhones.push(gm.phone as string);
    }

    // Fire notifications for each new arrival
    await Promise.all(
      newArrivals.map(async ({ playerName, checkpointName }) => {
        const title = `📍 Arrival Alert`;
        const body = `${playerName} reached ${checkpointName}`;
        await Promise.allSettled([
          sendArrivalPushNotifications(gmTokens, title, body),
          sendArrivalSMS(gmPhones, body),
        ]);
      })
    );
  });
