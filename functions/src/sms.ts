import * as functions from 'firebase-functions';

export async function sendArrivalSMS(phones: string[], message: string): Promise<void> {
  if (phones.length === 0) return;

  // Twilio credentials are stored in Firebase Functions config:
  // firebase functions:config:set twilio.sid="ACXXXX" twilio.token="XXXX" twilio.from="+1XXXXXXXXXX"
  const config = functions.config();
  const sid: string | undefined = config.twilio?.sid;
  const token: string | undefined = config.twilio?.token;
  const from: string | undefined = config.twilio?.from;

  if (!sid || !token || !from) {
    console.warn('Twilio config missing — skipping SMS. Set twilio.sid, twilio.token, twilio.from via firebase functions:config:set');
    return;
  }

  // Lazy-require Twilio so it's only loaded when needed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twilio = require('twilio');
  const client = twilio(sid, token);

  await Promise.allSettled(
    phones.map((to) =>
      client.messages.create({
        body: `[HungerGamesLocator] ${message}`,
        from,
        to,
      }).catch((err: Error) => console.error(`SMS to ${to} failed:`, err.message))
    )
  );
}
