import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendPushToTokens } from './notifications';

// Post-game media notification (ROADMAP #45). When a GM attaches a YouTube recap and/or a
// Google Photos album to a finished game (game-doc `media` field), this trigger tells
// everyone the recap is up — except the GM who set it (`media.updatedBy`). It writes a
// player-visible `gm-message` broadcast (so it shows in the in-app feed) stamped
// `pushed: true` so onBroadcastCreate (#69) doesn't double-push, then pushes every member
// token except the setter's.

type MediaDoc = { youtubeUrl?: string; photosAlbumUrl?: string; updatedBy?: string } | undefined;

/** Did the media links meaningfully change (one was added or swapped)? */
function mediaChanged(before: MediaDoc, after: MediaDoc): boolean {
  if (!after) return false;
  const b = before ?? {};
  return (after.youtubeUrl ?? '') !== (b.youtubeUrl ?? '')
    || (after.photosAlbumUrl ?? '') !== (b.photosAlbumUrl ?? '');
}

export const onGameMediaWrite = functions.firestore
  .document('games/{gameId}')
  .onUpdate(async (change, context) => {
    const { gameId } = context.params as { gameId: string };
    const before = change.before.data()?.media as MediaDoc;
    const after = change.after.data()?.media as MediaDoc;
    if (!mediaChanged(before, after) || !after) return;

    const hasVideo = !!after.youtubeUrl;
    const hasAlbum = !!after.photosAlbumUrl;
    if (!hasVideo && !hasAlbum) return; // media cleared — nothing to announce

    const message =
      hasVideo && hasAlbum
        ? '🎬 The recap video and photo album are up — see the results screen!'
        : hasVideo
          ? '🎬 The game recap video is up — see the results screen!'
          : '📸 The game photo album is up — see the results screen!';

    const db = admin.firestore();
    const setterId = after.updatedBy ?? '';

    // Player-visible broadcast; pushed:true so onBroadcastCreate skips it (#69).
    await db.collection('games').doc(gameId).collection('broadcasts').add({
      kind: 'gm-message',
      message,
      targetPlayerId: null,
      pushed: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Push every member (players + co-GMs) except the GM who set the media.
    const membersSnap = await db.collection('games').doc(gameId).collection('members').get();
    const tokens = membersSnap.docs
      .filter((d) => d.id !== setterId)
      .map((d) => d.data().fcmToken as string | undefined)
      .filter((t): t is string => !!t);

    await sendPushToTokens(tokens, '🎬 Recap is up', message, 'broadcasts');
  });
