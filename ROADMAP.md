# Outdoor GM — Enhancement Roadmap

Derived from the game ruleset (single-elimination, last-one-alive combat survival event) and
mapped onto the existing architecture (game phases, `GameContext`, Firestore subcollections,
the geofence Cloud Function). Tiers are by criticality: **P0** items are mechanics the game
*cannot run on the app without*; lower tiers are field robustness and polish.

> **Already-built functionality is documented in the [README](README.md#features)** — this
> file tracks **only outstanding work**. Data-model detail for each item lives in
> [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md); see
> [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for why the generic "team scavenger"
> framing was reprioritized for this specific game.
>
> Item numbers (`#1`–`#50`, `§`-refs) are **stable** and shared with ROADMAP_DATA_MODEL.md —
> landed items have been removed from this file, but their numbers are not reused.

## Cross-cutting theme: the game runs on a clock

A real event is a **timeline of timed actions**: voucher turn-in sites open and close at set
times (a player brings a physical voucher to a named spot during its window to swap it for a
ration card — the canonical "open a location at a set time" case), gear drops land at named
locations on schedule, the living-player count goes out every interval, and the GM gets
reminders to physically move between sites. Last year this was a paper/spreadsheet schedule
run by hand. Both structural pieces are now **built**:

- Checkpoints have an optional **active window** (`opensAt`/`closesAt`, #12, built) — the
  geofence only fires while live; the GM opens/closes a site manually or via the run-sheet.
- A **scheduled-events engine** (#11, built) fires broadcasts, opens/closes windows, pushes the
  living-player count, and pings the GM at clock-offset times — the in-app replacement for the
  spreadsheet.

## Cross-cutting theme: tributes belong to districts

The base game pairs players into **districts** (two tributes each). Several rules key off
this — most concretely the trap rule *"do not give a trap if both tributes from the same
district arrive together."* District is a first-class member attribute — **built** (#10):
GM-assigned on the roster (group/sort by district), GM-only writable, and on the member doc.
Its consumer, the same-district trap suppression in the geofence, is **also built** (#5).

---

## P0 — Blockers (core loop & win condition)

### 1. Auto-starvation sweep — *completes the ration loop*
**Rules 6–9.** The ration capture/upload and the GM review feed are **built** (see README).
The one outstanding piece is the **scheduled auto-starvation Cloud Function**: at each interval
boundary, mark any living player with no valid submission for the prior window as dead →
death broadcast (already built). Gated by `starvationMode` (`auto` eliminates; `gm-confirmed`
only flags for GM review).

Deferred on purpose until the photo path is field-tested — a flaky-signal day shouldn't
wrongly starve everyone. Today the GM eliminates missed players by hand from the review feed
(the "not eaten this window" glance feeds this).

> **Tester confirmed (2026-06-05):** auto-starvation **is wanted** — build the gated sweep. The
> default stays `gm-confirmed` (the GM flips a game to `auto` when they want hands-off
> elimination) until the photo path is field-proven, so a bad-signal day can't wrongly starve
> the field.

### 3. Graceful SMS fallback for SOS — *safety-critical*
**Rules 22, 27, 28.** The SOS button, the high-priority GM push, and the GM clear/controls are
**built**. Outstanding: if push/Firestore is unreachable, the SOS must **degrade to SMS**
(Twilio) so an unsafe/injured player can always reach the GM. Load-bearing now that Outdoor GM
is the *only* channel to the GM (see the Pingo consequence).

---

## P1 — The defining experience

### 4. Auto per-interval "N remaining" broadcast
**Rule 24.** The broadcast pipeline, the **manual** "living-player count" action, and the
run-sheet's templated **player-count** action (#11, built) are all in place — the GM can
schedule count pushes at any clock offsets. The only outstanding sliver is *auto-generating*
one every ration interval without the GM adding each row (a config toggle that seeds repeating
player-count entries). Low priority now that the run-sheet covers it manually.

> **Built and removed from this list:** #5 (checkpoint traps — arrival-order queue,
> same-district suppression, and #12 time-gating, all in the geofence function) and #11
> (the run-sheet: `scheduledEvents` collection, the per-minute sweep Cloud Function, and the
> GM authoring screen). See the README.

---

## P2 — Field robustness

### 8. Offline / poor-signal resilience — *safety-critical*
Outdoor venues drop signal. Queue location/ration writes and flush on reconnect so a dead
zone doesn't equal a missed ration (= wrongful starvation death) — and so the SOS path (#3)
and the only player tracking anyone has degrade gracefully rather than silently failing.

> **Built and removed from this list:** #12 (timed checkpoint windows — `opensAt`/`closesAt`
> on a checkpoint, the geofence time-gate, and GM open/close-now controls in the Play Area
> editor). The run-sheet (#11) flips these on schedule. *Follow-on:* the web checkpoint editor
> now also exposes the window choice (**Start open / Start closed / Always live**) in the
> **New Checkpoint** flow, not just on edit — staged at create and applied via the existing
> `openCheckpointNow`/`closeCheckpointNow` calls right after the doc is created.

### 13. Voucher turn-in sites (ration-card resupply)
Last year ran **five live voucher windows**. A voucher is a **physical token a player already
holds**; it is **turned in to the GM at a set place and time to receive a ration card** — the
card that then feeds the Rules 6–9 ration loop. So vouchers are the *upstream supply* for the
survival heartbeat, and the turn-in is a deliberate **forced-interaction** convergence point.

The exchange is paper and in-person, so the app **mints and tracks nothing** (no claims, no
ledger — the tokens are the source of truth). Its job is just two things:

- **Announce the turn-in window + location.** A voucher site is just a time-windowed
  checkpoint (#12) whose opening/closing the run-sheet (#11) toggles and broadcasts
  ("Voucher turn-in open at The Dock until 12:55"). This is the concrete realization of the
  "open a location at a set time" ask — no voucher-specific data model beyond #11 + #12.
- **Global supply control.** The GM can choke or reset the food economy at will with global
  instructions ("Rip up all vouchers" / "Rip up all ration cards"), sent as ordinary GM
  free-text broadcasts (#4). No new channel, kind, or state — a deliberate GM lever, manual
  on both ends (player rips up paper; GM watches the next ration window for the fallout).

Because of the above, **#13 needs no new code** — now that #11 + #12 are built, a voucher
turn-in *is* a checkpoint with `open-site`/`close-site` run-sheet entries and an announcing
broadcast; "rip up all vouchers/cards" is a free-text GM broadcast. #13 is a usage pattern,
not a build item. (A future nicety: a one-tap "voucher site" preset that scaffolds the
open/close/announce run-sheet rows.)

---

## P3 — Polish & admin

- **End-game phase** — the schedule has a distinct **end-game** block (last year 15:00–15:30)
  before the game formally concludes. Add an `endgame` phase between `play` and `results`
  (e.g. a final convergence / sudden-death window) the GM triggers, so the app models that
  step instead of jumping straight to results.
- **Post-game media — recap video + photo album (#14)** *(lowest priority — tester confirmed:
  deprioritize to the very bottom; stitching footage happens well after the real event)* — once a game is complete
  (`results` / `status: 'ended'`), let a GM attach a **YouTube recap video** and a **Google
  Photos shared album** so everyone can relive the event. Adding or updating *either* link
  **pushes an alert to all other GMs and players** in that game ("📺 The recap video is up
  for *<game>*" / "📷 Photos added").
  - **Data model:** a `media` object on the game doc — `{ youtubeUrl?, photosAlbumUrl?,
    updatedAt, updatedBy }` (a single shared object, GM-authored). Validate the URLs to the
    expected hosts (`youtube.com`/`youtu.be`, `photos.google.com`/`photos.app.goo.gl`) and
    store empty/cleared as removed.
  - **Notification:** a Cloud Function (Firestore trigger on the game doc) that fires when
    `media.youtubeUrl` or `media.photosAlbumUrl` changes, writes a `broadcast`
    (`kind: 'gm-message'` or a new `media` kind) and FCM-pushes every member token **except
    the GM who set it**. Reuses the existing broadcast + push pipeline (#4) — no new channel.
  - **UI:** the GM **results** screen gains an "Add recap / photos" editor (both platforms);
    the player and co-GM results screen shows tappable **Watch recap** / **View photos**
    buttons. These are **just outbound links** — no in-app player or gallery: the button
    hands the URL to the OS (`Linking.openURL` on mobile → opens the YouTube / Google Photos
    app or browser; a normal `<a target="_blank">` on web). Authoring is GM-only and gated on
    the game being finished.
  - **Rules:** the game-doc update rule in `firestore.rules` whitelists keys via
    `affectedKeys().hasOnly([...])` — add `'media'` so GMs can write it; the Cloud Function
    (admin SDK) bypasses rules for the broadcast/push.
  - **Why P3:** post-event enrichment, not match-critical — but cheap given the broadcast
    pipeline already exists, and it closes the loop after `results`.
- **Custom arena map overlay** (Rule 33) — let the GM upload the arena map image as a map
  overlay instead of relying only on generic tiles + a rectangle boundary.
- **Night-before test game (practice mode) — #15** — **⬆ PROMOTED to the top of the build
  order (2026-06-05 tester feedback): build this first.** Bennett wants to start testing with
  real people, and a disposable dress-rehearsal game is exactly what unblocks that. It rides
  with the #25–#28 **Critical** deploy-blockers, since any TestFlight/Play test build deploys
  through them. (Listed here under P3 for context, but sequenced first — see the build order.)
  Instead of a static pre-game checklist,
  the team runs a **full dress rehearsal with players physically gathered in one spot** (the
  night before, or shortly before kickoff — possibly a **short drive from the actual venue**,
  so they can't walk the real course): everyone installs the app, grants "Always" location,
  and joins; the GM **drops a test checkpoint where the group is standing** so a player
  stepping into it trips a **real** geofence event; the GM confirms all players are reporting,
  visible on the map, and that the alerts/pushes land on every device. It's the end-to-end
  validation of joins, tracking, the event pipeline, and notification delivery — the thing the
  checklist was meant to guarantee, but actually exercised. To keep the drill from polluting
  the real event, it runs as a **dedicated practice game** (a `game.practice` flag):
  - **Drop-here test checkpoint** — because the group may be off-venue, the GM places a
    checkpoint at the **current location** in one tap (current GPS, a generous radius),
    carrying a test event. A player stepping into it fires the **real** `onLocationUpdate`
    geofence → arrival + push, confirming the pipeline end-to-end without being on the real
    course. It's flagged as a test and removed with the practice game, so it never leaks into
    the real course.
  - **Unmistakable PRACTICE badge** on every GM and player screen so nobody confuses the
    rehearsal with the real game.
  - **Disposable & re-runnable** — a GM action wipes `arrivals`/`locations`/`rations` to run
    the drill again, and the game (plus its ration photos) auto-cleans afterward so it doesn't
    clutter My Games or Storage (reuses the `cleanupRationPhotosOnGameEnd` path).
  - **Relaxed guards** — the Safety-net invariants that block destructive actions (no mid-game
    player removal, can't-end-with-someone-unaccounted-for, two-step confirms) are loosened in
    practice so the GM can freely tear down and reset.
  - **Readiness view** — a GM "all set?" glance: N/N players joined, all reporting a fresh fix
    (reuses the stale-fix service), each confirmed receiving a push. Turns "did everyone's
    notifications work?" into a green check before the real game.
  - Player onboarding (install, sign in, grant "Always" location, join code) happens naturally
    as the first step of the rehearsal — no separate checklist screen needed. Worth building
    **before the first real event**, even though it's P3 tooling. Physical GM ops (pre-place
    ration bags, seed gear) and a roaming helper ("send Aaron to X") stay a run-sheet
    `gm-reminder` (#11) concern, not a checklist.

---

## Field-test findings — 2026-06-03 playtest

First real device-to-device run (Shannon as player). These are observed defects and UX gaps
from playing through a game, not derived-from-ruleset features. Several break the core loop
or the alert mechanic and should be treated as **must-fix before a real game** despite living
below the P0 ruleset items. New stable numbers continue the #-series.

### 16. Eager location capture — start in the lobby, not on the play screen *(observed: ~3–4 min lag — built)*
On the playtest a player's location did **not** appear for the GM until ~3–4 minutes in (checked
at 30s: absent; checked 4 min later: present). Tracking only starts when the player reaches the
play screen. Fix: begin acquiring/uploading player locations **while they wait in the lobby**, so
that by the time the GM is ready to start, every player already has a fix.

- **GM lobby readiness list** — show the GM, per player, whether we have a location yet (a "N/N
  players located" glance), so the GM can wait to **Start Game** until all players are reporting.
  Pairs with the Start-Game preflight invariant and the #15 readiness view.
- **Pre-fetch GM location before "Set Boundary."** If a game has no `boundary`, start resolving
  the GM's location *before* they tap **Set Boundary**, so the map is already centered on them
  when the editor opens instead of making them wait.

> **Built.**
> - **Lobby tracking** (`app/(app)/player/game.tsx`): the tracking effect (and the resume
>   re-assert) now run in `lobby` as well as `play`, so a waiting player is uploading location
>   before kickoff. The lobby waiting screen shows a "Location ready — you're on your GM's map" /
>   "Getting your location ready…" indicator.
> - **Up-front permission priming** (`components/LobbyPermissions.tsx`, `services/permissions.ts`):
>   the lobby waiting screen primes player permissions — notifications + camera are requested on
>   entry, and location is surfaced with an **Allow / Settings** fix — instead of prompting mid-game
>   when each feature first fires. Shows a live checklist that re-checks on return from Settings.
>   *Note:* the primer deliberately does **not** issue its own location request — `startLocationTracking`
>   already prompts for it in the lobby, and a second concurrent `requestForegroundPermissionsAsync`
>   was found to deadlock expo-location and wedge tracking on "Starting tracking…" (that request is
>   now also time-boxed as a backstop).
> - **Geofence phase guard** (`functions/src/geofence.ts`): the function now reads the game doc
>   and returns unless `phase === 'play'`, so lobby/setup fixes appear on the GM map but **never**
>   fire a checkpoint prematurely (mirrors the `gamePhase()` legacy default).
> - **GM readiness list** (`app/(app)/gm/[gameId]/index.tsx`): the lobby roster shows a per-player
>   On map / Locating… dot and an "N/N on the map" header (from `playerLocations`); **Start Game**
>   now warns when some joined players haven't reported a fix yet, so the GM can wait for stragglers.
> - **Pre-fetch GM location**: in `setup` with no boundary, the GM screen warms a fix (permission +
>   `getCurrentPositionAsync`) so the Play Area editor — which reads `getLastKnownPositionAsync`
>   first — opens centered instantly instead of spinning.

### 17. GM/event alerts must surface over the app — and the triggering player gets the hazard text *(two bugs — client fix built)*
Two distinct problems seen when a player crossed a checkpoint:
- **Wrong audience/content for the triggering player.** Shannon (the *player* who crossed) got a
  GM-style "Shannon hit an event" notification. The player who trips a hazard checkpoint should
  instead see the **hazard/event text alert surfaced over their own screen** (the trap/event
  payload), not a third-person "X hit an event" push meant for the GM. (Server already targets the
  crossing player with the event payload via a `targetPlayerId` broadcast; the GM third-person line
  is GM-only — a player-only account never gets it. The remaining gap was *surfacing* the player's
  payload prominently.)
- **Alerts are too easy to miss.** GM-sent alerts (and event/hazard alerts) currently only land
  in the in-app **alert section**, which is invisible if the player is looking at the map or
  anything else. They must come up as a **heads-up / full-screen alert over the front of the
  app** (foreground in-app modal/banner + high-importance heads-up notification), not just append
  to a list. This is the alert mechanic the game runs on — it can't be passively missed.

> **Built (client):** `components/AlertOverlay.tsx` — a heads-up modal that pops **over the app**
> the instant a new broadcast lands (hazard/boon/message/death/winner/count), themed by kind, with
> haptics; hazards/deaths require a tap to clear, the rest auto-dismiss. Driven by the same
> global+targeted broadcast query as the feed, so the crossing player sees the hazard text over
> their screen. Backlog present at mount is ignored (no replay on re-entry). Shared theming
> extracted to `components/broadcastVisuals.ts` (feed + overlay stay in sync). Added the missing
> **MAX-importance `broadcasts` Android channel** in `app/_layout.tsx` so backgrounded/locked
> pushes are heads-up, and dropped the old easily-missed `Alert.alert` foreground handler.
> **Still open:** reliable background *delivery* of those pushes is #18; the GM-side heads-up
> already exists (local notification + haptic + unseen badge).

### 18. Background push delivery is unreliable *(observed: missed until app opened — FCM hardened; root cause is the upload gap)*
Phone locked, player crossed the **second** checkpoint, **no notification arrived** until ~4 min
later when the app was manually opened — then it fired.

> **Root-cause finding.** The geofence Cloud Function only runs when the crossing player's
> **location doc is written**, and that write only happens while the screen is locked if the
> **background** location service is running. A player on the *foreground-only* watcher
> (`watchPositionAsync`, used when "Always" wasn't granted or the Android 14 foreground service
> couldn't start) **stops uploading the moment the phone locks** — so the geofence never fires
> until the app is reopened and the watcher resumes. The alert arriving *exactly* on app-open (not
> during a Doze maintenance window) is the tell: the **trigger** was delayed, not the push.

> **Built (keep tracking while locked).** The trigger gap is now closed:
> - **Background service hardened** (`services/locationTask.ts`): `killServiceOnDestroy: false` so
>   the Android location foreground service (and uploads) survive the app being swiped away;
>   `activityType: Fitness` + `pausesUpdatesAutomatically: false` so iOS doesn't suspend updates
>   when it thinks the player is still. With "Always" granted, the player keeps reporting while
>   locked → the geofence keeps firing → checkpoint/GM alerts land in real time.
> - **Background-permission check fixed** (field test, 2026-06, observed on Android): the startup
>   flow called `requestBackgroundPermissionsAsync()` behind an 8s timeout, which wedges *even when
>   "Allow all the time" is already granted* (Android sits behind the Settings redirect on 11+; iOS
>   can hang) — the timeout then logged `Background permission: error` and flipped a
>   fully-permissioned player to the foreground-only watcher (the "you'll vanish when locked"
>   warning despite granted perms). Now we read the current grant via
>   `getBackgroundPermissionsAsync()` first (instant, no prompt) and only request when genuinely
>   needed, falling back to the read grant if the request hangs.
> - **`distanceInterval: 0`** (field test, 2026-06): the location request had a 10–30 m displacement
>   filter, so a player standing still (e.g. waiting *at* a checkpoint) delivered **no** fixes — the
>   geofence got no write inside the radius (no event until they moved/opened the app) and the GM saw
>   them go stale within ~2 min. Now purely time-based, so stationary/locked players keep reporting
>   and checkpoints fire.
> - **Foreground-request deadlock fixed** (field test, 2026-06): the lobby permission primer issuing
>   its own `requestForegroundPermissionsAsync` concurrently with `startLocationTracking` could leave
>   the latter pending forever → stuck on "Starting tracking…", GM saw the player not reporting even
>   though the OS blue dot showed. The primer no longer requests location, and the tracking request
>   is time-boxed.
> - **Resume re-assert** (`player/game.tsx`): on every app foreground we re-run
>   `startLocationTracking`, which restarts a service the OS may have killed and *upgrades* a
>   foreground-only player to the background service if they granted "Always" in Settings since.
> - **Tracking-stopped self-alarm (the safety net):** when only the foreground watcher is running,
>   the player now sees a loud "**You'll vanish from the map when your screen locks**" banner with a
>   one-tap **Fix → Settings**, and the status card no longer falsely claims "Location Sharing
>   Active." OS-level constraint remains: if the player refuses "Always," no app can track them
>   while locked — so the honest fix is to surface it, not hide it.
>
> Still tracked elsewhere: **#16** (start tracking eagerly in the lobby) and **#8** (offline
> queue-and-flush) are complementary, not required for the locked-screen case above.

> **Built (FCM hardening, `functions/src/notifications.ts`).** Independent of the trigger gap, the
> push itself is now hardened so that once generated it reaches a locked device immediately instead
> of being batched/throttled: Android `priority: high` + a 1h TTL + lock-screen heads-up
> (`notification.priority: 'max'`, `visibility: 'public'`, default vibrate) routed to the
> MAX-importance channels (#17); iOS `apns-priority: 10` + `apns-push-type: alert`, and **removed
> the `content-available` flag** that was demoting each alert to a throttle-able background push.
> All push call sites funnel through this one function. Pairs with the Start-Game preflight
> (valid FCM token) invariant so there's a live token to deliver to.

### 19. Player intro/tutorial screen is out of date *(built)*
The player intro (`components/Tutorial.tsx`) still shows a much older version of the game intro.
Rewrite it to reflect the current ruleset/decisions (districts, traps, timed windows, the ration
loop, SOS, run-sheet-driven events) so onboarding matches the game players actually play.

> **Built.** Replaced the 3 stale slides (generic mini-map / "reach checkpoints" / "I'm Out") with
> a 6-slide deck matching the real game: the arena & own-dot map, **districts** (partner pairing +
> same-district trap behavior), **field events** (hazard/boon/message + timed sites + over-the-app
> alerts), the **ration eat-or-starve** loop (windowed, camera capture), **don't-miss-alerts**
> (keep notifications + "Allow all the time" location so alerts land when locked — ties to #17/#18),
> and **out/in-trouble** (the real "I've been killed" + red-bandana honor rule, and the SOS safety
> alert). The GM's free-text rules still append as a final slide.

### 20. Player screen — split map view and stats view *(map unusably small — built)*
On a phone the embedded map is too small to be useful. Give the player screen **two switchable
views**: a **map view** (full-screen map of their own location + relevant context) and a **stats
view** (timer, ration window/countdown, district, alive count, status). A toggle/tabs between them
instead of cramming both into one cramped screen.

> **Built.** `app/(app)/player/game.tsx` play screen now has **Map / Stats tabs**. The **Map** tab
> is the full-screen `GameMap` (boundary + the player's own blue dot — `GameMap` gained an opt-in
> `showsUserLocation` prop, off for the GM) with an always-visible time-left pill overlay. The
> **Stats** tab holds the timer card, the ration panel, the tracking-status card (+ diagnostics),
> and the messages feed. The foreground-only warning and tracking-error banners stay **pinned above
> both tabs**, and the safety action bar ("I've been killed" + SOS, or the "you're out" card when
> eliminated) is **pinned at the bottom** so it's reachable from either view.

### 21. Ration mechanic — gate to its open window + alert on open; fix the broken capture button *(two bugs — built)*
- **Window-gate the ration panel.** The ration capture UI is currently open at all times. Players
  shouldn't (and won't) show a card 10 minutes in — only during the configured interval window
  (e.g. ~30 min in, per `rationIntervalMinutes`). Only **open the ration card window during its
  active interval** and **alert the player when the window opens** (and ideally a closing warning),
  rather than presenting the panel constantly. Pairs with the timed-window engine (#11/#12).
- **Camera-capture button doesn't work.** Tapping "take a picture of a ration card" did nothing;
  after three taps it finally surfaced the camera-permission prompt, but **even after granting
  permission and tapping again the camera never opened**. Fix the `expo-image-picker`
  `launchCameraAsync` flow in `components/RationPanel.tsx`: request permission *up front* (await the
  result before launching), then reliably open the live camera on the first tap. This blocks the
  entire Rules 6–9 ration loop — nothing can be submitted if the camera won't open.

> **Built.** New `config.rationWindowMinutes` knob (default 10, clamped ≤ interval) on the shared
> `GameConfig`/`BASE_GAME_CONFIG`; `rationInterval()` (mobile + web) now returns
> `windowStartsAt`/`isOpen` — the eat-window is the **last `rationWindowMinutes` of each interval**,
> ending at the boundary. `RationPanel.tsx` hides the capture UI until open (showing a muted
> "opens in …" countdown) and **schedules local notifications** (deterministic ids, MAX
> `broadcasts` channel) at each future window-open so the player is alerted even backgrounded/locked.
> **Camera:** two field-test rounds proved `ImagePicker.launchCameraAsync` unreliable on Android —
> the external camera activity launched but the result promise never resolved (the host activity is
> recreated and the result is lost; observed as stuck on "opening camera…"). Replaced it with an
> **in-app camera** (`components/CameraCapture.tsx`, `expo-camera` `CameraView`) so capture happens
> inside our own activity and can't lose the result. GM config editors (mobile + web) expose the new
> open-window field (interval field relabeled). On-screen `camera:`/`🔔 alerts` diagnostics added for
> field testing. Needs device verification of the in-app camera.

---

## Field-test findings — 2026-06-03 ration-loop review

A second pass focused on the ration capture/review loop in use. Three defects in how the GM
review and the player submission behave once a card is actually submitted — all in the
already-built Rules 6–9 path (`components/RationPanel.tsx`, `app/(app)/gm/[gameId]/rations.tsx`,
the web `RationsModal`). Schema detail: [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) §14.

### 22. GM ration review — approve/reject is terminal, not a pair of always-live buttons
On the GM review feed, **Approve** and **Reject** currently both stay tappable after a decision:
approving a card shows "approved" but the **Reject** button is still there and can be clicked
(and vice-versa). A reviewed card should expose **no further action** — once `status` is
`valid` or `rejected`, replace the button pair with the resolved state (a label/chip, e.g.
"✓ Approved" / "✕ Rejected"), not a second live button. The only way to flip a decision should
be a deliberate, explicit "change decision" affordance (if we want one at all), never an
ever-present opposite button that looks like the next step. Applies to **both** the mobile feed
(`rations.tsx`) and the web `RationsModal`, which share `reviewRation()`.

### 23. Ration photo review must scale to the window and scroll
The photo lightbox/review blows up **larger than the window** and isn't scrollable, so a
portrait card photo can't be fully seen. The review image must **fit within the viewport**
(scale to the available width/height, preserve aspect ratio, `resizeMode: 'contain'`) and the
review surface must **scroll** when content exceeds the screen — on the mobile lightbox and the
web modal alike. No part of a submitted photo should be clipped off-screen or zoomed past the
frame.

### 24. Player — one ration submission per window; show pending → approved, then count down
A player can currently submit **multiple** ration cards while the window is open, and the panel
keeps showing the open capture UI even after they've submitted. It should be **one submission
per window**:
- **After submit:** hide the capture UI and show **"approval pending"** for that window's card
  (the existing deterministic `rations/{playerId}_{intervalIndex}` doc already makes the submit
  idempotent — the UI just needs to reflect it).
- **On approval (`status: 'valid'`):** show that **this window's ration was approved** and switch
  to the **countdown to the next window** ("next ration in …"), exactly as if the window had
  closed — do **not** keep the window "open" or allow another capture.
- **On rejection (`status: 'rejected'`):** the player may **re-submit** for the same window while
  it's still open (the one rejection path that reopens capture), since a rejected card means they
  still owe a valid one this interval. After the window closes, fall through to the normal
  missed/closed state.

The driver is the player's own submission doc for the current `intervalIndex` (already in scope
via the rations listener) — the panel keys its state off that doc's presence and `status` rather
than off the raw window-open boolean alone.

---

## Production hardening & go-live — code review 2026-06-04

A full-codebase review focused on **security, loading sequence, efficiency, and what it takes
to ship as a production app**. These are not ruleset features or playtest defects — they're the
deploy-blockers, cost/scaling risks, and data-lifecycle gaps that surface when the app goes
live. New stable numbers continue the #-series; schema/enforcement detail is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) §15. Recommended order: the four **Critical**
items first (they break a deploy or fail at runtime), then **High** (cost/privacy), then the
rest.

### Critical — block or gate the launch

#### 25. Migrate Twilio off `functions.config()` *(deprecated — will break deploys)*
`functions/src/sms.ts:8` reads Twilio creds via `functions.config()`, which is removed in the
current `firebase-functions` generation (Google has set a shutdown date). On a fresh deploy with
an up-to-date toolchain this returns `undefined` and silently disables SMS — the **only**
non-push channel for SOS alerts (#3). Migrate to `defineSecret`/params (`TWILIO_SID`,
`TWILIO_TOKEN`, `TWILIO_FROM`) and pass them into the function. Most likely single thing to break
a production deploy.

#### 26. Turn on App Check enforcement + add callable rate-limiting *(open abuse surface)*
`functions/src/games.ts:12` has `ENFORCE_APP_CHECK = false` (intentional pre-launch), and there
is **no rate limiting** on any callable. Any authenticated user can brute-force `joinGameByCode`
or spam `createGame`. Before launch: register App Check on both platforms, verify real builds get
tokens, flip the flag, **and** add a per-UID throttle on `joinGameByCode` (a short cooldown doc
or a failed-attempt counter). The 32⁶ code space makes blind brute force impractical, but an
authenticated attacker with no throttle is still a real vector.

#### 27. Restrict the Google Maps API keys in Cloud Console *(billing-abuse vector)*
`app.json:22` (iOS) and `app.json:44` (Android) ship Maps keys in the binary — unavoidable, and
fine **only if** each key is locked to its bundle ID / SHA-1 and to the Maps SDK. If unrestricted,
anyone can extract them from the APK/IPA and bill maps usage to the project. Verify (and document)
the restrictions before the store release. No code change — a console/ops task to confirm.

#### 28. Add the missing collection-group index for the run-sheet sweep *(runtime failure)*
`functions/src/runsheet.ts:30` runs `collectionGroup('scheduledEvents').where('firedAt','==',null)`,
which needs a `COLLECTION_GROUP`-scoped single-field index on `scheduledEvents.firedAt` — the same
reason the `members.userId` override exists in `firestore.indexes.json`. No such override is
present, so the every-minute sweep throws `FAILED_PRECONDITION` (needs-index) and **every
run-sheet action silently never fires** (#11). Add the field override (or confirm it was created
manually in the console) and redeploy indexes.

### High — cost, privacy, data lifecycle

#### 29. Geofence read-cost scales poorly and does work during the lobby
`functions/src/geofence.ts` (`onLocationUpdate`) fires on every location write (time-based, ~every
5s/player) and does ~4 reads each time (game doc, member doc, all checkpoints, all arrivals).
During the **lobby**, players already upload location (#16), so each write costs 2 reads just to
hit the `phase !== 'play'` early-return and no-op. Over an N-player, 3.5h game this is the dominant
Firestore cost. Mitigations: cache/skip the game+member reads, short-circuit lobby writes more
cheaply, or skip processing when the game has zero checkpoints. Model the cost at expected player
counts before launch.

#### 30. Purge location & arrival data on game end *(privacy / unbounded growth)*
Only ration *photos* are cleaned on game end (`functions/src/cleanup.ts`). Player `locations/*`
(last GPS + name) and `arrivals/*` persist in Firestore indefinitely for every finished game — a
privacy/retention liability for a location-tracking app, and unbounded growth. Extend
`cleanupRationPhotosOnGameEnd` (or add a scheduled job) to also delete `locations` (and optionally
`arrivals`) on the `play → ended` transition, and reflect the retention policy in the privacy
policy.

#### 31. Parallelize `getMyGames` (N+1 sequential reads)
`services/gameService.ts:293-315` `await`s a separate `games/{gameId}` read inside a `for` loop,
once per membership, and this runs on **every focus** of the Games screen
(`app/(app)/games.tsx:50`). A user in 10 games pays 10 serial round-trips on every return to the
list. Wrap the per-game reads in `Promise.all` (and consider caching) so the list loads in one
round-trip's worth of latency.

#### 32. Consolidate duplicate broadcast listeners on the player screen
`AlertOverlay` and `BroadcastFeed` each open **two** Firestore listeners (global + targeted). The
play screen mounts `AlertOverlay` + a `BroadcastFeed`, and the waiting screen mounts another
`BroadcastFeed`, so a player holds 4–6 concurrent subscriptions on the same collection. Lift
broadcasts into a single shared subscription (the player screen doesn't use `GameContext` today)
and feed both components from it — fewer live listeners, less read load.

### Medium — correctness & robustness

#### 33. Make single-event arrival dedup transactional
`functions/src/geofence.ts:206-224` — the `eventQueue` path guards double-fire with a transaction,
but the single-`event` path relies on the non-transactional `arrivedCheckpointIds` set read at
function start. Two concurrent location writes for the same player can both pass the check and
create duplicate arrival records/notifications. Close the asymmetry by reusing the transactional
idempotency check for the single-event path too.

#### 34. Harden `deleteAccount` — batch limit + sole-GM orphans
`services/gameService.ts:471-511` deletes all memberships in one `WriteBatch` (caps at 500 writes
— a user in 250+ games throws), and deleting the **sole GM** of a game orphans it (players still
in, no one able to end/delete). Chunk the batch, and handle sole-GM games (transfer GM, or
server-side delete the game).

#### 35. Stabilize the player tracking effect (stop/restart churn)
`app/(app)/player/game.tsx:158-201` — the tracking effect depends on `displayName`, `batterySaver`,
`phase`, `out`; `displayName` flips `'' → real name` shortly after mount, so cleanup stops the
background service and the next run restarts it (a brief window with no active game), and the
separate AppState effect can call `startLocationTracking` concurrently. Drive tracking from a
single controller keyed on a stable `shouldTrack` boolean to avoid the churn and the concurrent
starts.

#### 36. Range-validate coordinates in the location write rule
`firestore.rules:98-103` checks `latitude`/`longitude` are `is number` but not bounded to ±90 /
±180. A member can write nonsense coordinates for their own location doc. Low impact, cheap to
tighten with two range checks.

### Low — polish & branding

#### 37. Rebrand the remaining legacy "Hunger Games" strings
`functions/src/sms.ts:27` prefixes SMS bodies with `[HungerGamesLocator]` while the app is "Outdoor
GM" — user-visible. Internal identifiers (`hgl-background-location`, `hgl_*` AsyncStorage keys) are
harmless to leave, but the SMS prefix should be rebranded.

#### 38. Reset the login button's loading state on a stuck navigation
`app/(auth)/login.tsx:42-45` only clears `loading` on error; on success it relies on `router.replace`
unmounting the screen. If navigation is delayed/blocked the button spins indefinitely. A
`finally { setLoading(false) }` (or a guard) makes it robust.

#### 39. Remove the unused `arrivals` composite index
`firestore.indexes.json:3` defines `arrivals` (playerId ASC, timestamp DESC), but no query uses it
(the geofence filters `playerId` only; the client orders by `timestamp` only). Dead config — drop
it (or add the query that needs it).

> **Verified clean:** real secrets (`.env`, `web/.env`) are correctly gitignored; only
> `.env.example` and the client config files (`google-services.json`, `GoogleService-Info.plist`,
> which are not secrets) are tracked.

---

## Field-test findings — 2026-06-05 reviewer pass

A reviewer-account walkthrough (signing in/out between a GM account and a personal player
account on the same device) plus a screenshot/demo prep pass. New stable numbers continue
the #-series.

### 40. Sort My Games by creation date (newest first), add optional game date

The "My Games" list (`app/(app)/games.tsx`) shows games in the arbitrary order Firestore
returns them — for a player or GM with several games, the most recent game may be buried at
the bottom. Sort games **newest-first** by `createdAt` on the client (the field already
exists on every game doc). Additionally, add an optional `gameDate` field (`FsTimestamp?`)
to the game doc — a human-facing **event date** the GM sets at creation or in setup (e.g.
"August 9, 2026"), distinct from the system-generated `createdAt`. When present, the list
can sort/group by `gameDate` instead, so a game scheduled for next month appears at the top
even if it was created weeks ago.

### 41. Pre-populate join display name from user profile

When a player taps "Join Game" (`app/(app)/join.tsx`), the display-name field already
seeds from `profile?.displayName` — **but only if the profile has one**. The gap: a player
who set their name on the Profile screen should see that name carry forward into every
join. Today this works, but the UX isn't explicit: the field should show the profile name
as a **pre-filled default** with a visual hint ("from your profile") so the player knows
they *can* change it per-game but don't *have* to. Verify the seed actually fires when the
profile is slow to load (the `useAuth()` `profile` may arrive after mount, leaving the
field blank).

### 42. Navigate directly to the game after joining — not back to My Games

After a successful `joinGameByCode`, the app navigates to `/(app)/games` (the My Games
list), forcing the player to find the game they just joined and tap into it. Instead,
`joinGameByCode` already returns `{ gameId, role }` — use it to **navigate directly to the
game screen** (e.g. `/(app)/player/game?id={gameId}` or the GM equivalent), skipping the
extra step. The join should feel like "enter code → you're in the game," not "enter code →
find it in the list."

### 43. Winner detection counts GMs as "remaining" — declares a GM the winner *(bug)*

Observed: a game with **one player and one GM**; when the player tapped out, auto-winner
detection declared the **GM** the winner. The server function (`functions/src/members.ts`)
filters `m.role !== 'gm' && !m.out` to find living non-GM members, which should produce
`living.length === 0` in this case (the zero-survivor "no winner" path). If the GM was
incorrectly crowned, either: (a) the GM's member doc has `role: 'player'` despite being
the GM (a data issue — check the `createGame` callable + the promote/demote flow), or
(b) the transaction re-read picked up a stale snapshot. Investigate and fix — the function
must never declare a GM (who doesn't play) the winner. Add a regression guard: when the
sole remaining member is a GM, that's the zero-survivor path ("all tributes have fallen"),
not a winner.

### 44. Player gets both the player hazard notification AND the GM notification on crossing *(bug)*

Observed: player account crossed a hazard checkpoint and received **two** push
notifications — the hazard text (correct, player-facing) **and** the third-person
"[player] triggered an event at [checkpoint]" GM notification. The `dispatchCheckpointEvent`
function (`functions/src/geofence.ts`) **always** sends a GM push (line ~351,
`sendArrivalPushNotifications(gmTokens, ...)`) and then, in the `crossing-player` branch,
also pushes to `crossingPlayerToken`. On a **shared device** where the same physical FCM
token is registered on both the player's member doc *and* the GM's member doc (because the
reviewer signed into both accounts on the same phone), the same device token appears in
**both** `gmTokens` and `crossingPlayerToken`, so two pushes land. Fix: filter the
crossing player's token *out* of `gmTokens` before sending the GM push, so a device that
is also the crossing player doesn't double-receive. (This also prevents the player from
seeing the GM-internal event line, which leaks GM context.)

### 45. Demo / screenshot screens don't match the current mobile UI

The web demo page (`web/src/screens/DemoScreen.tsx`, on the
`claude/demo-website-screenshots` branch) was built against an earlier iteration of the
mobile screens. The mobile app has since gained the Map/Stats split (#20), the ration
eat-window gate (#21), the alert overlay (#17), the lobby permission primer (#16), the
refreshed tutorial (#19), and the setup → lobby → play → results phase flow. The demo
screens need to be rebuilt to **match the current mobile UI** — accurate enough for App
Store / Play Store screenshots. This means updating (or replacing) the static mockup
components so the map view, stats tab, ration panel, lobby, setup, and results screens
visually match what a player and GM actually see.

---

## Tester feedback — 2026-06-05 (Bennett)

First outside-tester pass (Bennett, setting up as a GM on the **desktop web** dashboard and
playing as a player on his phone). Reactions to the setup flow plus a set of checkpoint
**user stories** that reframe the biggest product gap: **checkpoints are never visible to
players today, and they should be** — sometimes from the start, sometimes revealed by timing
or a GM prompt, with different audiences. New stable numbers continue the #-series; schema
detail in [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) §17.

### 46. Polygon play-area boundary (vs. the current rectangle) — *low priority*
`MapBoundary` is a lat/lng **rectangle** (`minLat/maxLat/minLng/maxLng`), captured from the
map view. A real arena is rarely a clean box. Allow the GM to define the boundary as a
**polygon** (ordered vertices) so the play area can follow terrain/roads. The boundary-exit
safety check (Safety nets) and the geofence both switch from the current min/max compare to a
**point-in-polygon** test. Bennett asked for it; **deprioritized** — the rectangle is workable
for now. Related to, but distinct from, the P3 "custom arena map overlay" item.

### 47. Split boundary editing and checkpoint placement into separate screens *(UX defect)*
On the combined map editor a tap meant to **place a checkpoint can accidentally drag the
boundary** — Bennett moved the boundary several times while trying to drop checkpoints.
Separate the two modes: a dedicated **Set Boundary** screen (`gm/[gameId]/boundary.tsx`) and a
dedicated **Add Checkpoints** screen, so a tap in one can never mutate the other. Bennett also
noted the **desktop web GM dashboard** is the more comfortable place to do setup (easy to
split-screen) — decoupling the mobile screens narrows that gap.

### 48. Player-visible checkpoints + a visibility / reveal model *(the headline change)*
**Today every checkpoint is GM-only and invisible to players.** All four tester user stories
turn on *players seeing (some) checkpoints, at the right time, with the right audience* — this
is "the biggest thing to change." Build the **full A–D matrix**: a checkpoint gains a
**visibility axis** that is **independent of its event payload** —

- **A — Trap.** Hidden from players (GM sees it); becomes visible **to the triggering player
  only** once they cross it. (`visibility: on-reveal`, `trigger: on-crossing`, `audience: triggerer`.)
- **B — Timed/triggered drop.** GM-only at start; becomes visible **to all players** at a
  **set game time** *or* a **GM manual trigger**. (`on-reveal`, `trigger: game-time | gm-manual`,
  `audience: all`.)
- **C — Named location.** Visible to **all players from game start**, but **what it does is
  not** — the effect only reveals on crossing. (`visibility: always`; the existing
  `event`/`eventQueue` stays the hidden payload.)
- **D — Sponsor drop for a specific player.** GM-only at start; becomes visible **to a named
  subset (usually 1)** at a game time or GM trigger. (`on-reveal`, `audience: specific-players`,
  `recipientPlayerIds`.)

Visibility is **separate** from the event audience (#5 / §2): a marker can be *visible* while
its effect stays secret (case C). Reveal reuses the timed-window (#12) and run-sheet (#11)
machinery — a new `reveal-checkpoint` run-sheet action plus a `game-time` offset / `gm-manual`
toggle / `on-crossing` path in the geofence. **Security note:** hidden checkpoints must never
reach a player's device, so reveal works by the server **projecting revealed markers into a
player-readable surface** rather than opening the GM-only checkpoints collection — players gain
a markers map layer they don't have today (see §17). Pairs with #47 (now that checkpoints carry
real semantics, authoring them deserves its own screen).

### 49. GM per-player screen + targeted player messaging *(messaging first)*
A GM **per-player detail screen** (tap a player on the roster → their detail) is the natural
home for **player-specific actions**. Build **targeted GM→player messaging first** —
`Broadcast.targetPlayerId` already exists and players already filter targeted broadcasts, so
it's mostly a compose UI. The point (Bennett's): keep the whole game experience in-app instead
of bouncing to a separate messaging app mid-game. **Later sub-items on the same screen:**
authoring **per-player checkpoints** (the GM side of case D / #48) and **GM↔GM messaging** (new
— broadcasts are GM→player only today; an explicit nice-to-have).

### 50. Cleanup for orphaned / lost games *(no-GM games)*
Bennett hit a dead game: as the **sole GM he removed himself from the players list**, then
couldn't End Game ("no permissions"). **Prevention** is the existing **"Always ≥ 1 GM"**
invariant (block the last GM from removing/demoting themselves) — landing in the next deploy.
**This item is the remediation for games *already* orphaned**: a **scheduled sweep that
auto-ends** any game left with **zero GMs** (`status: 'ended'`), which then triggers the
existing end-of-game cleanup (#30 location/arrival purge, ration-photo deletion). No
GM-transfer — an orphaned game is just closed out. Pairs with #34 (deleteAccount sole-GM
orphans), which can reuse the same auto-end path.

---

## Consequence of replacing Pingo (sole location & safety tool)

Outdoor GM has **replaced "Find My Kids by Pingo"** as the only location & safety tool — so
it's now the only thing tracking players and the only channel to reach the GM. The GM-visible
**"stale fix" indicator** (last-seen age per player) is **built**; what remains promoted from
"robustness" to **load-bearing / safety-critical**:

- **Offline / poor-signal resilience (#8)** is no longer just gameplay fairness — it's a safety
  gap. Queue-and-flush location writes, and the **SOS path (#3)** must degrade gracefully
  (fall back to SMS if push/Firestore is unreachable).
- **Onboarding**: since setup moved into Outdoor GM, the night-before flow now means installing
  the app, signing in, granting **"Always" location**, and joining the game code. This is
  validated by the **night-before test game** (#15, P3) rather than a checklist screen —
  players do it on-site as the first step of the dress rehearsal. Rule 26 should be rewritten
  to onboard Outdoor GM the night before instead of Pingo (a doc/rule change, no app code).

These raise #8 and the tracking-hardening work to "must ship before a real game" rather than
"nice to have."

---

## Safety nets & invariants

Guardrails that stop the GM (or a flaky network) from breaking a *running* game or losing
track of a person. Two flavors: **integrity invariants** the backend enforces so a running
game can't be corrupted, and **player-welfare nets** that protect people in the field. The
ones marked **(safety-critical)** should ship before a real game, alongside the
Pingo-replacement hardening above. Schema/enforcement detail is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) §12.

### Integrity invariants — a running game can't be corrupted

- **Always ≥ 1 GM.** Block removing or demoting the last GM of a game (last-GM check in
  `firestore.rules` on member delete / role-change, plus a disabled UI control with a
  reason). A game with no GM is unwinnable and unwatched.
- **No mid-game player removal — eliminate, don't delete.** Once the game is in `play`,
  member docs are delete-locked; the only way "out" is an elimination (`out`/`cause`), which
  preserves the player's timing, death location, and ration history. Hard deletes are allowed
  only in `setup`/`lobby` (a no-show who never played); hiding a finished game is the existing
  `archived` flag, post-`results`. (Today `removePlayer` has no phase lock — this is the gap.)
- **Elimination is reversible.** A skull button gets mis-tapped. `revivePlayer()` clears
  `out`/`outAt`/`cause` and posts a correcting broadcast ("[X] is back in — disregard"). Pairs
  with winner detection so an accidental kill that ended the game can be unwound.
- **Guarded, monotonic phases.** Phase only advances; the one backward move is the explicit
  `reopenSetup`, which *warns* it resets `startedAt`/timers. End Game is confirm-gated, can't
  fire twice, and can't silently drop `endedAt`.
- **Start-Game preflight.** Refuse (or hard-warn) to start with no boundary, zero
  checkpoints, zero joined players, or **no GM holding a valid FCM token** — otherwise every
  alert the game depends on goes nowhere.
- **Lock interval-defining config during play.** `rationIntervalMinutes`, `durationMinutes`,
  and `startedAt` freeze once `play` begins — changing them mid-game rescrambles the ration
  interval indices and could retroactively starve everyone. Editable only in setup; shown
  disabled with the reason during play.
- **Preserve history on checkpoint edits.** Deleting or moving a checkpoint mid-game keeps
  its `arrivals`; warn if it still has pending run-sheet events pointed at it. Never orphan
  arrival or scheduled-event records.
- **Idempotent destructive server actions.** Winner detection, the starvation sweep, and the
  run-sheet dedupe (deterministic ids / `firedAt`) so a retry or double-trigger can't
  double-kill a player or double-send a death broadcast — an explicit invariant the functions
  are tested against.
- **Late-join lock.** Joining is closed once the game reaches `play` — no exceptions for
  MVP — so an eliminated player can't rejoin under a fresh name to dodge death. (A GM opt-in
  to allow stragglers is a post-MVP knob, not built now.)
- **Confirm fleet-wide destructive broadcasts.** "Void all vouchers / ration cards" and End
  Game take a deliberate two-step confirm and are logged — they alter the game economy or end
  it, and the physical effect can't be undone.

### Player-welfare nets — don't lose a person *(several safety-critical)*

- **SOS can't be silently lost and must be acknowledged. (safety-critical)** Builds on the
  SOS path and the SMS fallback (#3): a raised SOS *persists and escalates* until a GM
  explicitly acknowledges it (`sosAckAt`) — nothing auto-clears it.
- **Can't end the game while someone is unaccounted-for. (safety-critical)** Block End Game
  (hard override only) when a player has an open, unacknowledged SOS or hasn't reported a fix
  in N minutes — don't shut down the only tracking tool while someone might be in trouble.
- **Player-left-the-boundary alert. (safety-critical)** If a tracked player exits the play
  `boundary`, alert the GM (lost / wandered off), distinct from a checkpoint crossing. A
  per-member `outOfBounds` latch fires it once on exit, not every fix.
- **Tracking-stopped self-alarm. (safety-critical)** Detect when a player's background
  location permission is revoked or the task dies; warn the *player* loudly ("you've dropped
  off the GM's map") and flag it on the GM roster — turning the passive stale-fix indicator
  into an active alarm.
- **Low-battery beacon.** Players report battery level with each fix; the GM roster flags a
  player about to go dark (Rule 21) so they can be checked on before they vanish.

The integrity invariants are cheap rules/guards to land *alongside the features they protect*
(elimination, phases, config, join). The safety-critical welfare nets ride the
SOS / offline / stale-fix work already promoted to "must ship before a real game" by the
Pingo consequence above.

---

## Suggested build order

The trap/clock chain is **done**: #10 (district), #12 (site windows), #5 (traps +
same-district suppression), and #11 (run-sheet) are all built; #13 (vouchers) now needs no
code.

**The 2026-06-03 playtest regressions are all cleared** (`16`–`21` built): ration window-gate +
camera fix (`21`), alerts over the app + triggering-player hazard text (`17`), FCM hardening +
keep-tracking-while-locked (`18`), lobby location capture + GM readiness + geofence phase guard
(`16`), refreshed player intro (`19`), and the player Map/Stats split (`20`). **All six still need
on-device verification from a build** — especially the camera launch (`21`) and the locked-screen
tracking/alert path (`16`/`18`). A follow-up review pass then surfaced three ration-loop UX
defects (`22`–`24`: terminal GM approve/reject, viewport-fit scrollable photo review, and
one-submission-per-window pending→approved player state) — **outstanding**, all in the
already-built Rules 6–9 path.

**New top of the list (2026-06-05 tester feedback): the night-before practice game (`15`).**
Bennett wants to start testing with real people, so the disposable dress-rehearsal game is
built **first**, alongside the `25`–`28` **Critical** deploy-blockers it ships through.

After that, the pre-existing tier list, roughly in order: the **safety-critical** hardening `3`
(SOS→SMS fallback) + `8` (offline resilience) — these are the "must ship before the August game"
items — then `1` (auto-starvation sweep, **tester-confirmed wanted**, default stays
`gm-confirmed`), the `4` auto-count sliver, and the rest of **P3** (end-game phase, arena
overlay, and — **deprioritized to the very bottom** — post-game media `14`).

The **safety nets & invariants** land *alongside the features they protect* — the integrity
invariants are cheap rules/guards; the safety-critical welfare nets ride the `3` / `8` /
stale-fix hardening, which (with the Pingo consequence) is "must ship before a real game."
Then the rest of **P3**.

**Cutting across all of the above is the go-live hardening batch (`25`–`39`, code review
2026-06-04).** Independent of the ruleset roadmap, the four **Critical** items (`25` Twilio
secrets, `26` App Check + rate-limit, `27` Maps key restriction, `28` run-sheet index) must be
cleared before a production deploy — `25` and `28` fail at deploy/runtime, `26`/`27` are
security/billing exposure. The **High** items (`29` geofence cost, `30` data retention, `31`
getMyGames N+1, `32` duplicate listeners) should follow before a real event; the Medium/Low
items (`33`–`39`) are correctness/polish that can trail.

**The 2026-06-05 reviewer-pass bugs (`43`, `44`) are correctness regressions** — `43`
(winner-detection crowning a GM) and `44` (player getting the GM push on crossing) should be
fixed before any real game. The **UX items** (`40`–`42`) are quick wins that smooth the
join/list flow; `45` (demo/screenshot parity) gates store submissions and can trail the
bug fixes.

**The 2026-06-05 tester feedback (`46`–`50`)** adds one headline feature and four smaller items.
**`48` (player-visible checkpoints + the A–D visibility/reveal model)** is the big product change
— "the biggest thing to change" — and the most schema/geofence work; it pairs with **`47`** (split
the boundary and checkpoint editors so authoring richer checkpoints isn't fighting the boundary
drag). **`49`** (GM per-player screen) starts with **targeted player messaging** (cheap — the
`targetPlayerId` broadcast path exists) and grows per-player checkpoints / GM↔GM messaging later.
**`50`** (orphaned-game cleanup) rides with the "Always ≥ 1 GM" invariant and `34`. **`46`**
(polygon boundary) is explicitly low priority — the rectangle is fine for now.
