# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are stable and never reused
once an item lands; the list was **renumbered 2026-06-06** (a one-time reset after a large batch
shipped — earlier `#`/`§` numbers are retired and don't map forward) and **trimmed 2026-06-07** when
the batch below shipped (so it opens at Tier 4 / item 11). The **2026-06-07 field test** added items
**48–58**; the P0 playtest fixes (**48–52**), the game-flow items (**55**, **56**), and the
checkpoint-authoring redesign (**53**, **54**) all shipped (see the Built callout), leaving only test
tooling (**58**) and per-GM teams (**57**). A follow-on field-test pass added **59** (a flaky-signal
player bounced to *My Games* every few seconds — fixed, see the Built callout). The
**checkpoint & runbook overhaul** (**60**, Tier 14) has now shipped — a checkpoint shrinks to
name/icon/visibility while all behavior lives in a new per-checkpoint **runbook** of
priority-ranked entries (see the Built callout). Its follow-on **61** retires the web run-sheet UI
(superseded by the Runbook) and tracks the one run-sheet capability the Runbook doesn't yet
cover — clock-triggered actions with no player crossing. A second feedback pass (web + play
testing) added **62–72** — see the dated **Field-test findings — 2026-06-07 (batch 2)** section
below (P0 defects: ration-review false positives, per-runbook-event tripping, broadcast/checkpoint
push reliability; plus validation, boundary-constrained checkpoints, and game cloning). After
deploying that batch, post-deploy testing added **73–77** (**Field-test findings — 2026-06-08, batch
3**): a P0 regression where a runbook entry tripped more than once, GM-prompted notifications missing
from the player feed, a GM notifications page for large games, naming a cloned game, and lingering
closed-phone pass-through flakiness.

> **Built & removed** (retired numbers, never reused — see git history + the
> [README](README.md#features)):
> - **1–10** — Tier 1 deploy blockers (Twilio secrets, run-sheet index), Tier 2 safety
>   (SOS→SMS, offline write queue, persistent SOS + GM ack, End-Game block on unaccounted players,
>   boundary-exit alert), Tier 3 correctness (GM-excluded winner detection, no shared-device
>   double-push, transactional arrival dedup).
> - **17** purge locations/arrivals on game end · **18** `getMyGames` parallelized ·
>   **19** single shared broadcast subscription · **31** coordinate range validation in rules ·
>   **32** SMS rebrand · **34** dropped the unused `arrivals` index.
> - **36–38** Tier 9 UX (game-list sort + `gameDate`, join name prefill, navigate-after-join).
> - **39–40** Tier 10 follow-ons (web polygon authoring; per-player checkpoints + GM↔GM messaging).
> - **13–15** Tier 5 ration review/submit UX (terminal review action, viewport-fit photo review,
>   state-driven `RationPanel`) · **30** single `shouldTrack`-keyed tracking controller ·
>   **33** login loading reset — all found already shipped in the **2026-06-07 audit**.
> - **48–52, 54 (backend), 55, 56** — the **2026-06-07 field-test batch**: **48** stale-marker
>   cleanup at Start + client `visibleFrom` gate; **49** server-side checkpoint **pass-through
>   detection** (path segment `change.before`→`change.after`, 400 m cap, secrecy-preserving);
>   **50** GPS fix-quality gate + N-consecutive-fix debounce; **51** web polygon commit-on-teardown;
>   **52** ration eat-window reminders hoisted to `useRationReminders` (fire regardless of active
>   tab); **54** declarative checkpoint `transitions[]` applied by the run-sheet sweep
>   (`currentState`) + geofence integration; **55** per-player/checkpoint trip latch
>   (`checkpointTrips`) with GM away-cooldown + player state-change re-notify; **56**
>   `autoEndThreshold` (one/zero/manual). Players keep the self mini-map (design decision, no code).
>   **#49 still wants an on-device locked-phone re-test.**
> - **60** — **checkpoint & runbook overhaul** (Tier 14): a checkpoint is now identity +
>   visibility only (`name`/`icon`/geometry/`visibility` = `hidden`/`shown`/`shown-on-trigger`);
>   all behavior moved to a top-level GM-only **`runbook`** collection of priority-ranked
>   entries (`fixed-order`/`always-on`/`timed`/`gm-prompted`, kinds `hazard`/`boon`/`notify`/
>   `gm-notify`). The geofence resolves the single highest-priority matching entry per crossing
>   (preserving pass-through/fix-quality/streak/district/reveal); a new `fireRunbookEntry`
>   callable powers GM-prompted firing with a target picker. Fully replaced `event`/`eventQueue`/
>   `opensAt`–`closesAt`/`initialState`/`transitions`/`currentState` and the run sheet's
>   open/close-site actions. Web gets a standalone **Runbook editor** (`/games/:id/runbook`);
>   mobile is web-first (placement + visibility + read-only entries + fire). A one-time converter
>   (`functions/scripts/migrateRunbook.js`) exists but was **not run** (fresh-start milestone).
> - **59** — **player bounced to "My Games" every few seconds** (2026-06-07 field test, follow-on):
>   the player member-doc listener (`app/(app)/player/game.tsx`) treated *any* `snap.exists === false`
>   as a GM removal and `router.replace`d to the games list. On a weak connection RNFirebase delivers
>   cache-sourced snapshots that momentarily report the player's *own* member doc as absent, so a
>   flaky-signal player was kicked every ~3–5 s (tracking her reconnect cycle) while a well-connected
>   player was unaffected; she could always see her location on re-entry. Fixed by gating the removal
>   on a **server**-confirmed snapshot (`!snap.metadata.fromCache`). Client-only — no rules/functions
>   change. **Code-complete; needs an APK build to reach the field.** (Crashlytics sanity check found
>   no matching crash loop — only two low-volume, unrelated FATALs; see git/console.)
> - **53, 54 (authoring UI)** — **checkpoint authoring redesign**: the map screen
>   (`gm/[gameId]/checkpoints.tsx`) now only *places* checkpoints (name + icon + radius); a new
>   full-screen behavior editor (`gm/[gameId]/checkpoint/[checkpointId].tsx`) owns event/queue,
>   visibility/reveal, the timed window, and the **#54** transition schedule ("Starts as" +
>   timed "changes over time"); the run sheet lists checkpoints as the behavior hub. Adds a
>   `Checkpoint.icon` picker (`constants/checkpointIcons.ts`), a shared `components/checkpointForm.tsx`,
>   and `gameService.stateEventFields` (makes a scheduled checkpoint's initial state effective at
>   start; the sweep handles later transitions).

---

## Field-test findings — 2026-06-07 (batch 2, web + play feedback)

Defects and gaps from testing the web dashboard and the app. Priority tags inline (P0 = fix
before the next real game; P1 = before wider testing; P2 = polish). Schema/enforcement detail for
the data-model items is in [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) under the same numbers.

**62. Audit the `/demo` screen for parity with recent releases.** *(P2)* The `/demo` screenshot
mocks (`web/src/screens/DemoScreen.tsx`) drifted from shipped features — notably the **#60
checkpoint/runbook overhaul** (checkpoints are now identity+visibility; behavior lives in the
Runbook) and **terminal ration approval** (no GM undo; player "fed this window" state). Walk each
mocked screen against the live app and refresh copy/controls/layout so store screenshots are honest.

**63. Numeric-field validation + cross-field sane bounds.** *(P1)* No number field should accept `0`
(or negative), and dependent fields must stay ordered. Concretely:
  - **ration window ≤ ration interval ≤ total game length** (today the window is clamped to the
    interval, but the interval isn't bounded by game length, and several fields accept 0).
  - Checkpoint **radius ≥ 10 m** (already enforced on create — extend everywhere, incl. edit).
  - Game **duration**, **ration interval**, **ration window**, **geofence confirm-fixes**,
    **re-notify cooldown**, **trip interval (#67)**, **reveal offset minutes** — all `> 0` with
    sensible minimums, validated in *both* the web `ConfigModal`/editors and the mobile equivalents,
    with inline reasons (not just silent clamping). Audit `types/index.ts` numeric config + every
    `<input type="number">` for the same gaps.

**64. Constrain checkpoints to the play boundary.** *(P1)* A GM must not be able to place (or
drag) a checkpoint outside the set boundary. On map-click placement and on edit, reject/snap-back a
coordinate that fails the point-in-boundary test (reuse the geofence `pointInBoundary`: polygon when
≥3 verts, else bbox), with a clear "outside the play area" message. If no boundary is set yet,
either require one first or warn. Applies to both web and mobile placement flows.

**65. Clone a game (setup only).** *(P1)* A "Clone" action on a game creates a fresh game that
copies the **boundary**, **checkpoints**, and their **runbook entries** (the checkpoint behavior),
plus the game **rules/config knobs** — and copies **nothing runtime/participant**: no members,
locations, arrivals, rations, `checkpointTrips`, scheduled-event `firedAt`, winner, or timestamps.
New game starts in `setup` with fresh player/GM codes and the cloner as sole GM. (Open decision noted
in the data model: whether rules/config travel with the clone — default **yes**, since the ask is to
re-run the same setup.)
> **Built (2026-06-07):** `cloneGame` callable (`functions/src/games.ts`) copies boundary + rules +
> config + checkpoints (new ids) + runbook (re-keyed); resets all runtime/participant state; fresh
> codes; cloner = sole GM; starts in `setup`. `gameDate` is **not** carried (a clone is a new event).
> "Clone" action wired into the web games list and the mobile games action sheet.

**66. Ration review shows no players before the window opens.** *(P0)* The GM ration feed's "Not
eaten this window" list (web `RationsModal`, mobile `rations.tsx`) populates for the *whole interval*,
but the capture **window** only opens in the last `rationWindowMinutes`. Before the window opens,
nobody is late — the list must be empty (and the header should read "window opens in …"), gated on
the actual open time, not just the interval index.
> **Built (2026-06-07):** "Not eaten this window" now gates on `rationInterval().isOpen` (web
> `RationsModal` + mobile `rations.tsx`); the web header shows "window not open yet" until it opens.

**67. Treat each runbook event independently, with a periodic re-trip cadence.** *(P0)* Today the
geofence latches per **player × checkpoint** (`checkpointTrips`) and delivers a single highest-priority
effect per crossing — so a player who already tripped a checkpoint won't receive a *different* runbook
entry that becomes live later. Change to: dedup per **player × runbook entry** (a player can trip a
given entry at most once); while a player is inside a checkpoint, re-evaluate eligible entries on a
**GM-managed cadence (`tripIntervalMinutes`, default 2)** so a newly-live timed/queued entry gets
tripped on the next tick even without leaving and re-entering. Preserves pass-through, fix-quality,
district suppression, and reveal behavior. See data model for the per-entry latch + config.
> **Built (2026-06-07):** geofence now dedups per **player × runbook entry** (latched once in
> `entryTrips/{playerId}_{entryId}`) and fires **one entry per tick** — the highest-priority eligible
> entry the player hasn't tripped. The rest dole out over time: a lingering player is re-evaluated
> every `GameConfig.tripIntervalMinutes` (default 2, GM-set in the web Game settings — the "2-minute
> rule"), so a stack of events on one checkpoint is delivered one per tick rather than all at once.
> Arrival ordinal is latched on `checkpointTrips` for consistent fixed-order slots. Pass-through /
> fix-quality / district suppression / reveal preserved; `entryTrips` is admin-only in the rules and
> purged on game end.

**68. Server-enforce unique ration card numbers.** *(P1)* With `enforceUniqueRationCards` on, the
player can still submit an already-used card number (the GM only sees a "reused" flag after the fact).
Block it at submission: reject a duplicate (valid/pending) card number for the game server-side
(callable or `submitRation` guard / Firestore rule), with a clear player-facing error, so the dupe
never lands. Keep the GM flag as a backstop.

**69. Broadcasts must push to closed/backgrounded phones.** *(P0)* The GM "Broadcast to players"
writes a `broadcasts/*` doc directly from the client with **no Cloud Function**, so it only surfaces
in-app — a closed phone gets nothing. Add an `onBroadcastCreate` Firestore trigger (or route
`sendBroadcast` through a callable) that sends FCM to living players' tokens on the `broadcasts`
channel, honoring `targetPlayerId` (single recipient) and skipping `audience: 'gm-only'` co-GM
messages. Ensure the payload shows when backgrounded (notification, not data-only).
> **Built (2026-06-07):** `onBroadcastCreate` (`functions/src/broadcasts.ts`) pushes player-facing
> broadcasts (all living players, or `targetPlayerId`); skips co-GM (`gm-only`) and server-written
> docs (those are stamped `pushed: true` in geofence/runbook/run-sheet/death so there's no double-push).

**70. Checkpoint-event modal must survive a dismissed push.** *(P0)* If a player dismisses a
checkpoint/event push while outside the app, opening the app should still surface the relevant modal.
Drive the in-app modal from **unacknowledged** `broadcasts`/event docs (a per-player `ackedAt` /
seen-set), not from the push tap — so dismissing the OS notification never loses the event. Ties to
#71 (the player ack/dismiss model).
> **Built (2026-06-07):** `AlertOverlay` now persists dismissals per game (AsyncStorage
> `acked_broadcasts_{gameId}`); unacked broadcasts re-pop when the app reopens (so a closed-phone
> event still shows), and the first open on a device seeds the existing backlog as handled so history
> isn't replayed. Local-only — no `Broadcast.dismissedBy` server field needed; the cross-device server
> ack model is deferred to #71.

**71. Players can dismiss notifications from the in-app list.** *(P2)* Give players a way to clear
items in their notification/broadcast list (per-player dismissed set or `ackedBroadcasts`), so the
list reflects what they've handled. Shared ack model with #70.

**72. Make the ration-window-open notification reliable.** *(P1)* The "window is open" alert
(scheduled local notification, `useRationReminders`) often fires **2–3 minutes late**, risking
wrongful starvation. Investigate OS scheduling drift / re-scheduling on config change; consider a
**server push** at the window boundary (a scheduled function, like `runScheduledEvents`) as the
source of truth instead of (or alongside) the on-device local notification.

---

## Field-test findings — 2026-06-08 (batch 3, post-deploy testing)

From testing the deployed #65–#70 batch. Priority tags inline.

**73. A runbook entry tripped more than once.** *(P0 — regression)* A single runbook entry fired
**3×** for one player, but #67's contract is *each entry trips at most once per player* (the
`entryTrips/{playerId}_{entryId}` latch, created atomically). Re-test post-deploy (the report may
straddle the 2026-06-07 functions deploy), and if it reproduces, audit every path that delivers an
effect for one that bypasses the `entryTrips.create()` dedup — e.g. the confirmed-crossing vs.
re-eval paths both firing, concurrent `onLocationUpdate` invocations racing before the latch commits,
or an effect dispatched without a corresponding `entryTrips` create. The latch is the single source
of truth; nothing should push a player effect without first winning the `create`.

**74. GM-prompted player notification doesn't appear in the player's notification list.** *(P1)*
Firing a `gm-prompted` runbook entry at a player pushes/broadcasts, but the message isn't showing in
the player's in-app notification feed (it should). `fireRunbookEntry` writes a `kind:'checkpoint-event'`
broadcast with `targetPlayerId` (or null) + `pushed:true`; the player's `BroadcastsContext` subscribes
to `targetPlayerId == null || == uid`, so it *should* surface. Investigate: confirm the broadcast doc
is written for the targeted case, that `BroadcastFeed`/`broadcastVisuals` render `checkpoint-event`
(not just hazard/boon/death), and that a `gm-notify`-kind entry (GM-only, no player broadcast) isn't
being conflated with a player-facing one in the test.

**75. GM notification feed: cap the sidebar, add a full notifications page.** *(P2)* With ~24 players
the Play-view **Notifications** list (`NotificationFeed`, web `GameScreen` `PlayView`) gets crowded.
Show only the **last 4** in the sidebar, and make the **"Notifications" header a button** that opens a
full, scrollable notifications page/modal (all arrivals + runbook events, ideally filterable by
player/checkpoint/kind). GM dashboard only; no schema change.

**76. Name the cloned game.** *(P2 — extends #65)* Cloning currently auto-names the new game
`"<source> (copy)"`. Let the GM enter the new game's name before cloning — a small prompt/modal (web
`GamesScreen`, mobile games action sheet) feeding the existing `cloneGame({ name })` argument, which
the callable already accepts.

**77. Closed-phone pass-through still unreliable.** *(P1 — #49 follow-up)* A player walked most of the
way through a large (100 m radius) checkpoint with the phone locked and only got the alert when they
**opened the phone**. Server-side pass-through (#49) tests the prev→curr segment against each radius,
but a locked phone may emit **no** background fix across the whole transit (OS throttling), so there's
no segment to test until the app foregrounds. Investigate: background-location cadence/`deferred`
settings on a locked device, whether a larger `MAX_SEGMENT_METERS` or distance-filter tuning helps,
and whether the foreground-resume fix should retro-test the gap. Needs an on-device locked-phone
re-test (the #49 caveat).

---

## Tier 4 — Core ration loop

**11. Auto-starvation sweep.** Scheduled function: at each interval boundary, mark any living
player with no valid submission for the prior window as dead (death broadcast already built).
Gated by `starvationMode`; default stays `gm-confirmed` (GM flips to `auto`) until the photo path
is field-proven. Tester-confirmed wanted.

**12. Auto per-interval "N remaining" broadcast.** A config toggle that seeds repeating
player-count entries each ration interval, so the GM needn't add each run-sheet row by hand.
Low priority — depends on #61 (timed actions are not yet authorable now that the run-sheet UI is gone).

---

## Tier 14 — Runbook follow-ons

**61. Timed, crossing-independent actions in the Runbook.** The web **run-sheet UI was removed**
(the Runbook supersedes per-checkpoint behavior), but the run-sheet also carried **time-triggered
actions that fire on a clock, with no player crossing** — which the Runbook's `timed` trigger does
*not* cover (a `timed` runbook entry only gates a *crossing* effect to a window). The orphaned
capabilities (still fired by the `runScheduledEvents` sweep over `games/{id}/scheduledEvents`, and
still authorable on the **mobile** run-sheet) are:
  - **Timed announcement** — a game-wide broadcast at `+Nm`.
  - **Auto living-player-count broadcast** — the `player-count` template ("N tributes remain").
  - **Gear-drop announcement** — a themed timed broadcast.
  - **GM-only timed reminder** — a nudge to the GMs, players see nothing.

  (Timed **checkpoint reveal** is *not* lost — it's covered by the checkpoint's own reveal config,
  `reveal.trigger: 'timed'` + `offsetMinutes`.) Fold these into the Runbook editor — e.g. a timed
  entry with no `checkpointId`, or a dedicated "Scheduled announcements" pane — so a GM keeps the
  capability from the web dashboard, then retire the orphaned backend/mobile run-sheet (and revisit
  #12, #44, which assume run-sheet rows).

---

## Tier 6 — Cost, privacy & performance (before a real event)

**16. Cache game-phase/member-role in `onLocationUpdate`.** The lobby short-circuit, zero-checkpoint
skip, and checkpoint cache shipped, but the trigger still reads the game doc **and** the member doc
on every location write. Cache phase/role (short TTL, like the checkpoint cache) to cut the
remaining per-write reads. Model cost at expected player counts before launch.

---

## Tier 7 — Integrity invariants (land alongside the features they protect)

Backend guards so a running game can't be corrupted.

**20. No mid-game player removal.** In `play`, member docs are delete-locked; the only way out is
an elimination (`out`/`cause`), preserving timing/death-location/ration history. Hard deletes only
in `setup`/`lobby`. (`removePlayer` has no phase lock today — the gap.)

**21. Reversible elimination.** `revivePlayer()` clears `out`/`outAt`/`cause` and posts a
correcting broadcast; if an accidental kill had ended the game, return `results → play`.

**22. Guarded, monotonic phases.** Phase only advances; the lone backward move is `reopenSetup`
(warns it resets `startedAt`/timers). Confirm remaining gaps are closed.

**23. Full Start-Game preflight.** Refuse/hard-warn to start with no boundary, zero checkpoints,
zero joined players, or no GM holding a valid FCM token (the partial fix-warning exists).

**24. Lock interval-defining config during play.** Freeze `rationIntervalMinutes`,
`durationMinutes`, `startedAt` once `play` begins — changing them rescrambles ration intervals and
could retroactively starve everyone. Editable only in setup, shown disabled with a reason.

**25. Warn on checkpoint edits with pending run-sheet events.** A deleted/moved checkpoint already
keeps its `arrivals` (independent docs) and its paired reveal row is cleaned up; the remaining gap is
warning the GM when other pending run-sheet events (open/close/reveal) still point at it, so none are
left dangling.

**26. Idempotent destructive server actions.** Winner detection, the starvation sweep (item 11),
and the run-sheet dedupe must be safe under retry/double-trigger (deterministic ids / `firedAt`),
tested as an explicit invariant.

**27. Late-join lock.** Joining closes once the game reaches `play` (no exceptions for MVP), so an
eliminated player can't rejoin under a fresh name. (GM opt-in for stragglers is post-MVP.)

**28. Confirm fleet-wide destructive broadcasts.** "Void all vouchers / ration cards" and End Game
take a two-step confirm and are logged.

---

## Tier 8 — Robustness & polish

**29. Handle the sole-GM case in `deleteAccount`.** Membership deletes are already chunked into
≤450-write batches; the remaining gap is the *sole GM* of a game — deleting them orphans it (players
remain, no GM). Transfer GM, or server-side end the game.

**35. Low-battery beacon.** Players report battery level with each fix; the GM roster flags a
player about to go dark (Rule 21) so they can be checked on before they vanish.

---

## Tier 13 — Test tooling

**58. Single-game test checklist.** A documented checklist (ideally backed by a one-tap "seed test
game" helper) covering everything to configure in one game to exercise the full feature surface:
every checkpoint type/function and timed transition, the key game settings, and the ration check in
its **unique-card (most restrictive)** mode — since a single game can only run one ration-card mode.
Lets a tester validate everything in a single sitting.

---

## Tier 11 — P3 polish

**41. End-game phase.** Add an `endgame` phase between `play` and `results` (e.g. a final
convergence / sudden-death window) the GM triggers, so the app models the schedule's end-game block.

**42. Custom arena map overlay.** Let the GM upload the arena map image as a map overlay instead of
relying only on generic tiles + the boundary (Rule 33).

**43. Night-before practice game.** A disposable, badged, re-runnable on-site dress-rehearsal game
(`game.practice`) with a one-tap "drop test checkpoint here", relaxed safety guards, and a GM
readiness view — exercises joins/tracking/events/pushes end-to-end. *Deprioritized:* slot in just
ahead of the first real rehearsal, not ahead of everyday APK work.

**44. Voucher-site run-sheet preset.** Vouchers are paper/in-person, so the app mints nothing — a
voucher site is just a time-windowed checkpoint with announcing run-sheet rows. A one-tap "voucher
site" preset that scaffolds the open/close/announce rows is the only (optional) work.

**45. Post-game media.** After `results`, let a GM attach a YouTube recap + Google Photos album on
the game doc (`media` object); a Cloud Function pushes "recap is up" to everyone but the setter;
results screens show outbound Watch/View links. *Lowest priority* — stitching footage happens well
after the event.

**57. Per-GM teams.** With multiple GMs, each GM owns a team of players and only watches / tracks /
notifies (and sends updates to) their own set. Needs per-member team assignment and notification /
map filtering by team. *Recorded for a later tier per the 2026-06-07 field test — not in the current
trusted-APK milestone.*

---

## Deferred — public launch / app-store gating

Only matter when going **wide** (public store listing / large distribution); they do **not** block
the functional APK.

**46. App Check enforcement.** The per-UID `joinGameByCode` throttle (`enforceJoinRateLimit`) is
already in place; the remaining gap is App Check: `functions/src/games.ts` has
`ENFORCE_APP_CHECK = false`. Before a public launch, register App Check on both platforms, verify
real builds get tokens, then flip the flag.

**47. Restrict the Google Maps API keys.** `app.json` ships Maps keys in the binary — lock each to
its bundle ID / SHA-1 and the Maps SDK in Cloud Console before wide release. Console/ops task, no code.

---

## Suggested order

0. **Field-test batch 2:** the P0s (**66, 67, 69, 70**) and **65** (clone) are **built + deployed**
   (rules/web/functions, 2026-06-08); mobile-side pieces (#66 mobile, #70, mobile clone) await the
   next APK. Remaining batch-2: P1s **63, 64, 68, 72** and P2s **62, 71**.
0b. **Field-test batch 3** (post-deploy): fix **73** first (P0 — a runbook entry trips more than
   once), then **74** (GM-prompted not in player feed) and **77** (closed-phone pass-through); **75**,
   **76** are P2 dashboard/clone polish.
1. **Tier 4** (11–12) completes the ration loop; **Tier 14** (61) restores timed announcements in
   the Runbook (the web run-sheet UI was removed alongside #60).
2. **Tier 6** (16) trims the last geofence read cost; **Tier 7** (20–28) — integrity invariants —
   land alongside the features they protect.
3. **Tier 8** (29, 35) trails as robustness/polish.
4. **Tier 13** (58) — test tooling; useful throughout, build when convenient.
5. **Tier 11** (41–45, 57) is P3 polish (43/45 and per-GM teams deprioritized).
6. **Deferred** (46–47) waits for a real public-store launch.
