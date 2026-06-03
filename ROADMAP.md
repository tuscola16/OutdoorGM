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
> Item numbers (`#1`–`#14`, `§`-refs) are **stable** and shared with ROADMAP_DATA_MODEL.md —
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
> editor). The run-sheet (#11) flips these on schedule.

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
- **Post-game media — recap video + photo album (#14)** — once a game is complete
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
- **Night-before test game (practice mode) — #15** — instead of a static pre-game checklist,
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
tracking/alert path (`16`/`18`).

With the playtest batch done, what remains is the pre-existing tier list, roughly in order: the
**safety-critical** hardening `3` (SOS→SMS fallback) + `8` (offline resilience) — these are the
"must ship before the August game" items — then `1` (auto-starvation sweep), the `4` auto-count
sliver, and **P3** (end-game phase, post-game media #14, arena overlay, and the #15 night-before
test game).

The **safety nets & invariants** land *alongside the features they protect* — the integrity
invariants are cheap rules/guards; the safety-critical welfare nets ride the `3` / `8` /
stale-fix hardening, which (with the Pingo consequence) is "must ship before a real game."
Then the rest of **P3**.
