# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are **stable and never
reused**; when an item ships it moves to the **Built & removed** callout below (context preserved)
rather than being renumbered. Recently shipped: the **#60 checkpoint & runbook overhaul** and the
**2026-06-07/08 field-test batch** (#65–#70, #73, #76 — game cloning, ration-window gating,
per-runbook-event tripping, broadcast push, persistent event modal, accurate GM feed) and the
**P1 field-test batch #63/#64/#68/#72/#74** (numeric validation, boundary-constrained checkpoints,
server-enforced unique ration cards, reliable ration-window push, GM-prompted notification fix). The
outstanding field-test items (#62, #71, #75, #77) are in the section below; older
tiers (run-sheet follow-on #61, ration loop, integrity invariants, polish) follow.

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
> - **65–70, 73, 76** — **2026-06-07/08 field-test batch** (built + deployed: rules/functions/web;
>   the mobile-only pieces — #66 mobile gating, #70, mobile Clone — await the next APK): **65**
>   `cloneGame` callable (copies boundary + checkpoints + runbook + config; fresh codes; `setup`
>   phase; no runtime/participant state) + web/mobile Clone, with **76** new-game naming; **66**
>   ration "not eaten" gates on `rationInterval().isOpen`; **67** per-**entry** trip latch
>   (`entryTrips/{playerId}_{entryId}`) firing **one entry per `tripIntervalMinutes` tick** (the
>   "2-minute rule"), arrival ordinal latched on `checkpointTrips`; **69** `onBroadcastCreate` pushes
>   GM broadcasts to closed phones (server paths stamp `pushed:true` to avoid double-push); **70**
>   `AlertOverlay` persists per-game dismissals so a closed-phone event re-pops on reopen; **73** GM
>   `NotificationFeed` derives events from `entryTrips` (accurate, deduped) + neutral arrivals
>   (replacing the old "label every arrival by `checkpointKind`" that mislabeled arrivals as hazards).
>   `entryTrips` is GM-readable in the rules and purged on game end.
> - **63, 64, 68, 72, 74** — **P1 field-test batch (2026-06-08)**. Shared groundwork: a client
>   `pointInBoundary` (`common/geo.ts`) and a pure `validateGameConfig` (`common/gameConfigValidation.ts`),
>   both imported by web (`@shared/common/*`) and mobile (`@/common/*`). **63** numeric-field
>   validation + cross-field ordering (`window ≤ interval ≤ game length`, timed-reveal offset > 0) with
>   inline reasons replacing silent clamps in the web `ConfigModal`/`CheckpointBehaviorModal` and the
>   mobile config + checkpoint editor; **64** placement guard rejecting an out-of-boundary (or
>   no-boundary) checkpoint on web `SetupView.handleMapClick` + mobile `checkpoints` long-press; **68**
>   `submitRation` callable enforcing unique ration card numbers in a transaction (`already-exists`
>   rejection; client surfaces it + drops it from the offline retry queue) — **the `rations` create-rule
>   lock is deferred until the new APK ships** (the installed APK still writes directly); **72** new
>   `rationPings` scheduled function (per-minute) pushing the window-open alert authoritatively with an
>   idempotent `rationWindowPings/{intervalIndex}` latch (admin-only rule; purged on game end), the
>   local notification kept as fallback; **74** the GM-prompted "player saw nothing" case was a
>   `gm-notify` (GM-only) effect — added a clear warning in the web Runbook editor + mobile fire modal
>   (a targeted `notify`/`hazard`/`boon` already reaches the player). **Deployed: web + functions +
>   rules** (minus the #68 create-rule lock); **mobile halves (#63/#64/#74 + the #68 callable client +
>   ration-queue change) ride the next APK.**

---

## Field-test findings (2026-06-07 → 06-08) — outstanding

Defects and gaps from testing the web dashboard and the app; the built items from these passes are
in the Built & removed callout above. Priority tags inline (P0 = before the next real game; P1 =
before wider testing; P2 = polish). Schema detail is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) under the same numbers.

**62. Audit the `/demo` screen for parity with recent releases.** *(P2)* The `/demo` screenshot
mocks (`web/src/screens/DemoScreen.tsx`) drifted from shipped features — notably the **#60
checkpoint/runbook overhaul** (checkpoints are now identity+visibility; behavior lives in the
Runbook) and **terminal ration approval** (no GM undo; player "fed this window" state). Walk each
mocked screen against the live app and refresh copy/controls/layout so store screenshots are honest.

**71. Players can dismiss notifications from the in-app list.** *(P2)* Give players a way to clear
items in their notification/broadcast list. #70 shipped a **device-local** dismissed set
(`AlertOverlay`); this item adds an explicit in-list dismiss control and (optionally) a cross-device
server model (`Broadcast.dismissedBy`) so a dismissal syncs across a player's devices.

**75. GM notification feed: cap the sidebar, add a full notifications page.** *(P2)* With ~24 players
the Play-view **Notifications** list (`NotificationFeed`, web `GameScreen` `PlayView`) gets crowded.
Show only the **last 4** in the sidebar, and make the **"Notifications" header a button** that opens a
full, scrollable notifications page/modal (all arrivals + runbook events, ideally filterable by
player/checkpoint/kind). GM dashboard only; no schema change. (Builds on #73's `entryTrips`-driven feed.)

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

0. **Field-test follow-ups (outstanding):** P1 **77** (closed-phone pass-through — held for an
   on-device locked-phone test) before the next APK build; P2s **62, 71, 75** as polish. (The built
   batches — #65–#70, #73, #76 and #63/#64/#68/#72/#74 — are deployed; their mobile-only pieces ship
   with the next APK.)
1. **Tier 4** (11–12) completes the ration loop; **Tier 14** (61) restores timed announcements in
   the Runbook (the web run-sheet UI was removed alongside #60).
2. **Tier 6** (16) trims the last geofence read cost; **Tier 7** (20–28) — integrity invariants —
   land alongside the features they protect.
3. **Tier 8** (29, 35) trails as robustness/polish.
4. **Tier 13** (58) — test tooling; useful throughout, build when convenient.
5. **Tier 11** (41–45, 57) is P3 polish (43/45 and per-GM teams deprioritized).
6. **Deferred** (46–47) waits for a real public-store launch.
