/**
 * Privacy policy, terms, and support pages. Privacy and support are REQUIRED by App Store
 * Connect and the Play Console; terms backs the "Terms" link on the app's sign-in screen
 * (`constants/index.ts`). For a location-tracking app the privacy page is read during
 * review — so the content below is written to match what the code actually does, not
 * boilerplate:
 *
 *   - background GPS during lobby/play/endgame  (services/locationTask.ts)
 *   - automatic deletion of location + arrival data on game end
 *     (functions/src/cleanup.ts — cleanupRationPhotosOnGameEnd)
 *   - ration photos readable by that game's GMs  (storage.rules)
 *   - in-app account deletion  (app/(app)/profile.tsx, functions deleteAccount path)
 *
 * If any of those behaviours change, this page has to change with them.
 */

const CONTACT = 'support@outdoorgm.app';
const UPDATED = '15 August 2026';
const TERMS_UPDATED = '29 August 2026';

const page: React.CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '48px 24px 96px',
  lineHeight: 1.65,
  color: 'var(--text)',
};

function Shell({
  title,
  updated = UPDATED,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', overflowY: 'auto' }}>
      <div style={page}>
        <a href="/" style={{ color: 'var(--primary)', fontSize: 14, textDecoration: 'none' }}>
          ← Outdoor GM
        </a>
        <h1 style={{ fontSize: 32, fontWeight: 800, margin: '16px 0 6px' }}>{title}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 32px' }}>
          Last updated {updated}
        </p>
        {children}
      </div>
    </div>
  );
}

const h2: React.CSSProperties = { fontSize: 19, fontWeight: 700, margin: '32px 0 8px' };

export function PrivacyScreen() {
  return (
    <Shell title="Privacy Policy">
      <p>
        Outdoor GM is a location-sharing app for running real-world outdoor games. A Game
        Master sees where players are on a live map; players see only themselves. This page
        explains exactly what the app collects, why, who can see it, and how long it is kept.
      </p>

      <h2 style={h2}>Location</h2>
      <p>
        <strong>The app collects precise GPS location, including while it is in the
        background and your screen is locked.</strong> This is the core function: your Game
        Master cannot run the game if players stop reporting the moment a phone goes into a
        pocket.
      </p>
      <p>Location sharing is bounded:</p>
      <ul>
        <li>It starts only when you join a game and the Game Master opens or starts it.</li>
        <li>It runs only while that game is in its lobby, play, or end-game phase.</li>
        <li>
          It stops when you tap out, are eliminated, leave the game, or the Game Master ends
          it.
        </li>
        <li>
          Your location is visible to the Game Masters of that game only. Other players never
          see it.
        </li>
      </ul>
      <p>
        While location is being shared, the app shows a persistent notification, and your
        phone displays its own system location indicator.
      </p>

      <h2 style={h2}>Account information</h2>
      <p>
        Creating an account stores your <strong>email address</strong>. Joining a game stores
        the <strong>display name</strong> you choose for it, which other participants in that
        game can see. A push notification token is stored so the app can alert you to game
        events.
      </p>

      <h2 style={h2}>Photos</h2>
      <p>
        Some games use a ration check, where you photograph a numbered card to show you have
        eaten. These photos are taken with the in-app camera — the app never reads your photo
        library — and are visible to that game's Game Masters and to you. They are deleted
        automatically when the game ends.
      </p>

      <h2 style={h2}>Diagnostics</h2>
      <p>
        The app reports crashes and errors so they can be fixed. Crash reports are not linked
        to your identity and are not used for advertising.
      </p>

      <h2 style={h2}>How long data is kept</h2>
      <ul>
        <li>
          <strong>Location history and checkpoint arrivals are deleted automatically when a
          game ends.</strong> They are not retained after play.
        </li>
        <li>Ration photos are deleted automatically when a game ends.</li>
        <li>
          Your account, display name, and the games you took part in remain until you delete
          your account.
        </li>
      </ul>

      <h2 style={h2}>Deleting your data</h2>
      <p>
        You can delete your account from <strong>Profile → Delete account</strong> in the app.
        This removes your profile and your membership in every game. You can also leave any
        individual game at any time, which stops location sharing immediately.
      </p>

      <h2 style={h2}>What we do not do</h2>
      <ul>
        <li>We do not sell your data.</li>
        <li>We do not use it for advertising.</li>
        <li>We do not track you across other apps or websites.</li>
        <li>We do not share it with third parties beyond the infrastructure below.</li>
      </ul>

      <h2 style={h2}>Infrastructure</h2>
      <p>
        The app runs on Google Firebase (authentication, database, storage, push
        notifications, crash reporting), which processes and stores this data on our behalf.
        Maps are rendered using Google Maps on Android and Apple Maps on iOS.
      </p>

      <h2 style={h2}>Children</h2>
      <p>
        Outdoor GM is not directed at children under 13, and we do not knowingly collect data
        from them. Younger players should take part under a parent or guardian's account and
        supervision.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions, or a request to delete data: <a href={`mailto:${CONTACT}`} style={{ color: 'var(--primary)' }}>{CONTACT}</a>
      </p>
    </Shell>
  );
}

