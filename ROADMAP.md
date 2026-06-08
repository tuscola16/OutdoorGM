# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are **stable and never
reused**; when an item ships it moves to the **Built & removed** callout below (one-line summary;
full detail in git + the README) rather than being renumbered. Recently shipped: the **#60 runbook
overhaul**, the **2026-06-07/08 field-test batch** (#65–#70, #73, #76), the **P1 field-test
batch** (#63/#64/#68/#72/#74), and the **2026-06-08 polish + ration-loop batch** (#62/#75/#71/#11/#61) —
all in the callout below. **Outstanding field-test item #77** leads the next section; older tiers
(integrity invariants, polish) follow.

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
> - **53, 54** — **checkpoint authoring redesign**: the map screen only *places* checkpoints (name +
>   icon + radius); a full-screen behavior editor (`gm/[gameId]/checkpoint/[checkpointId].tsx`) owns
>   visibility/reveal, the timed window, and #54's declarative `transitions[]` (applied by the
>   run-sheet sweep + geofence). Adds `Checkpoint.icon` (`constants/checkpointIcons.ts`) + a shared
>   `components/checkpointForm.tsx`.
> - **48–52, 55, 56** — **2026-06-07 field-test batch**: stale-marker cleanup at Start + `visibleFrom`
>   gate (#48); server-side checkpoint **pass-through detection** (prev→curr segment, 400 m cap) (#49);
>   GPS fix-quality gate + N-fix debounce (#50); web polygon commit-on-teardown (#51); eat-window
>   reminders hoisted to `useRationReminders` (#52); per-player `checkpointTrips` latch with GM
>   away-cooldown + player state-change re-notify (#55); `autoEndThreshold` one/zero/manual (#56).
>   **#49 still wants an on-device locked-phone re-test** (now tracked as #77).
> - **59** — **player bounced to "My Games" on a weak connection**: the player member-doc listener
>   treated a cache-sourced `snap.exists === false` as a GM removal and kicked the player. Fixed by
>   gating removal on a server-confirmed snapshot (`!snap.metadata.fromCache`). Client-only; **rides
>   the next APK.**
> - **60** — **checkpoint & runbook overhaul** (Tier 14): a checkpoint is now identity + visibility
>   only; all behavior moved to a top-level GM-only **`runbook`** collection of priority-ranked entries
>   (`fixed-order`/`always-on`/`timed`/`gm-prompted`; kinds `hazard`/`boon`/`notify`/`gm-notify`). The
>   geofence resolves the highest-priority matching entry per crossing; a `fireRunbookEntry` callable
>   powers GM-prompted firing. Web gets a standalone Runbook editor (`/games/:id/runbook`); mobile is
>   web-first (place + visibility + read-only + fire). The one-time converter
>   (`functions/scripts/migrateRunbook.js`) was **not run** (fresh-start).
> - **65–70, 73, 76** — **2026-06-07/08 field-test batch** (rules/functions/web deployed; mobile-only
>   pieces await the next APK): `cloneGame` callable + Clone UI with new-game naming (#65/#76); ration
>   "not eaten" gated on `rationInterval().isOpen` (#66); per-**entry** trip latch
>   `entryTrips/{playerId}_{entryId}` firing one entry per `tripIntervalMinutes` tick (#67);
>   `onBroadcastCreate` pushes GM broadcasts to closed phones via `pushed:true` (#69); `AlertOverlay`
>   persists per-game dismissals so a closed-phone event re-pops (#70); GM `NotificationFeed` derives
>   events from `entryTrips` (#73). **Mobile pieces awaiting APK: #66 gating, #70, mobile Clone.**
> - **63, 64, 68, 72, 74** — **P1 field-test batch (2026-06-08)** (web + functions + rules deployed;
>   mobile halves await the next APK). Shared `common/` helpers — `pointInBoundary` (`geo.ts`) +
>   `validateGameConfig` (`gameConfigValidation.ts`), imported by web (`@shared/common/*`) and mobile
>   (`@/common/*`). #63 numeric validation + ordering (window ≤ interval ≤ game length; reveal offset
>   > 0) replacing silent clamps; #64 placement guard rejecting out-of-boundary/no-boundary
>   checkpoints; #68 `submitRation` callable enforcing unique card numbers (`already-exists`; client
>   surfaces + de-queues) — **the `rations` create-rule lock is deferred until the new APK ships**; #72
>   `rationPings` per-minute push with an idempotent `rationWindowPings/{i}` latch; #74 a gm-notify
>   (GM-only) fire warning in the web Runbook editor + mobile fire modal. **Mobile halves: #63/#64/#74
>   + the #68 callable client/ration-queue change.**
> - **62, 75, 71, 11, 61** — **2026-06-08 polish + ration-loop batch** (web + functions + rules
>   deployed; mobile halves await the next APK). **#62** refreshed the `/demo` mocks for the #60
>   runbook model + a themed events-vs-arrivals GM feed. **#75** capped the Play-view Notifications
>   sidebar to 4 (`NotificationFeed` `max` prop) with a "See all" header button opening the full,
>   filterable feed in a modal. **#71** added `Broadcast.dismissedBy` + a player self-update rule
>   (dismiss-only, own-uid via `arrayUnion`) + `dismissBroadcast` + an in-list ✕ on `BroadcastFeed`
>   (mobile). **#11** `starvationSweep` — per-minute auto-elimination at each ration boundary, gated
>   behind `starvationMode:'auto'` (default stays manual `gm-confirmed`), idempotent
>   `starvationSweeps/{i}` latch (purged in `cleanup.ts`), letting `onMemberWrite` handle the death
>   toll + winner; web + mobile config toggles. **#61** a web Runbook **"Scheduled announcements"**
>   pane over the existing `scheduledEvents`/`runScheduledEvents` sweep (announcement / player-count /
>   gear-drop / GM reminder, `offsetMinutes > 0` via shared `requirePositiveInt`). **Mobile halves
>   awaiting APK: #71 in-list dismiss, #11 config toggle.**

---

## Field-test findings (2026-06-07 → 06-08) — outstanding

Defects and gaps from testing the web dashboard and the app; the built items from these passes are
in the Built & removed callout above. Priority tags inline (P0 = before the next real game; P1 =
before wider testing; P2 = polish). Schema detail is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) under the same numbers.

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

**12. Auto per-interval "N remaining" broadcast.** A config toggle that seeds repeating
player-count entries each ration interval, so the GM needn't add each scheduled-announcement row by
hand. Now trivial since #61 shipped the web "Scheduled announcements" authoring over
`scheduledEvents` — this just auto-seeds a `player-count` row per interval. Low priority.

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

**26. Idempotent destructive server actions.** Winner detection, the starvation sweep (#11, now
built with a per-interval `starvationSweeps/{i}` latch), and the run-sheet dedupe must be safe under
retry/double-trigger (deterministic ids / `firedAt` / create-if-absent latches) — tested as an
explicit invariant rather than relying on incidental idempotency.

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
   on-device locked-phone test) before the next APK build. (The built batches — #65–#70, #73, #76,
   #63/#64/#68/#72/#74, and #62/#75/#71/#11/#61 — are deployed; their mobile-only pieces ship with
   the next APK.)
1. **Tier 4** (12) — the auto per-interval count — is the small ration-loop follow-on now that #11
   (auto-starvation) and #61 (scheduled announcements) have shipped.
2. **Tier 6** (16) trims the last geofence read cost; **Tier 7** (20–28) — integrity invariants —
   land alongside the features they protect.
3. **Tier 8** (29, 35) trails as robustness/polish.
4. **Tier 13** (58) — test tooling; useful throughout, build when convenient.
5. **Tier 11** (41–45, 57) is P3 polish (43/45 and per-GM teams deprioritized).
6. **Deferred** (46–47) waits for a real public-store launch.
