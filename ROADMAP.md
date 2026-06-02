# Outdoor GM — Enhancement Roadmap

Derived directly from the game ruleset (single-elimination, last-one-alive combat
survival event) and mapped onto the existing architecture (game phases, `GameContext`,
Firestore subcollections, the geofence Cloud Function). Tiers are by criticality:
**P0** items are mechanics the game *cannot run on the app without*; lower tiers are
field robustness and polish.

> See [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for why the prior, generic
> "team-based scavenger" framing was reprioritized for this specific game. Data-model
> detail for each item lives in [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md).

## Implementation status (this branch)

Landed (compiles; app `tsc` + functions build green):

- **`game.config`** schema + `gameConfig()` resolver and `rationInterval()` math
  (`types/index.ts`, `services/gameService.ts`).
- **Broadcasts** end-to-end: `broadcasts` collection, rules, `GameContext` listener,
  `sendBroadcast()`, a player-facing `BroadcastFeed` component (wired into the player
  screen), and a GM composer modal + quick "living-player count" action.
- **Elimination + winner + SOS** (server-authoritative): `eliminatePlayer()`,
  `raiseSos()`/`clearSos()`, `setDeathLocation()`, and the `onMemberWrite` Cloud Function
  (death broadcast, winner detection → `results`, SOS push to GMs). Player screen now has
  "I've been killed" (honor system) + a safety-alert button.
- **Checkpoint-triggered events**: `Checkpoint.event` schema + the geofence function routes
  `beast-attack`/`gear-drop`/`announcement`/`silent-alert` by audience to broadcasts/pushes.

Also landed (second pass — no new native deps):

- **GM elimination + SOS controls** (`gm/[gameId]/players.tsx`): per-player eliminate
  (skull), live SOS highlight + clear, dead/alive badges, and an "N alive" count.
- **Game clock / countdown** (P1 #6): `useRemaining()` hook; player screen leads with
  "TIME LEFT" + elapsed subline; GM stats bar shows Remaining / Alive / Active / Arrivals.
- **Death-drop gear pin** (P2 #9): player's last position is stamped on death
  (`setDeathLocation`), rendered as skull markers on the GM map (`GameMap` `deathMarkers`).
- **Per-GM config screen** (P3): a "Game settings" modal in setup — duration, auto
  player-count, winner detection, battery saver — persisted to `game.config`.
- **Battery-aware tracking** (P2 #7): `startLocationTracking({ batterySaver })` uses
  balanced accuracy + 15s/30m cadence when enabled; player reads it from `game.config`.

Landed (ration mechanic — meal/food photo loop; **needs a dev-client rebuild** for the
new native deps before it runs on device):

- **Ration photo capture/upload** (`components/RationPanel.tsx`): per-window countdown,
  live-camera-only capture (`expo-image-picker`), upload to Firebase Storage
  (`services/storage.ts` + `@react-native-firebase/storage`), card-number entry, and
  submission status. Wired into the player play screen, gated on `config.rationsEnabled`.
- **GM ration review feed**: mobile (`app/(app)/gm/[gameId]/rations.tsx`, reached from a
  header button with a pending badge) and web (`RationsModal` in `web/.../GameScreen.tsx`,
  opened from the Play sidebar). Photo thumbnails + lightbox, valid/reject, a "who hasn't
  eaten this window" glance, and a reused-card-number flag (manual Rule 6 enforcement).
- **Config knobs** surfaced in both GM settings modals: ration on/off, window length,
  unique-card enforcement.
- **Storage backend**: `storage.rules` (member-scoped ration-photo access) + a `storage`
  block in `firebase.json`; tightened the Firestore `rations` create rule.

Still deferred (intentionally): the **scheduled auto-starvation** Cloud Function. Today the
GM eliminates missed players by hand from the review feed (the "not eaten this window"
glance feeds this). Holding the timed sweep until the photo path is field-tested avoids
wrongly starving everyone on a flaky-signal day.

Not yet done:

- **Offline resilience** (P2 #8 — now safety-critical, see the Pingo consequence note),
  **graceful SMS fallback for SOS**, **custom arena map overlay** (P3, needs storage),
  **sponsorship tracking** (P3), **post-game media — recap video + photo album** (P3 #14).
- **Pingo reconciliation**: decided — Outdoor GM replaces it (no code; rewrite Rule 26).

Landed (Pingo-replacement hardening):

- **Stale-fix indicator**: per-player "last fix Xm ago" + color dot in the GM roster
  (`players.tsx`), and a "N players not reporting" warning chip on the GM map screen that
  deep-links to the roster. Backed by `hooks/useNow.ts` + `services/locationStatus.ts`.
  Marker bitmaps stay static (avoids the Android marker-thrash crash).

## Cross-cutting theme: per-GM configurability

Almost every mechanic below needs config knobs on the game doc. Today `game.rules` is
just free text. Add a structured **`game.config`** object so the base rules are
*defaults a GM can override*: ration interval length, game duration, starvation
auto/manual, which checkpoints fire which events, broadcast cadence, etc. The
"base game rules" remain the seed values for a new game.

## Cross-cutting theme: the game runs on a clock

A real event (see the run-of-show below) is a **timeline of timed actions**: voucher
sites open and close at set times, gear drops land at named locations on schedule, the
living-player count goes out every interval, and the GM gets reminders to physically move
between sites. Last year this was a paper/spreadsheet schedule run by hand. Two structural
consequences for the data model:

- Checkpoints/voucher sites need an optional **active window** (`opensAt`/`closesAt`) — a
  geofence crossing only fires while the site is live.
- A **scheduled-events engine** (#11) fires broadcasts, opens/closes windows, and pings the
  GM at clock times — the in-app replacement for the spreadsheet.

## Cross-cutting theme: tributes belong to districts

The base game pairs players into **districts** (two tributes each). Several rules key off
this — most concretely the trap rule *"do not give a trap if both tributes from the same
district arrive together."* District is a first-class member attribute (#10), surfaced on
the GM roster and consumed by the checkpoint/trap logic (#5).

---

## P0 — Blockers (core loop & win condition)

### 1. Ration-card survival loop — *the heartbeat of the game*
**Rules 6–9.** Every 30-min window each player photographs a numbered ration card and
sends it to the GM, or **dies of starvation**. The app has nothing for this today.

- **Player:** a per-interval "Submit ration" action that captures a timestamped photo and
  uploads it (Firebase Storage) to `games/{id}/rations/{playerId}/{intervalIndex}`.
- **GM:** a verification feed — incoming photos per player per window, mark valid/invalid,
  and a glance view of who hasn't eaten this window.
- **Auto-starvation:** a Cloud Function (scheduled at each interval boundary) marks any
  living player with no valid submission as dead → triggers death broadcast (#2).
- **Config:** interval length (default 30 min), starvation auto vs. GM-confirmed, whether
  ration photos must be unique (Rule 6, "may only be used once").

### 2. Elimination state, death broadcast & winner detection — *the win condition*
**Rules 1, 2, 8, 14, 16, 23, 32.** "Last one alive wins"; deaths are broadcast.

- Reframe the existing **"I'm Out"** (`markPlayerOut`) into an honor-system
  **"I've been killed"** self-report (Rule 16).
- **GM-initiated elimination** for starvation (Rule 8), bad sportsmanship (Rule 14),
  stealing a drop (Rule 32), or player-to-player comms (Rule 23).
- **Death broadcast** to all players: "[X] has fallen — N tributes remain."
- **Winner detection:** when one living player remains, surface a win state → move the
  game to `results`.
- Builds on existing `member.out`/`outAt`; add `cause` and a broadcast write.

### 3. Safety SOS / "I need help" — *non-negotiable*
**Rules 22, 27, 28.** Players must be able to reach the GM if unsafe/injured/cold.

- A prominent panic button → high-priority push/SMS to the GM with the player's live
  location.
- A "tap out (cold / safe retreat)" variant distinct from a combat death.
- Low effort, high stakes — a 3.5-hour outdoor combat event can't responsibly run
  without it.

---

## P1 — The defining experience

### 4. GM one-way broadcast + auto player-count updates
**Rules 23, 24, 32.** GM→player is the *only* allowed channel (player↔player is bannable —
do **not** build player chat).

- Broadcast to all (gear-drop locations, announcements) **and targeted-to-one** messages
  (Rule 32: drops marked for a specific person).
- Auto "**N players remaining**" push every interval (Rule 24).
- New `games/{id}/broadcasts` collection; players see a read-only message feed (replaces
  the dead "waiting" screen).

### 5. Checkpoint-triggered events & traps
The geofence Cloud Function already fires on checkpoint entry. Extend an arrival to fire a
**GM-authored event** instead of just an alert.

- Per-checkpoint config: event type (`beast-attack`, `gear-drop`, `trap`, `announcement`,
  `silent-alert`), payload text, and audience (the crossing player, all players, GM-only).
- Checkpoints here are often **hazards**, not objectives — a crossing may push
  "A beast attacks! Defend or flee" to that player and notify the GM.
- **Traps are assigned by arrival order.** A site holds an **ordered queue** of distinct
  traps; the *Nth tribute to arrive* gets the Nth trap (last year: Orenda Cabin handed out
  three different traps to the 1st/5th/6th arrivers). So a checkpoint needs a **list** of
  events consumed by arrival ordinal, not a single payload. The geofence function must rank
  arrivals per checkpoint to pick the right entry.
- **Same-district suppression** (the explicit trap rule): if two tributes from the **same
  district** arrive at a site together (within a short co-arrival window), the trap is
  **withheld**. Requires district (#10) + a time-window check in the geofence function.
- **Time-gated** (#12): a site only fires while it is live (`opensAt`/`closesAt`), so
  voucher windows and trap sites can open and close on the schedule.

### 6. Game clock & ration-window countdown
**Rules 5–7.** Replace the count-up elapsed timer with a **3.5-hour countdown** plus a
**rolling 30-min ration-window indicator** ("eat within 7:42"). GM gets the same clock
plus per-player window status. Configurable duration/interval.

### 10. District / tribute identity
The base game pairs tributes into **districts**. Add a `district` attribute to each member
(set by the GM when seeding players, or chosen on join with GM confirmation). Surface it on
the GM roster (group/sort by district, show the pairing) and expose it to Cloud Functions so
the trap co-arrival rule (#5) and any district-aware broadcasts can use it. Foundational for
#5; cheap on its own.

### 11. Scheduled-events engine (the run-sheet)
The whole event is a **timed script** (open Orenda voucher site at 12:45, close 12:55; Drop
1 → Trestle Bridge 13:00; push "N remaining" every interval; remind the GM to walk to the
next site). Build an in-app **run-sheet**: a list of scheduled actions on the game doc, each
with a fire time (absolute clock time or offset from `startedAt`) and an action:

- `broadcast` (free text or templated, e.g. living-player count),
- `open-site` / `close-site` (toggle a checkpoint's active window, #12),
- `gear-drop` reveal (announce a drop location),
- `gm-reminder` (GM-only nudge: "send Aaron to The Dock now").

A scheduled Cloud Function (or a foreground GM-side timer with a server backstop) fires due
actions. The GM authors the run-sheet in setup; firing one is idempotent (dedupe on a
`firedAt` stamp). This is the concrete replacement for last year's spreadsheet and the
unifying home for voucher windows (#13), timed drops, and the per-interval count push (#4).

---

## P2 — Field robustness

### 7. Battery-aware tracking
**Rule 21** (charge phones, bring batteries). 3.5 hrs of 10s/20m GPS uploads is brutal.
Add coarser cadence when stationary and a low-power mode; show a battery note.

### 8. Offline / poor-signal resilience
Outdoor venues drop signal. Queue location/ration writes and flush on reconnect so a dead
zone doesn't equal a missed ration (= wrongful starvation death).

### 9. Death-drop gear pin
**Rules 19, 20.** On death, prompt the player to drop a pin where they left their
pack/weapons so the GM can recover it; show these pins on the GM map. Cheap given the
location infrastructure already exists.

### 12. Timed checkpoint / site windows
Add optional `opensAt`/`closesAt` to a checkpoint so a site is only **live** during its
window. The geofence function ignores crossings outside the window; the player map can show
"opens at 12:45 / closing soon." Drives voucher sites and time-gated trap sites, and is the
toggle the run-sheet (#11) flips with `open-site`/`close-site`.

### 13. Voucher sites & sponsor-gear redemption
Promoted from the old P3 "sponsorship" bucket — last year ran **five live voucher windows**.
A voucher site is a time-windowed checkpoint (#12); arriving while it's live grants a voucher
/ sponsor-gear claim. Track redemptions (`games/{id}/vouchers` or a claim on the arrival) so
the GM sees who claimed what and a player can't double-claim a closed site. Pairs with the
timed gear drops (Drop 1/Drop 2) the run-sheet announces.

---

## P3 — Polish & admin

- **Per-GM config screen** — surface all the knobs above (the cross-cutting theme made
  concrete).
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
- **Pre-game ops checklist** — the schedule front-loads manual ops (alarm, car departures,
  briefing, bandanas, seed sponsor gear, pre-place ration bags). A short GM run-up checklist
  + a player onboarding screen (install, "Always" location, join code) covers it; ties to the
  Pingo-onboarding note below. A roaming helper ("send Aaron to X") is just a `gm-reminder`
  in the run-sheet (#11) — no separate role needed unless we want a distinct GM-helper seat.
- ~~Reconcile the Pingo redundancy~~ — **DECIDED: Outdoor GM replaces "Find My Kids by
  Pingo".** Only one location app runs. Rule 26 should be rewritten to onboard Outdoor GM
  the night before instead of Pingo. See the consequence note below.

---

## Consequence of replacing Pingo (sole location & safety tool)

Outdoor GM is now the **only** thing tracking players and the only channel to reach the
GM. That promotes two items from "robustness" to **load-bearing / safety-critical**:

- **Location reliability & background tracking** must be rock-solid — a player who
  force-quits, loses permission, or drops signal silently disappears from the only map
  anyone has. Add a GM-visible **"stale fix" indicator** (last-seen age per player) so the
  GM can tell "stopped moving" from "stopped reporting."
- **Offline / poor-signal resilience (P2 #8)** is no longer just about gameplay fairness —
  it's a safety gap. Queue-and-flush location writes, and the **SOS path** should degrade
  gracefully (e.g. fall back to SMS if push/Firestore is unreachable).
- **Onboarding**: since setup moves into Outdoor GM, the night-before flow now means
  installing the app, signing in, granting **"Always" location**, and joining the game
  code — worth a short pre-game checklist screen.

These don't change the P0 ordering, but they raise P2 #8 and the tracking-hardening work
to "must ship before a real game" rather than "nice to have."

---

## Suggested build order

`3` (safety, cheap) → `2` (elimination/broadcast plumbing) → `1` (ration loop, reuses 2's
broadcast) → `4` → `6` → `10` (district, cheap, unblocks traps) → `12` (site windows) →
`5` (checkpoint events/traps — needs 10 + 12) → `11` (run-sheet — drives 4/12/13) →
`13` (vouchers) → rest of P2 → P3.

Items **2** and **4** share the broadcast pipeline, so build them adjacently to save work.
Items **10 → 12 → 5** are a dependency chain for the trap mechanic; **11** is the scheduler
that everything timed (4, 12, 13, drops) hangs off, so land it once site windows exist.