export function SupportScreen() {
  return (
    <Shell title="Support">
      <p>
        Need help with Outdoor GM, or want to report a problem? Email{' '}
        <a href={`mailto:${CONTACT}`} style={{ color: 'var(--primary)' }}>{CONTACT}</a> and
        include your device model and what you were doing when it happened.
      </p>

      <h2 style={h2}>Common questions</h2>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 4px' }}>
        My Game Master can't see me on the map
      </h3>
      <p>
        Location must be set to <strong>Allow all the time</strong>, not just "While using the
        app" — otherwise you disappear the moment your screen locks. On Android, also set
        battery usage for Outdoor GM to <strong>Unrestricted</strong>; the default "Optimized"
        setting stops location updates when the phone is idle. The Stats tab shows a
        diagnostics panel with your permission states and last upload time.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 4px' }}>
        I reached a checkpoint but nothing happened
      </h3>
      <p>
        Checkpoints are detected from your GPS position, which is less precise when your phone
        is in a pocket. Detection can take a minute or two, and a checkpoint with a small
        radius may need you to stand closer. Game Masters can widen a checkpoint's radius.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 4px' }}>
        The app is draining my battery
      </h3>
      <p>
        Continuous GPS is demanding by nature. Game Masters can enable{' '}
        <strong>battery saver</strong> in the game settings, which reduces update frequency.
        For long games, bring a power bank.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 4px' }}>
        How do I stop sharing my location?
      </h3>
      <p>
        Leave the game, or tap out. Either stops location sharing immediately. Location is
        never shared outside an active game.
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 700, margin: '20px 0 4px' }}>
        How do I delete my account?
      </h3>
      <p>
        In the app, go to <strong>Profile → Delete account</strong>. This removes your profile
        and your membership in every game.
      </p>

      <h2 style={h2}>Privacy</h2>
      <p>
        See the <a href="/privacy" style={{ color: 'var(--primary)' }}>privacy policy</a> for
        what the app collects and how long it is kept.
      </p>
    </Shell>
  );
}

/**
 * Terms of use. Linked from the sign-in screen (`app/(auth)/login.tsx` → `TERMS_URL`).
 *
 * The safety sections are the load-bearing ones: this app sends people into real terrain,
 * and its SOS is a message to the Game Master's phone (`gameService.ts` → `raiseSos`), not
 * a call to emergency services. Say that plainly rather than burying it.
 */
