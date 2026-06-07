# Implementation Plan — P0 Field-Test Fixes (#48–52) & Tier 12 (#53–56)

> Handoff plan for a fresh session. Item numbers match [ROADMAP.md](ROADMAP.md) /
> [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md). Read those two first for the *why*; this
> doc is the *how* — root causes (with `file:line`), the fix, files to touch, schema deltas,
> and verification. Built on a code read of the repo as of this commit.

## Orientation — how the relevant pieces fit

- **Geofencing is server-side polling, not OS geofencing.** Players upload location to
  `games/{gameId}/locations/{userId}` ([services/locationTask.ts](services/locationTask.ts));
  the `onLocationUpdate` Firestore trigger
  ([functions/src/geofence.ts](functions/src/geofence.ts)) runs Haversine against every
  checkpoint on each write and records an `arrivals` doc + fires pushes. **An arrival can
  only fire if a location write lands while the player is inside the radius.**
- **Players never read `checkpoints`** (GM-only). They read `games/{gameId}/markers`
  (`RevealedMarker`, label+location only). The server "projects" a marker when a checkpoint
  becomes visible: `'always'` at Start ([functions/src/markers.ts](functions/src/markers.ts)
  `onGameStartProjectMarkers`), `game-time` via the run-sheet sweep
  ([functions/src/runsheet.ts](functions/src/runsheet.ts) `reveal-checkpoint`), `on-crossing`
  in the geofence, `gm-manual` via `revealCheckpointNow`. The player map renders `markers`
  ([app/(app)/player/game.tsx:147](app/(app)/player/game.tsx)).
