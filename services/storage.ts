import storage from '@react-native-firebase/storage';

/**
 * Upload a ration-card photo to Firebase Storage and return its download URL
 * (Rules 6–9). The path is deterministic per player + eat window
 * (games/{gameId}/rations/{playerId}/{intervalIndex}.jpg) so re-submitting within
 * the same window overwrites the previous file rather than piling up orphans.
 *
 * Storage access is governed by storage.rules: a player may write only their own
 * path while an active member; GMs and the owning player may read it.
 */
export async function uploadRationPhoto(
  gameId: string,
  playerId: string,
  intervalIndex: number,
  localUri: string
): Promise<string> {
  const ref = storage().ref(`games/${gameId}/rations/${playerId}/${intervalIndex}.jpg`);
  // Set contentType explicitly: putFile doesn't always infer it from the camera's
  // cache file, and an unset contentType trips the Storage rules' image check.
  await ref.putFile(localUri, { contentType: 'image/jpeg' });
  return ref.getDownloadURL();
}
