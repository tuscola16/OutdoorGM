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
code. What remains, roughly in order: the **safety-critical** hardening `3` (SOS→SMS fallback)
+ `8` (offline resilience) — these are the "must ship before the August game" items — then
`1` (auto-starvation sweep), the `4` auto-count sliver, and **P3** (end-game phase, post-game
media #14, arena overlay, and the #15 night-before test game).

The **safety nets & invariants** land *alongside the features they protect* — the integrity
invariants are cheap rules/guards; the safety-critical welfare nets ride the `3` / `8` /
stale-fix hardening, which (with the Pingo consequence) is "must ship before a real game."
Then the rest of **P3**.