export function TermsScreen() {
  return (
    <Shell title="Terms of Use" updated={TERMS_UPDATED}>
      <p>
        These terms cover your use of the Outdoor GM app and website. By creating an account
        or joining a game, you agree to them. If you do not, don't use the app.
      </p>

      <h2 style={h2}>What Outdoor GM is</h2>
      <p>
        Outdoor GM is a coordination tool for running real-world outdoor games. It shows a
        Game Master where players are, and it reacts when a player reaches a checkpoint.{' '}
        <strong>It is not a safety device, a security service, or a navigation system</strong>,
        and it is not a substitute for supervision, a map, a compass, or a charged phone.
      </p>

      <h2 style={h2}>Safety</h2>
      <p>
        <strong>The in-app safety alert notifies the Game Masters of your game. It does not
        contact emergency services.</strong> In an emergency, call your local emergency number
        first.
      </p>
      <ul>
        <li>
          You are responsible for your own safety, your fitness for the activity, the terrain
          you enter, and the weather you enter it in.
        </li>
        <li>
          Location reporting depends on GPS and a mobile data connection. Both fail — under
          tree cover, in valleys, in poor coverage, on a flat battery, or when your phone
          throttles background apps. Assume you can become invisible on the map at any moment,
          and plan the game so that being invisible is survivable.
        </li>
        <li>
          Checkpoint detection is approximate. Distances, radii, and arrival times are
          estimates, not measurements.
        </li>
        <li>Do not use the app while driving.</li>
      </ul>

      <h2 style={h2}>Running a game</h2>
      <p>If you run a game as a Game Master, you are responsible for it. You agree to:</p>
      <ul>
        <li>
          tell every player, before they join, that the app shares their location with you
          continuously — including in the background while their screen is locked;
        </li>
        <li>
          only run games in places where you and your players are permitted to be, with any
          landowner or venue permission the location requires;
        </li>
        <li>
          set a play area and rules appropriate to the participants, the terrain, and the
          conditions; and
        </li>
        <li>
          supervise participants under 18, and take part on your own account rather than
          creating accounts for them.
        </li>
      </ul>

      <h2 style={h2}>Location sharing and consent</h2>
      <p>
        Joining a game shares your live location with that game's Game Masters for as long as
        the game runs. Other players never see it. You can stop at any time by tapping out or
        leaving the game. What is collected and how long it is kept is set out in the{' '}
        <a href="/privacy" style={{ color: 'var(--primary)' }}>privacy policy</a>.
      </p>
      <p>
        <strong>Never use Outdoor GM to track someone who has not knowingly agreed to be
        tracked.</strong> Using it to monitor a person without their informed consent —
        including a partner, a family member, or an employee — is a misuse of the app and
        grounds for removing the account.
      </p>

      <h2 style={h2}>Your account</h2>
      <p>
        Keep your sign-in details to yourself; you're responsible for what happens under your
        account. Choose a display name you're comfortable other participants in a game seeing.
        You can delete your account at any time from <strong>Profile → Delete account</strong>.
      </p>

      <h2 style={h2}>Acceptable use</h2>
      <ul>
        <li>Don't use the app to harass, stalk, intimidate, or endanger anyone.</li>
        <li>Don't use it for any unlawful purpose, or to trespass.</li>
        <li>Don't upload photographs of other people without their agreement.</li>
        <li>
          Don't attempt to break, overload, reverse-engineer, or gain unauthorised access to
          the service or to other people's game data.
        </li>
      </ul>

      <h2 style={h2}>Availability</h2>
      <p>
        The app is provided as-is, with no guarantee that it will be available, uninterrupted,
        or accurate. Features may change or be withdrawn. Games, locations, and photos may be
        deleted as described in the privacy policy.
      </p>

      <h2 style={h2}>Liability</h2>
      <p>
        To the fullest extent the law allows, Outdoor GM is not liable for injury, loss, or
        damage arising from your participation in a game, from the conduct of a Game Master or
        another player, or from the app failing to report a position, deliver an alert, or
        detect a checkpoint. Nothing here limits liability that cannot lawfully be limited.
      </p>

      <h2 style={h2}>Ending access</h2>
      <p>
        We may suspend or remove an account that breaks these terms, particularly the consent
        and acceptable-use sections. You can stop using the app and delete your account at any
        time.
      </p>

      <h2 style={h2}>Changes</h2>
      <p>
        These terms may be updated; the date at the top shows when they last changed.
        Continuing to use the app after a change means you accept the updated terms.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        <a href={`mailto:${CONTACT}`} style={{ color: 'var(--primary)' }}>{CONTACT}</a>
      </p>
    </Shell>
  );
}
