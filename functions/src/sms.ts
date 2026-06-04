/**
 * Twilio credentials live in Cloud Functions **secrets** (not the deprecated
 * `functions.config()`, which is being removed). Set them once with:
 *   firebase functions:secrets:set TWILIO_SID
 *   firebase functions:secrets:set TWILIO_TOKEN
 *   firebase functions:secrets:set TWILIO_FROM
 * and bind them on every function that sends SMS via `.runWith({ secrets: TWILIO_SECRETS })`
 * (see geofence.ts / members.ts) so the values are injected into `process.env` at runtime.
 * SMS stays optional: if any secret is unset, `sendArrivalSMS` no-ops (push still works).
 */
export const TWILIO_SECRETS = ['TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM'];

export async function sendArrivalSMS(phones: string[], message: string): Promise<void> {
  if (phones.length === 0) return;

  const sid = process.env.TWILIO_SID;
  const token = process.env.TWILIO_TOKEN;
  const from = process.env.TWILIO_FROM;

  if (!sid || !token || !from) {
    console.warn('Twilio secrets missing — skipping SMS. Set TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM via firebase functions:secrets:set and bind TWILIO_SECRETS on the function.');
    return;
  }

  // Lazy-require Twilio so it's only loaded when needed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twilio = require('twilio');
  const client = twilio(sid, token);

  await Promise.allSettled(
    phones.map((to) =>
      client.messages.create({
        body: `[Outdoor GM] ${message}`,
        from,
        to,
      }).catch((err: Error) => console.error(`SMS to ${to} failed:`, err.message))
    )
  );
}
