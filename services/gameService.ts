import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import { Collections } from './firebase';
import type { Game, Checkpoint, GameMember } from '@/types';

function generateCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export async function createGame(name: string, creatorId: string): Promise<Game> {
  const playerCode = generateCode(6);
  const gmCode = generateCode(6);

  const gameRef = firestore().collection(Collections.GAMES).doc();
  const game: Omit<Game, 'id'> = {
    name: name.trim(),
    playerCode,
    gmCode,
    creatorId,
    status: 'active',
    createdAt: firestore.FieldValue.serverTimestamp() as any,
  };
  await gameRef.set(game);
  return { id: gameRef.id, ...game } as Game;
}

export async function findGameByCode(code: string): Promise<{ game: Game; role: 'player' | 'gm' } | null> {
  const upperCode = code.trim().toUpperCase();

  // Check player code
  const playerSnap = await firestore()
    .collection(Collections.GAMES)
    .where('playerCode', '==', upperCode)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (!playerSnap.empty) {
    const doc = playerSnap.docs[0];
    return { game: { id: doc.id, ...doc.data() } as Game, role: 'player' };
  }

  // Check GM code
  const gmSnap = await firestore()
    .collection(Collections.GAMES)
    .where('gmCode', '==', upperCode)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (!gmSnap.empty) {
    const doc = gmSnap.docs[0];
    return { game: { id: doc.id, ...doc.data() } as Game, role: 'gm' };
  }

  return null;
}

export async function joinGame(
  gameId: string,
  userId: string,
  role: 'player' | 'gm',
  displayName: string,
  phoneNumber: string,
  fcmToken?: string
): Promise<void> {
  const memberData: Omit<GameMember, 'userId'> = {
    role,
    displayName,
    phoneNumber,
    fcmToken,
    joinedAt: firestore.FieldValue.serverTimestamp() as any,
  };
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .set(memberData);
}

export async function updateFcmToken(gameId: string, userId: string, fcmToken: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ fcmToken });
}

export async function getMyGames(userId: string): Promise<{ game: Game; role: 'player' | 'gm' }[]> {
  // Query all games where the user is a member across the subcollection
  // Firestore doesn't support cross-collection-group queries with doc ID matching,
  // so we use collectionGroup query
  const snap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where(firestore.FieldPath.documentId(), '==', userId)
    .get();

  const results: { game: Game; role: 'player' | 'gm' }[] = [];
  for (const memberDoc of snap.docs) {
    // Parent path: games/{gameId}/members/{userId}
    const gameId = memberDoc.ref.parent.parent?.id;
    if (!gameId) continue;
    const gameSnap = await firestore().collection(Collections.GAMES).doc(gameId).get();
    if (gameSnap.exists) {
      results.push({
        game: { id: gameSnap.id, ...gameSnap.data() } as Game,
        role: memberDoc.data().role as 'player' | 'gm',
      });
    }
  }
  return results;
}

export async function endGame(gameId: string): Promise<void> {
  await firestore().collection(Collections.GAMES).doc(gameId).update({ status: 'ended' });
}

// Checkpoints
export async function addCheckpoint(
  gameId: string,
  checkpoint: Omit<Checkpoint, 'id'>
): Promise<Checkpoint> {
  const ref = firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc();
  await ref.set(checkpoint);
  return { id: ref.id, ...checkpoint };
}

export async function updateCheckpoint(
  gameId: string,
  checkpointId: string,
  updates: Partial<Omit<Checkpoint, 'id'>>
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc(checkpointId)
    .update(updates);
}

export async function deleteCheckpoint(gameId: string, checkpointId: string): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.CHECKPOINTS)
    .doc(checkpointId)
    .delete();
}

export async function deleteAccount(userId: string): Promise<void> {
  // Remove user from all game member + location subcollections
  const memberSnap = await firestore()
    .collectionGroup(Collections.MEMBERS)
    .where(firestore.FieldPath.documentId(), '==', userId)
    .get();

  const batch = firestore().batch();
  for (const memberDoc of memberSnap.docs) {
    const gameId = memberDoc.ref.parent.parent?.id;
    batch.delete(memberDoc.ref);
    if (gameId) {
      batch.delete(
        firestore()
          .collection(Collections.GAMES)
          .doc(gameId)
          .collection(Collections.LOCATIONS)
          .doc(userId)
      );
    }
  }
  batch.delete(firestore().collection(Collections.USERS).doc(userId));
  await batch.commit();

  // Delete the Firebase Auth account last — once deleted we lose write access
  await auth().currentUser?.delete();
}

export async function updateMemberRole(
  gameId: string,
  userId: string,
  role: 'player' | 'gm'
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.MEMBERS)
    .doc(userId)
    .update({ role });
}

export async function removePlayer(gameId: string, userId: string): Promise<void> {
  const batch = firestore().batch();
  batch.delete(
    firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.MEMBERS)
      .doc(userId)
  );
  batch.delete(
    firestore()
      .collection(Collections.GAMES)
      .doc(gameId)
      .collection(Collections.LOCATIONS)
      .doc(userId)
  );
  await batch.commit();
}

export async function updatePlayerLocation(
  gameId: string,
  userId: string,
  displayName: string,
  coords: { latitude: number; longitude: number; accuracy?: number; heading?: number }
): Promise<void> {
  await firestore()
    .collection(Collections.GAMES)
    .doc(gameId)
    .collection(Collections.LOCATIONS)
    .doc(userId)
    .set({
      userId,
      displayName,
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? null,
      heading: coords.heading ?? null,
      updatedAt: firestore.FieldValue.serverTimestamp(),
    });
}
