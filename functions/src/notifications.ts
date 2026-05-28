import * as admin from 'firebase-admin';

export async function sendArrivalPushNotifications(
  tokens: string[],
  title: string,
  body: string
): Promise<void> {
  if (tokens.length === 0) return;

  const message: admin.messaging.MulticastMessage = {
    notification: { title, body },
    android: {
      notification: {
        sound: 'default',
        priority: 'high',
        channelId: 'arrivals',
      },
      priority: 'high',
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          contentAvailable: true,
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
