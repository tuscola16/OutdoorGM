# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are **stable and never
reused**; a shipped item moves to the **Built & removed** callout below (one-line summary; full
detail in git + the README) rather than being renumbered. The build-out **through Tier 7 plus all
field-test findings has shipped** (see the callout) — the outstanding work is the open half of
**#82** (location jitter, from the 2026-09-04 game) and **#83** (mobile GM feed), P3 polish
(Tier 11 — **#57** per-GM teams), plus the deferred public-launch gating (#46/#47).

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
> - **12, 16, 29, 35, 58** — **"harden for the first real event" batch**: auto per-interval
>   "N remain" broadcast (seeded at Start when `playerCountBroadcast` is on); geofence game-doc +
>   member-doc short-TTL caches (cuts per-write reads); sole-GM `deleteAccount` rescue
>   (`transferGmOrEndGame` promotes the longest-tenured player or ends the game); low-battery beacon
>   (`PlayerLocation.battery`, GM roster/map flag); single-game test checklist (`TESTING_CHECKLIST.md`).
> - **41–45** — **Tier 11 P3 polish batch**: `endgame` phase (GM-placed convergence rally in
>   `markers`, rations auto-off, geofence/tracking stay live, broadcast + banners); custom arena
>   `mapOverlay` (web upload + 4-corner georeference, web true-quad raster render, mobile bbox
>   `Overlay`, `storage.rules` overlay path); night-before practice game (`Game.practice`/
>   `Checkpoint.test`, `createGame` flag, PRACTICE badges, relaxed #20/#22/#28 guards + rules
>   carve-out, drop-test-checkpoint, `resetPracticeGame`, auto-delete on end, GM readiness view);
>   voucher-site run-sheet preset (scaffolds open/close/announce rows); post-game `media` (GM
>   attaches host-validated YouTube + Google Photos links on results, `onGameMediaWrite` pushes
>   all-but-setter, results screens link out). Schema in `types/index.ts`; `common/mediaLinks.ts`.
> - **81** — **last-tribute winner on results**: the sole survivor is stamped on the game doc
>   (`winnerId`/`winnerName`, denormalized because players can't read other members) on the
>   `status → ended` transition — winner detection (`members.ts`) stamps it in its transaction on the
>   auto (last-death) path, and the game-end chokepoint (`cleanupRationPhotosOnGameEnd`) fills it in for
>   the manual GM **End Game** path when exactly one player is left. The mobile player results screen
>   reads it: "YOU WON 🏆" for the winner, who-won for everyone else. Functions pending deploy; the
>   results UI rides the next APK.
> - **80** — **per-entry player targeting + reveal-on-fire**: a runbook entry can name the players
>   who may trip it (`RunbookEntry.playerIds`; anyone else crossing falls through to the next entry,
>   and a `gm-prompted` entry defaults its recipients to that list), and can reveal its checkpoint on
>   the player map when it fires (`revealOnFire: 'triggerer'|'targeted'|'all'` → the existing
>   `markers` projection, so the site stays visible for the rest of the game). Geofence +
>   `fireRunbookEntry` honor both; authored in the web Runbook editor, read-only on mobile.
> - **77, 78, 79** — **2026-06-18 field fixes**: #77 closed-phone tracking traced to Android battery
>   optimization/Doze (reproduced on a stock Pixel 8) — added a battery-optimization exemption flow
>   (`services/batteryOptimization.ts`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, lobby "Background
>   activity — Unrestricted" row, play-screen warn banner, `batteryOptimized` diagnostic); #78 ration
>   panel un-stuck after submit (Firestore `rations` read allowed when `resource == null`, so the
>   player's pre-create listener isn't denied); #79 joining a `setup`-phase game now says "not open
>   yet" vs "already started". Rules + functions deployed; the mobile battery flow rides the 2026-06-18 APK.

---

## Field-test findings

**82. Location jitter — players "all over the map" when the phone locks.** Reported after the
2026-09-04 game: with a phone pocketed and screen-locked, players teleport around the GM map.

*Cause.* Android's fused provider falls back to Wi-Fi/cell trilateration once the screen locks —
field-measured ~52 m accuracy while walking, and one stationary Pixel 8 reporting 22 m accuracy
while sitting ~64 m off. Every such fix moves the dot, because the client writes each fix
unconditionally and `minFixAccuracyMeters` gates only *checkpoint evaluation*, not the write.

> **Built (2026-09-05), recording + display only — the upload path and geofence are untouched:**
> - **Diagnostic capture.** `PlayerLocation.speed` / `.mocked` / `.steps` ride every fix through all
>   three upload paths; `locationTrail` also records `stepsSincePrev` to pair against
>   `metersSincePrev`. `speed` is the network-fallback tell (Doppler-derived, so a trilaterated fix
>   usually reports none) and is a better "is this fix real?" discriminator than `accuracy`.
> - **Step counting** (`services/stepCounter.ts`, `expo-sensors`). **Recording only — nothing reads
>   it for any decision.** Hardware step counter, not the accelerometer: both platforms count on a
>   low-power coprocessor that survives Doze and app suspension for <1%/day, whereas sampling accel
>   ourselves needs the CPU awake, which is exactly what we lack when pocketed. Fail-soft
>   throughout; started fire-and-forget *after* the location grant so the optional
>   `ACTIVITY_RECOGNITION` prompt never precedes the critical one, and re-armed inside the
>   background task because that task can run in a fresh JS context after a process recycle.
> - **Display-side jump suppression** (`common/locationStabilizer.ts`, wired into both GM contexts).
>   Holds a fix only when it is **both** implausibly fast (>7 m/s) **and** lower-quality than what's
>   displayed, hard-capped at 60 s. Deliberately in the read path, not the write path: suppressing
>   writes would change `change.before` for #49 pass-through detection (altering **checkpoint
>   firing**) and would blind `locationTrail`. `StabilizedLocation` extends `PlayerLocation`, so
>   existing consumers are unaffected.

**Outstanding under #82:**

- **Render the confidence data.** `confidenceM` / `stale` / `held` reach both maps but nothing draws
  them yet — no accuracy circle, no stale dimming. This is the half that makes the map *honest*
  rather than merely calmer, and it's where we should deliberately **not** copy Strava: their live
  Beacon view shows last-known-position and says so, but their recorded track is smoothed post-hoc
  with future data, which a live GM map can never do.
- **Tune the gate from real data.** The 7 m/s and 60 s constants are guesses — loose on purpose,
  since a teleport detector that never false-fires beats a smoother we can't calibrate. Re-derive
  them from a `locationTrail` capture (walk a known route pocketed + locked, with a control
  recording in Strava on the same handset, plus a stationary segment where all movement is error).
- **Fix the clock-skew in staleness.** `ageMs` subtracts a Firestore *server* timestamp from the
  GM device's `Date.now()`, so a skewed GM clock marks everyone permanently stale or never stale.
  Harmless until the staleness UI ships; must be fixed before it does.
- **Capture-layer suspects, if the trail shows gaps rather than scatter.** A foreground service does
  *not* keep the CPU awake; `expo-location` has a known issue where updates batch to minutes after
  5–10 min of sleep; `foregroundServiceType="location"` on Android 14+; and OEM battery allowlists
  (which Strava benefits from and we never will) — which is what the #77 exemption flow compensates
  for. **Verifying that #77 grant on every player's phone is worth more than any of this code.**
> **Built (2026-09-05b) — the motion gate, plus the iOS crash that blocked it:**
> - **`NSMotionUsageDescription` was missing from `app.json`.** `expo-sensors` is not in `plugins`
>   and the key was never declared, so `Pedometer.requestPermissionsAsync()` hit
>   `EXMotionPermissionRequester.m:28` → `RCTFatal` → **process abort**. A native abort, so the
>   fail-soft `try/catch` in `stepCounter.ts` could not catch it. It fires from
>   `startLocationTracking()` *and* from the background task's re-arm, i.e. **every iPhone would
>   have crashed on entering play, and again on each background process recycle**. Android was
>   unaffected — `expo-sensors` ships its own manifest declaring `ACTIVITY_RECOGNITION`, which is
>   why the APK never showed it. The step counter therefore has **never** run on iOS; no shipped
>   build has collected an iPhone step.
> - **Motion gate** (`contradictsSteps` in `common/locationStabilizer.ts`). Holds a fix when the
>   displacement exceeds what the player's own steps could produce
>   (`Δsteps × MAX_STRIDE_M 1.5 + STEP_GATE_SLACK_M 25`). A *bound*, never a dead-reckoned
>   position — it refuses coordinates, it never invents them — and it sits in the read path beside
>   the speed gate, so arrivals stay server-authoritative and no player can trip a site they
>   didn't reach. Fails open on every unknown: no pedometer, declined permission, pre-#82 client,
>   or a negative delta (a counter reset, not backwards walking). A fix carrying Doppler `speed`
>   is exempt, so a vehicle ride doesn't freeze anyone.
> - **Why it earns its place:** the speed gate cannot catch the reported failure. Its quality
>   clause requires the incoming fix to look *worse*, and the field-observed Pixel 8 sat 64 m off
>   while claiming 22 m accuracy. A pedometer reading zero doesn't care what the fix claims.
> - **`StabilizedLocation.heldReason`** (`'steps' | 'speed' | null`) records which gate fired, so
>   the constants can be re-derived from a capture rather than argued about.

> **Built (2026-09-05c) — the first field trail, and what it overturned.** `locationTrail`
> captured 126 fixes over 17 minutes with two players. The results **retired the motion gate before
> it ever shipped** and redirected the whole item:
> - **The confound was screen state, not the handset.** One tester checked their phone repeatedly;
>   the other never unlocked theirs. Median accuracy **12.9 m vs 38.4 m**, on the same walk in the
>   same woods. Doze depth tracks how long a device sits untouched — the checked phone's background
>   fixes were still good because it never settled. This was invisible in the data and only surfaced
>   in conversation, which is why `appState` / `msSinceForeground` are now recorded per fix.
> - **The motion gate would have been actively harmful.** Replayed against the trail it holds
>   **556 m** of one player's real movement and **980 m** of the other's (69% of their total).
>   Android batches step delivery, so `stepsSincePrev` reads 0 on ~70% of fixes mid-walk; on the
>   locked phone the listener never fired at all. Its fail-open guard checks for *missing* steps and
>   cannot distinguish "sensor reporting a stale 0" from "stood still". **Deleted, not tuned.**
> - **The jump is the correction.** Of 13 fixes implying >7 m/s, **11 arrived with accuracy
>   improving** (one was 133 m away with accuracy going 102 m → 6 m). The dot leaps because GPS
>   reacquires and snaps back to truth, so holding the incoming fix keeps the player *wrong* for
>   longer. The speed gate fired on only 2 of the 13 — it is a backstop, not the mechanism.
> - **The step counter was never broken — it was unread.** The hardware counted correctly
>   throughout; the locked phone's backlogs flushed as **367 / 211 / 319 / 147** steps on each wake.
>   `watchStepCount` simply doesn't deliver in the background. Rewritten to **poll** the cumulative
>   counter (native `TYPE_STEP_COUNTER` shim on Android, CMPedometer's historical query on iOS).
> - **`speed` absence is not the network-fallback tell.** Android reports `0`, never null — zero
>   missing values across 126 fixes. The value is still useful; the earlier schema note was wrong.
> - **Cadence is unchanged and still the binding constraint.** A 3 s request delivered at a
>   **14–18 s median** with ~90 s maxima. At walking pace that is a sample every 20–25 m — you
>   cannot reconstruct a path you never sampled.

> **Built (2026-09-05d) — the six changes under test in the next build:**
> - **Accuracy gate replaces the motion gate** (`tooInaccurate`, `GameConfig.maxDisplayAccuracyMeters`,
>   default 80 m). Rejects the *bad* fix rather than the correction after it — the move the data
>   supports. Chosen from the trail: p90s were 89 m and 116 m, so 80 m keeps ordinary pocketed fixes
>   and drops the 89–203 m outliers that caused the visible teleporting.
> - **Partial CPU wake lock** (`modules/outdoor-native`, `GameConfig.wakeLockEnabled`, default off).
>   A foreground service does **not** keep the CPU awake and `expo-location` holds no lock (verified:
>   zero `PowerManager` references in its Android source). **The one capture-layer variable** — leave
>   the rest of the location request alone while measuring it. Config-gated so both A/B arms come out
>   of a single walk.
> - **Step counter polls instead of listening**, per the finding above.
> - **Capture context per fix**: `appState`, `msSinceForeground`, `batteryOptimized`, `wakeLock`.
>   These exist so the next walk is never again confounded by something only a conversation revealed.
> - **Motion gate deleted**; `heldReason` is now `'accuracy' | 'speed'`.

**Outstanding under #82 (continued):**

- **The uncertainty-circle rendering is cancelled** — a product decision, 2026-09-05. `confidenceM`
  and `stale` still reach both maps and remain useful for tuning, but nothing will draw them.
- **Off-trail woods bounds what is achievable.** The game is played wandering through unmapped
  forest, so map matching is out (no path network to snap to) and canopy multipath is a physical
  floor on accuracy. The realistic ceiling for "where did they go" is post-hoc: pedestrian-motion
  smoothing weighted by 1/accuracy², run forwards *and* backwards, anchored to step-derived total
  distance. Not built.
- **Fix the clock-skew in staleness.** `ageMs` subtracts a Firestore *server* timestamp from the GM
  device's `Date.now()`, so a skewed GM clock marks everyone permanently stale or never stale.
  Lower priority now the circles are cancelled, but `stale` is still exported.
- **Verify the #77 battery grant per phone.** Now quantified: letting a device settle roughly
  triples median error, and suppresses step delivery at the same time — one root cause, two
  symptoms. Note `isBatteryOptimized()` fails *open*, so "all set" in the lobby can mean "unreadable"
  rather than "exempt".
- **`locationTrail` retention.** Excluded from end-of-game cleanup by design; delete the
  subcollection after each analysis.

**83. GM push fired on every checkpoint crossing.** Reported 2026-09-05: the GM's phone buzzed for
plain "reached <checkpoint>" arrivals, burying the pushes that actually needed a response.

> **Built (2026-09-05):**
> - **Push is trip-gated.** A confirmed crossing still writes its `arrivals` doc, but only enters
>   the push/SMS path when a runbook entry actually fires (`hazard` / `boon` / `notify` /
>   `gm-notify`) — or when a district co-arrival withholds a trap (#5), which stays notified because
>   it's an exception, not routine traffic. A crossing that fires nothing is recorded and silent, and
>   the function now short-circuits before reading GM member docs, so it costs fewer reads too.
> - **The web feed splits alerts from history.** The compact Play-view sidebar drops `arrival` rows,
>   so it mirrors exactly what reached the GM's phone; every crossing stays in the "See all" modal
>   under its **Arrivals** filter, and the button carries the arrival count so the GM has a cue that
>   crossings are happening at all.
> - **Retired `reNotifyAwayCooldownMinutes` (#55).** It existed only to throttle the *bare arrival*
>   push on a re-crossing; with bare arrivals silent it had no effect left. The gate and its config
>   read are gone; the field is kept `@deprecated` in `types/index.ts` so legacy game docs still
>   typecheck.

**Outstanding under #83:**

- **Mobile GM feed still lists every arrival.** `app/(app)/gm/[gameId]/index.tsx` renders
  `<AlertFeed arrivals={arrivals} />` unsplit, and its unseen-alert badge counts `arrivals.length`,
  so it now increments for crossings that never pushed. Mirror the web split when the mobile feed
  next gets attention.
- **Not yet field-verified.** Confirming a bare crossing goes silent while a hazard still pushes
  needs a device inside a checkpoint radius; it has only been typechecked and reasoned through.

---

## Tier 11 — P3 polish

> **Built (2026-06-17):** #41 end-game phase, #42 arena overlay, #43 practice game, #44 voucher
> preset, and #45 post-game media all shipped — see the Built & removed callout. The server/web/
> rules sides are deploy-ready; the mobile halves ride the next APK. Only #57 remains below.

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

0. **Verify the 2026-06-18 APK** once it's installed (clean-install — uninstall the old app first):
   confirm the **#77** battery-optimization fix (grant "Background activity — Unrestricted" in the
   lobby, then lock the phone untouched ~3 min and confirm the player stays live on the GM map and
   checkpoints fire), **#78** (submit a ration → panel flips to "waiting for GM"), and **#79** (join a
   `setup`-phase game → "not open yet" message). Also smoke-test the mobile halves from the prior APK
   (#20–25 integrity UI, #63/#64/#66/#70/#71/#74, #11, mobile Clone). Use
   [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) (#58) for a full single-game surface pass.
1. **Tier 11** (41–45, 57) is P3 polish (43/45 and per-GM teams deprioritized).
2. **Deferred** (46–47) waits for a real public-store launch.
