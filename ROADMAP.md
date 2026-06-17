# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are **stable and never
reused**; a shipped item moves to the **Built & removed** callout below (one-line summary; full
detail in git + the README) rather than being renumbered. The build-out **through Tier 7 has
shipped** (see the callout) — the outstanding work is the field-test item **#77**, a few
cost/robustness items (Tiers 4/6/8), test tooling (#58), and P3 polish (Tier 11).

> **Built & removed** (retired numbers, never reused — one-line summaries; full detail in git
> history + the [README](README.md#features)):
> - **1–10** — Tier 1–3 deploy/safety/correctness: Twilio secrets, run-sheet index, SOS→SMS, offline
>   write queue, persistent SOS + GM ack, End-Game unaccounted block, boundary-exit alert, GM-excluded
>   winner detection, shared-device push dedup, transactional arrival dedup.
> - **13–15, 17–19, 30–34, 36–40** — ration review/submit UX; location/arrival purge on end;
>   parallelized `getMyGames`; shared broadcast sub; single tracking controller; login-loading reset;
>   coordinate-range rule validation; SMS rebrand; index trims; Tier 9 UX (list sort + `gameDate`,
>   join prefill, navigate-after-join); Tier 10 (web polygon authoring, per-player checkpoints,
>   GM↔GM messaging).
> - **48–56** — **2026-06-07 checkpoint/field-test batch**: authoring redesign (place vs. behavior
>   editor, `Checkpoint.icon`); early-reveal markers + `visibleFrom`; server pass-through detection;
>   GPS fix-quality gate + N-fix debounce; web polygon commit-on-teardown; `useRationReminders`;
>   `checkpointTrips` re-notify/cooldown latch; `autoEndThreshold`.
> - **59** — player no longer bounced to "My Games" on a cache-sourced `exists:false` (gated on a
>   server-confirmed snapshot).
> - **60** — **checkpoint & runbook overhaul**: checkpoint = identity + visibility; all behavior in a
>   top-level GM-only `runbook` of priority-ranked entries (`fixed-order`/`always-on`/`timed`/
>   `gm-prompted`; `hazard`/`boon`/`notify`/`gm-notify`). Geofence delivers the highest-priority match;
>   `fireRunbookEntry` callable; web Runbook editor. Schema lives in `types/index.ts`.
> - **65–70, 73, 76** — `cloneGame` + Clone UI; ration "not eaten" gated on `isOpen`; per-entry
>   `entryTrips` latch (one entry per `tripIntervalMinutes`); closed-phone GM-broadcast push
>   (`Broadcast.pushed`); `AlertOverlay` re-pop; GM `NotificationFeed` from `entryTrips`.
> - **63, 64, 68, 72, 74** — shared `common/` helpers (`pointInBoundary`, `validateGameConfig`);
>   numeric config validation + ordering; out-of-boundary placement guard; `submitRation` callable +
>   unique-card enforcement (`rations` `create` now locked to `if false`); `rationPings` + idempotent
>   latch; gm-notify fire warning.
> - **62, 75, 71, 11, 61** — `/demo` refresh for the runbook model; capped Play-view feed + "See all"
>   modal; `Broadcast.dismissedBy` player dismiss; `starvationSweep` auto-elimination (opt-in
>   `starvationMode:'auto'`, idempotent latch, purged on end); web "Scheduled announcements" pane.
> - **20–28** — **Tier 7 integrity invariants** (no new schema): late-join lock; member delete-lock in
>   `play` + `deleteAccount` scrub-and-eliminate; deterministic `broadcasts/{userId}_death` toll;
>   shared `startPreflight`; interval-config freeze (client + rules); `revivePlayer` (+ `results→play`
>   reopen); guarded monotonic phase helpers; dangling-reveal warning; End-Game confirm + audit log.
> - **Mobile client halves** of #20–25, #63/#64/#66/#70/#71/#74, #11, and mobile Clone ship in the
>   **2026-06-17 APK** — the server/web/rules sides of all of these are already deployed.

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

0. **Verify the 2026-06-17 APK** once it's installed: smoke-test the mobile halves now riding it
   (#20–25 integrity UI, #63/#64/#66/#70/#71/#74, #11, mobile Clone), then run the **#77**
   closed-phone pass-through test on a locked device — the one outstanding field-test defect, held
   for exactly this on-device check.
1. **Tier 4** (12) — the auto per-interval count — is the small ration-loop follow-on now that #11
   (auto-starvation) and #61 (scheduled announcements) have shipped.
2. **Tier 6** (16) trims the last geofence read cost (and now pairs with the #20/#24 rules, which
   add a game-doc `get()` on some writes).
3. **Tier 8** (29, 35) trails as robustness/polish.
4. **Tier 13** (58) — test tooling; useful throughout, build when convenient.
5. **Tier 11** (41–45, 57) is P3 polish (43/45 and per-GM teams deprioritized).
6. **Deferred** (46–47) waits for a real public-store launch.