- **Run-sheet** = `games/{gameId}/scheduledEvents` (`ScheduledEvent`), swept every minute by
  `runScheduledEvents`. It already does `open-site`/`close-site`/`reveal-checkpoint`/
  broadcasts. This is the natural home for time-based behavior (#54).
- **Checkpoint authoring** today is a **modal** in
  [app/(app)/gm/[gameId]/checkpoints.tsx](app/(app)/gm/[gameId]/checkpoints.tsx) (map +
  per-checkpoint event/visibility/reveal/window). The **run sheet** is a separate screen
  [app/(app)/gm/[gameId]/runsheet.tsx](app/(app)/gm/[gameId]/runsheet.tsx) whose per-action
  editor is itself a modal. Web mirrors this in
  [web/src/screens/GameScreen.tsx](web/src/screens/GameScreen.tsx).
- **Types** live in [types/index.ts](types/index.ts) (shared with `web/` via `@shared`).
  `functions/` can't import them, so each function file re-declares mirror types — **update the
  mirrors too** when you change a shared type.
- There is already a **guided Test Event** scaffold (`Game.isTest`,
  [app/(app)/gm/[gameId]/test.tsx](app/(app)/gm/[gameId]/test.tsx),
  [functions/src/rearm.ts](functions/src/rearm.ts)) — relevant to the later #58 testing
  checklist, and useful for exercising these fixes.

**Build/deploy/verify loop** (see [RUNNING.md](RUNNING.md), [CLAUDE.md](CLAUDE.md)):
`npm run lint`; functions `cd functions && npm run build`; deploy
`firebase deploy --only functions` / `--only firestore`. **Do not kick an EAS build without
the user's explicit go-ahead** (rate-limited). Prefer the Firebase emulators for fast
iteration on the geofence/run-sheet functions.

---

# P0 — Field-test fixes (do these first)

## #52 — Ration eat-window notification never fires  ✅ root cause found

**Symptom:** player never gets the "ration window open" alert.

**Root cause:** the scheduling effect lives **inside `RationPanel`**
([components/RationPanel.tsx:95-157](components/RationPanel.tsx)), and `RationPanel` is only
mounted on the player's **Stats tab**
([app/(app)/player/game.tsx:468-475](app/(app)/player/game.tsx)). The play screen defaults to
the **Map tab** (`playTab` initial = `'map'`,
[app/(app)/player/game.tsx:60](app/(app)/player/game.tsx)), and the Stats content is only
rendered when `playTab === 'stats'`. A player who stays on the map **never mounts the panel**,
so `scheduleNotificationAsync` never runs. (The effect also cancels its scheduled ids on
unmount — so even a quick visit to Stats and back tears the alerts down.)

**Fix:** hoist eat-window notification scheduling out of `RationPanel` into something always
mounted during `play`, independent of the active tab.
- Create `hooks/useRationReminders.ts` (or a small `services/rationReminders.ts`) holding the
  scheduling logic currently in [RationPanel.tsx:95-157](components/RationPanel.tsx).
- Call it from `PlayerGameScreen` unconditionally while `phase === 'play' && config.rationsEnabled && !out`
  (i.e. near the tracking effects, not inside the Stats branch).
- Keep the deterministic ids (`ration-<game>-<i>`) so it stays idempotent; cancel on
  leave/out/results. Leave `RationPanel`'s in-panel `notifDebug` display, but it should read
  state rather than own the scheduling (or just drop the debug line).
- While here, verify the Android channel `broadcasts` exists at app start
  ([app/_layout.tsx](app/_layout.tsx)) and that the trigger shape is valid for the installed
  `expo-notifications` (`{ date, channelId }` vs `{ type: 'date', date, channelId }` — check
  the SDK version in `package.json`).

**Files:** `components/RationPanel.tsx`, `app/(app)/player/game.tsx`, new
`hooks/useRationReminders.ts`. **Schema:** none.

**Verify:** start a game, **stay on the Map tab**, lock the phone; confirm the local
notification fires at `interval boundary − rationWindowMinutes`. Emulator + a short
`rationIntervalMinutes`/`rationWindowMinutes` makes this fast.

---

## #50 — GPS accuracy / accidental trips  ✅ root cause found

**Symptom:** a checkpoint tripped while the player was ~uphill of it; the dot also jumped
elsewhere for a moment.

**Root cause:** the geofence **expands the radius by the fix's accuracy** instead of
rejecting bad fixes — [functions/src/geofence.ts:165-273](functions/src/geofence.ts):
```ts
const accuracySlack = Math.min(Math.max(location.accuracy ?? 0, 0), 30);
...
if (dist > cp.radius + accuracySlack) continue;   // fires if player *could* be inside
```
A poor fix (accuracy ≈ 30 m, mislocated uphill) makes triggering **more** likely — exactly the
accidental trip. There's also no debounce: a single jumpy fix can fire.

**Fix (server-side, authoritative):** in `onLocationUpdate`,
1. **Reject low-quality fixes** before checkpoint eval: if
   `location.accuracy > config.minFixAccuracyMeters` (default ~30), skip checkpoint
   processing for that write (still allow the location doc itself / map dot). Tunable, not
   hard-coded.
2. **Drop the accuracy-slack expansion**; require `dist <= cp.radius` (optionally a small
   fixed cushion, but not GPS-uncertainty-sized).
3. **Require N consecutive in-radius fixes** (`config.geofenceConfirmFixes`, default 2) before
   recording an arrival — debounces a lone jump. This needs a tiny per-player/per-checkpoint
   "inside streak" counter; fold it into the same `checkpointTrips` doc introduced for #55
   (see below) so the two features share state.

**Optional client-side pre-filter:** in [services/locationTask.ts](services/locationTask.ts)
`updatePlayerLocation` paths, you *may* drop obviously bad fixes before upload — but keep the
server check as the source of truth.

**Files:** `functions/src/geofence.ts`; `types/index.ts` (`GameConfig`); the game-settings UI
that writes `config` (GM create/settings screen) to expose the two knobs (optional for MVP —
defaults are fine).

**Schema (`GameConfig`):**
```ts
minFixAccuracyMeters?: number;   // default ~30; reject worse fixes from geofence eval
geofenceConfirmFixes?: number;   // default 2; consecutive in-radius fixes before an arrival
```

**Verify:** simulate fixes with `accuracy` worse than the threshold inside a radius → no
arrival; a single in-radius fix between two outside fixes → no arrival; two consecutive
in-radius → arrival. Emulator-friendly (write `locations` docs directly).

> **Note:** this fix interacts with #49 — rejecting low-accuracy fixes must not throw away the
> *only* fixes a locked phone produces. Make rejection apply to **checkpoint eval only**, not
> to map presence, and keep the threshold generous.

---

## #55 — Re-trigger / re-notification model  (Tier 12, but build alongside #50)

Pulled forward because it introduces the per-player/per-checkpoint state that #50's debounce
also needs.

**Decision (from the field test):** a **global** away-cooldown setting. The **GM is
re-notified** whenever a player returns to a checkpoint after being away ≥ cooldown. The
**player is re-notified only when the checkpoint's state changed** since they last triggered it
(e.g. a #54 boon→hazard flip). An unchanged checkpoint stays silent for that player.

**Today's behavior:** the geofence dedups by *ever-arrived* — `arrivedCheckpointIds` /
`existing.docs.some(playerId)` ([geofence.ts:226,283,328](functions/src/geofence.ts)) — so a
checkpoint fires **once per player, forever**, and never re-fires.

**Approach:** introduce a per-player/per-checkpoint **trip latch** and shift from "arrived
ever" to "inside latch + away-cooldown + state-changed".
- New subcollection `games/{gameId}/checkpointTrips/{playerId}_{checkpointId}`:
  ```ts
  interface CheckpointTrip {
    playerId: string; checkpointId: string;
    inside: boolean;            // currently within radius (the latch)
    insideStreak: number;       // consecutive in-radius fixes (feeds #50 debounce)
    lastEnterAt?: FsTimestamp;  // last confirmed entry
    lastExitAt?: FsTimestamp;   // last time it went outside
    lastNotifiedState?: string; // checkpoint state last surfaced to THIS player (#54)
  }
  ```
- In `onLocationUpdate`, per checkpoint, compute `dist` and `inRadius`:
  - **Enter** (`!inside` → in-radius for `geofenceConfirmFixes` fixes): set `inside=true`,
    stamp `lastEnterAt`. Fire **GM** notification if `lastExitAt == null` (first ever) **or**
    `now − lastExitAt ≥ reNotifyAwayCooldownMinutes`. Fire **player** event only if the
    checkpoint's currently-resolved state (#54) ≠ `lastNotifiedState`; then set
    `lastNotifiedState`.
  - **Exit** (`inside` → out of radius): set `inside=false`, stamp `lastExitAt`, reset
    `insideStreak`.
  - Do all latch reads/writes in the existing per-checkpoint transaction so concurrent writes
    don't double-fire.
- Keep writing `arrivals` (the GM history/ordinal model + same-district suppression depend on
  it), but gate **notification** on the latch, not on arrival existence. Decide whether a
  re-entry creates a new `arrivals` doc (recommended: yes for GM history, but the eventQueue
  ordinal must still advance only on genuinely new arrivers — preserve the existing ordinal
  logic for the *first* trip and treat re-entries as non-ordinal "revisit" arrivals, e.g. a
  `revisit: true` flag, so traps don't re-deal queue slots).

**Files:** `functions/src/geofence.ts` (core), `types/index.ts` (`GameConfig`,
`CheckpointTrip`), `firestore.rules` (lock `checkpointTrips` to server-only — admin SDK writes;
not client-readable, like `rateLimits`), `firestore.indexes.json` if you query the subcollection.

**Schema (`GameConfig`):**
```ts
reNotifyAwayCooldownMinutes?: number;   // global; default ~5
```

**Verify:** enter → GM+player notified; sit/leave-and-return within cooldown → no GM
re-notify; return after cooldown → GM re-notified, player silent (unchanged state); flip the
checkpoint's state via #54, return → player re-notified.

---

## #49 — Background (locked-phone) alerts unreliable  ⚠ investigate, then choose path

**Symptom:** "Death Crossing" produced no alert with the phone locked; "Hill Point" did. So
delivery is intermittent — **not** uniformly broken.

**Root cause (likely):** polling-based geofencing depends on a location **write landing inside
the radius**. While locked, the OS throttles background location (Android Doze / app-standby;
iOS suspension) and may not honor the 5 s/`distanceInterval:0` cadence
([locationTask.ts:142-150,205-226](services/locationTask.ts)). A player can walk through a
radius **between** sparse fixes → no in-radius write → no arrival. "Hill Point" fired because a
fix happened to land inside. (Separately confirm FCM heads-up delivery to a locked device — but
the missing **arrival** is the more likely culprit since the trigger never ran.)

**Diagnostics first (cheap, do before coding):**
1. Reproduce with the on-screen tracking diagnostics (player taps the status card →
   `getTrackingDiagnostics()`, [locationTask.ts:44](services/locationTask.ts)): confirm
   `path: 'background-service'` and watch `lastUploadAt` cadence while locked.
2. In Firebase Console, inspect `games/{gameId}/locations/{userId}` write timestamps during a
   locked walk-through — measure the real gap between fixes.
3. Check `functions` logs for whether `onLocationUpdate` ran at the crossing time.

**Fix options (pick based on diagnostics):**
- **Interim (smaller):** keep polling but harden it — confirm the foreground service truly
  stays alive when locked (it's configured with `killServiceOnDestroy:false`), consider a
  tighter `timeInterval`/`distanceInterval` for non-battery-saver, and verify Android battery
  optimizations aren't killing it (prompt the user to exempt the app). Widening the effective
  radius is **not** the answer (it worsens #50).
- **Robust (recommended):** add **OS-level geofencing** with
  `Location.startGeofencingAsync(taskName, regions)` + a `TaskManager` geofencing task
  (`Location.GeofencingEventType.Enter`). The OS wakes the app on region entry even when
  locked/Doze'd, which is exactly the missed case. On `Enter`, upload a location write (or
  call a callable) so the existing server geofence/notify path runs. Checkpoints become the
  geofence regions (rebuild the region set when checkpoints/visibility/#54 state change; note
  the ~20-region iOS limit — prioritize currently-open checkpoints). Keep the polling uploads
  for the live map.

**Files:** `services/locationTask.ts` (+ a new geofencing task), `app/(app)/player/game.tsx`
(start/stop regions with tracking), possibly a thin callable in `functions/`. **Schema:** none
(reuses checkpoints/arrivals).

**Verify:** locked-phone walk-through of a checkpoint reliably produces an arrival + GM push.
This one genuinely needs **on-device** testing (background behavior doesn't reproduce in the
emulator) — coordinate a device test with the user; **don't** assume an EAS build without asking.

---

## #48 — Timed checkpoint visible before its reveal time  ⚠ reproduce, then fix

**Symptom:** "Park Entrance" was on the player map from the start though it was meant to appear
~20 min in.

**What the code says:** the player map only shows `markers`, and a `game-time` reveal is
projected by the run-sheet sweep at `startedAt + offsetMinutes`
([runsheet.ts:125-145](functions/src/runsheet.ts)); authoring writes the paired reveal row via
`setRevealSchedule` ([services/gameService.ts:489](services/gameService.ts) /
[checkpoints.tsx:347](app/(app)/gm/[gameId]/checkpoints.tsx)). So a correctly-configured
game-time reveal **should** defer. Most likely one of:
1. The checkpoint was saved with `visibility: 'always'` (projected at Start by
   `onGameStartProjectMarkers`) rather than `'on-reveal' + game-time` — a config/UX trap
   (the modal's two concepts — *visibility* and *timed window* — are easy to confuse).
2. A **stale `markers/{checkpointId}` doc** from an earlier run/test persisted (markers aren't
   cleared on Start — only ration photos are cleaned on game end). A leftover marker shows
   immediately.
3. A genuine projection-timing bug.

**Step 1 — reproduce & confirm** (before changing logic): in the Console inspect the
checkpoint doc (`visibility`, `reveal.trigger`, `reveal.offsetMinutes`), the paired
`scheduledEvents` reveal row (`offsetMinutes`, `firedAt`), and whether a `markers/{cpId}` doc
already existed at Start.

**Fixes (apply the relevant ones):**
- **Defense-in-depth client gate (recommended regardless):** stamp the marker with the time it
  should become visible and have the player client hide it until then. Add
  `RevealedMarker.visibleFrom?: FsTimestamp` and filter in
  [player/game.tsx:147-169](app/(app)/player/game.tsx) (`visibleFrom == null || visibleFrom <= now`).
  For `game-time`, set `visibleFrom = startedAt + offsetMinutes`. This also sets up #54.
- **Clear stale markers at Start:** extend `onGameStartProjectMarkers`
  ([markers.ts:94](functions/src/markers.ts)) to **delete** existing `markers` docs for
  checkpoints that are not `'always'` before projecting, so a prior run can't leak a marker.
- **Tighten authoring UX:** in `checkpoints.tsx`, make the visibility vs. game-time-reveal
  choice unambiguous (this folds into #53's authoring redesign).

**Files:** `functions/src/markers.ts`, `functions/src/runsheet.ts`, `types/index.ts`
(`RevealedMarker.visibleFrom`), `app/(app)/player/game.tsx`. **Schema:** optional
`RevealedMarker.visibleFrom`.

**Verify:** game-time reveal at offset N shows nothing until N minutes in (emulator with small
N); a leftover marker from a prior run does not appear at Start.

---

## #51 — Web polygon boundary won't save  ✅ root cause likely found

**Symptom:** drawing a polygon works, but **Done** (map overlay) / **Done editing polygon**
(side panel) revert to the previously saved rectangle.

**Root cause (likely):** the polygon is only persisted via the `draw.create` / `draw.update`
event handlers ([web/src/components/GameMap.tsx:282-285](web/src/components/GameMap.tsx) →
`emitPolygonFromDraw` → `onBoundaryDrawn` → `handleBoundaryDrawn` →
`updateGameConfig({ boundary })` at
[GameScreen.tsx:306-311](web/src/screens/GameScreen.tsx)). The **Done** buttons only flip
`drawingPoly` to `false` ([GameScreen.tsx:369-373](web/src/screens/GameScreen.tsx)), which runs
the effect's `teardown()` and **removes the draw control without committing the current
polygon**. If the finishing `draw.create`/`draw.update` didn't fire (e.g. the user clicked Done
before double-click-finishing, or the `on('draw.create' as never, …)` cast didn't bind on this
mapbox-gl-draw version), nothing was ever saved — so the persisted rectangle remains and the
map re-renders to it.

**Fix:** **commit the current polygon imperatively on Done / teardown**, don't rely solely on
the draw events:
- In `GameMap`, call `emitPolygonFromDraw(drawRef.current)` inside `teardown()` (before
  `removeControl`) whenever a polygon with ≥3 verts exists — so leaving polygon mode always
  saves the latest geometry.
- Verify the `draw.create`/`draw.update` event names actually bind for the installed
  `@mapbox/mapbox-gl-draw` (drop the `as never` casts; type them properly). If they aren't
  firing, the imperative commit covers it anyway.
- Optional: make the side button label/flow clearer ("Finish & save polygon").

**Files:** `web/src/components/GameMap.tsx` (primary), maybe
`web/src/screens/GameScreen.tsx`. **Schema:** none (polygon already in `MapBoundary.polygon`).

**Verify:** in `web/` (`npm run dev`), draw a polygon and click each Done control → the saved
boundary shows "Polygon set ✓ (N points)" and persists on reload; the GM mobile map and the
geofence (`pointInPolygon`) both honor it.

---

# Tier 12 — Checkpoint authoring & game-flow redesign

> #55 is specced above (built with #50). #54 should land **before/with** #53's authoring
> redesign, since the run sheet becomes the home for the time-based behavior #54 introduces.

## #54 — Time-based checkpoint type/state transitions

**Goal:** a checkpoint can change over the game — open/close at a time, and be a **boon at one
time, a hazard at another** — not just vary by arrival order.

**What exists to build on:** `opensAt`/`closesAt` window
([geofence.ts:256-264](functions/src/geofence.ts)), `event`/`eventQueue`, `visibility`/`reveal`,
and the run-sheet sweep that already mutates checkpoints (`open-site`/`close-site` write
`opensAt`/`closesAt`; `reveal-checkpoint` projects markers). The geofence reads each checkpoint
doc (15 s cache) every crossing, so **mutating the checkpoint's fields at a scheduled time is
automatically honored** by the existing eval.

**Recommended approach — declarative `transitions[]` applied by the sweep** (keeps a checkpoint
self-contained, matches "the run sheet owns checkpoint behavior"):
```ts
type CheckpointState = 'closed' | 'boon' | 'hazard' | 'notification';
interface CheckpointTransition { atMinute: number; state: CheckpointState; message?: string; }
// on Checkpoint:
initialState?: CheckpointState;        // before any transition; default 'closed' for timed cps
transitions?: CheckpointTransition[];  // ordered; empty = static (legacy behavior)
```
- Extend `runScheduledEvents` (or add a dedicated sweep) to, for each checkpoint with
  `transitions`, apply the latest transition whose `atMinute ≤ elapsed` by writing the
  checkpoint's resolved `event.kind`/`message` (and `opensAt`/`closesAt`/visibility for a
  `closed` state). Idempotent: only write when the resolved state actually changes (compare to a
  stored `currentState`), so re-sweeps are no-ops (satisfies #26).
- The **geofence keeps working unchanged** — it reads the checkpoint's current `event`/window,
  which the sweep keeps current. A `closed` state = window closed → no fire **and** marker
  hidden (ties to #48: a not-yet-open checkpoint must neither render nor trigger).
- `lastNotifiedState` in the #55 trip latch should track this resolved state so a player is
  re-notified across a boon→hazard flip.

**Authoring:** convention is `atMinute` = **game-relative minutes from `startedAt`** (matches
ration timing, run-sheet offsets, and reveal offsets). If the user later wants wall-clock,
add an absolute variant like the existing `fireAt`/`offsetMinutes` pair — but default to
relative.

**Files:** `types/index.ts` (+ function mirror types in `geofence.ts`/`runsheet.ts`/`markers.ts`),
`functions/src/runsheet.ts` (apply transitions), authoring UI (#53). `firestore.rules` if you
add a `currentState` field the client shouldn't write.

**Verify:** a checkpoint configured closed→boon@T1→hazard@T2: hidden + inert before T1; boon
push T1–T2; hazard push after T2; emulator with small T.

## #53 — Split authoring: map places (name + icon), run sheet configures (full screen)

**Goal:** on the map you only **create** a checkpoint (name + icon + position). Everything it
*does* (event kind/queue, visibility/reveal, timed window, #54 transitions) moves to the **run
sheet**, which becomes the behavior home — and per-checkpoint config gets its **own full
screen**, not a modal.

**Today:** all behavior is authored in the **modal** in
[checkpoints.tsx](app/(app)/gm/[gameId]/checkpoints.tsx); the run sheet
([runsheet.tsx](app/(app)/gm/[gameId]/runsheet.tsx)) only authors `scheduledEvents` and edits
each in a modal; web mirrors both in [GameScreen.tsx](web/src/screens/GameScreen.tsx).

**Approach (mobile first, then mirror to web):**
1. **Schema:** add `Checkpoint.icon?: string` (an icon key; render with the existing Ionicons
   map). Map authoring writes `name` + `icon` + `latitude/longitude` + `radius` only.
2. **Slim the map modal** in `checkpoints.tsx` down to name + icon picker + radius (drop the
   event/visibility/reveal/window sections). Keep long-press-to-add and tap-to-reposition.
3. **New full-screen checkpoint editor**, e.g.
   `app/(app)/gm/[gameId]/checkpoint/[checkpointId].tsx`, that owns: event (single/queue),
   visibility/reveal, timed window, and #54 transitions. Reachable from the run sheet list and
   from a checkpoint's map pin. Move the behavior-building helpers (`buildEvent`, `buildReveal`,
   `KindChips`, `VIS_*`, window/reveal handlers) out of `checkpoints.tsx` into this screen (or a
   shared module so web reuses them — note `web/src/services/checkpointKinds.ts` already shares
   some of this).
4. **Run-sheet screen** becomes the hub: list checkpoints (with their resolved behavior +
   transitions) alongside the timed `scheduledEvents`, each opening its full screen. Decide
   whether per-checkpoint behavior stays on the checkpoint doc (recommended — keep
   `event`/`transitions` on `Checkpoint`) while the run sheet is just the **authoring surface**.
5. **Mirror to web** (`web/src/screens/GameScreen.tsx`) for parity — web is GM-only and is
   where polygon/boundary already lives.

**Files:** `types/index.ts` (`Checkpoint.icon`), `app/(app)/gm/[gameId]/checkpoints.tsx`
(slim down), new `app/(app)/gm/[gameId]/checkpoint/[checkpointId].tsx`,
`app/(app)/gm/[gameId]/runsheet.tsx` (hub), `web/src/screens/GameScreen.tsx` +
`web/src/services/checkpointKinds.ts`. **Schema:** `Checkpoint.icon`.

**Note:** this is the largest, most design-sensitive item — **confirm the navigation/IA with
the user before building** (it reshapes the GM setup flow). The schema/functions changes
(#54/#55) are independent of the UI and can land first.

**Verify:** create a checkpoint on the map with just name+icon; open it from the run sheet and
configure behavior + a transition on a full screen; behavior reflects in play.

## #56 — Auto-end by remaining-player threshold (GM setting)

**Goal:** a setting picks auto-end at **1 remaining** / **0 remaining** / **manual**, tied to
the winner function.

**Today:** `onMemberWrite` → `handleDeath`
([functions/src/members.ts:57-125](functions/src/members.ts)) already ends the game when
`livingCount ≤ 1` **if** `config.winnerDetection !== false` (crowns a winner at 1, "no winner"
at 0). So current behavior ≈ **always 'one'**.

**Fix:** read a new `GameConfig.autoEndThreshold` and gate:
- `'one'` → current behavior (end at ≤1).
- `'zero'` → only end when `living.length === 0` (let a single survivor keep playing for
  non-last-standing win conditions); change the `if (livingCount > 1) return;` guard and the
  transaction's `living.length` checks accordingly.
- `'manual'` → never auto-end (skip the winner/end transaction; the death broadcast still
  fires). Map the legacy `winnerDetection: false` to `'manual'`.
- This path also fires for starvation eliminations (#11) since those set `out` → `onMemberWrite`
  runs. Keep the transaction idempotent (already is — checks `status === 'ended'`).

**Files:** `functions/src/members.ts`, `types/index.ts` (`GameConfig`), the game-settings UI to
expose the picker. **Schema (`GameConfig`):**
```ts
autoEndThreshold?: 'one' | 'zero' | 'manual';   // default 'one' (legacy winnerDetection:false ⇒ 'manual')
```

**Verify:** with `'one'`, reducing to 1 living ends + crowns; with `'zero'`, 1 living keeps the
game live and 0 ends with "no winner"; with `'manual'`, neither auto-ends. Drive by toggling
`out` on member docs in the emulator.

---

# Suggested sequencing

1. **#52** (ration alert) — small, isolated, high user value.
2. **#51** (web polygon) — small, isolated, web-only.
3. **#50 + #55 together** — they share the `checkpointTrips` latch; build the latch once.
4. **#54** (time-based state) — schema + sweep; unblocks the #48 client gate and #53 authoring.
5. **#48** (early reveal) — reproduce, then the marker `visibleFrom` gate + stale-marker
   cleanup (rides on #54).
6. **#56** (auto-end) — small function change.
7. **#49** (background reliability) — diagnose, then likely OS geofencing; needs device
   testing — schedule with the user.
8. **#53** (authoring redesign) — largest/most design-sensitive; confirm IA with the user
   first. Its schema bit (`Checkpoint.icon`) is trivial; the UI is the work.

# Cross-cutting reminders

- **Mirror types twice:** shared `types/index.ts` **and** the re-declared mirrors in each
  `functions/src/*.ts` that uses them.
- **All new schema fields stay optional** so legacy games keep working (roadmap invariant).
- **Idempotency (#26):** every new server mutation (transitions sweep, auto-end, trip latch)
  must be safe under retry/double-trigger — use deterministic ids / state-compare-before-write,
  matching the existing `firedAt`/transaction patterns.
- **firestore.rules:** lock server-only collections (`checkpointTrips`) like the existing
  `rateLimits`; whitelist any new client-writable game-doc/config keys.
- **Lint + functions build** before deploy; prefer **emulators** for the function-heavy items;
  **device testing** is mandatory for #49 (and good for #50/#52). **Never start an EAS build
  without the user explicitly asking.**
