import * as admin from 'firebase-admin';

/** Send a high-priority push to a set of FCM tokens. Logs (does not throw) on
 * failure so callers can fire-and-forget. `channelId` selects the Android channel. */
export async function sendPushToTokens(
  tokens: string[],
  title: string,
  body: string,
  channelId = 'arrivals'
): Promise<void> {
  if (tokens.length === 0) return;

  const message: admin.messaging.MulticastMessage = {
    notification: { title, body },
    android: {
      // `priority: high` wakes a Dozing/backgrounded device to deliver now rather
      // than batching to the next maintenance window — checkpoint/GM alerts are
      // time-critical. TTL caps how stale a queued alert may get (1h) so a brief
      // dead zone doesn't drop it, but an hours-late alert is never shown.
      priority: 'high',
      ttl: 60 * 60 * 1000,
      notification: {
        sound: 'default',
        channelId,
        // Heads-up banner + full content on the lock screen (pre-O devices read
        // `priority`; O+ devices read the channel importance, set MAX in _layout).
        priority: 'max',
        visibility: 'public',
        defaultVibrateTimings: true,
      },
    },
    apns: {
      headers: {
        // priority 10 = deliver immediately (not throttled like a background push);
        // push-type `alert` so iOS shows it on the lock screen without opening the app.
        'apns-priority': '10',
        'apns-push-type': 'alert',
      },
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
    tokens,
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    if (response.failureCount > 0) {
      const failed = response.responses
        .map((r, i) => (r.success ? null : tokens[i]))
        .filter(Boolean);
      console.warn('Failed FCM tokens:', failed);
    }
  } catch (err) {
    console.error('FCM send error:', err);
  }
}

/** Back-compat wrapper used by the geofence arrival path. */
export async function sendArrivalPushNotifications(
  tokens: string[],
  title: string,
  body: string
): Promise<void> {
  await sendPushToTokens(tokens, title, body, 'arrivals');
}
