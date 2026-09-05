# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the **outstanding** [ROADMAP.md](ROADMAP.md) items, keyed by the
same item numbers. Everything here extends the existing types in
[types/index.ts](types/index.ts) and the `Collections` map in
[services/firebase.ts](services/firebase.ts); the built foundation (`GameConfig`, `Broadcast`,
`RationSubmission`, the #60 `RunbookEntry`/runbook model, `ScheduledEvent`, member elimination/`district`/
`sos`/`sosAckAt`/`outOfBounds`, `Game.gameDate`, the `markers`/reveal model) is already in those
files and is the baseline below.

New fields stay **optional** so legacy games keep working — the **one exception was the shipped #60
runbook overhaul**, which removed fields (and chose a fresh start over running its migration); its
canonical schema now lives in [types/index.ts](types/index.ts). Timestamps use the platform-neutral
`FsTimestamp` so types compile in both the mobile app and `web/`.

Only items with a real data-model/infra delta appear here; pure logic/UI/enforcement items are
listed under [No schema change](#no-schema-change-enforcement--logic-only). Everything through Tier 7
has **shipped and been removed** — its numbers are retired (full list in the [ROADMAP.md](ROADMAP.md)
Built & removed callout + git). Live data-model/infra deltas left behind by those batches:
`GameConfig.tripIntervalMinutes`/`minFixAccuracyMeters`/`geofenceConfirmFixes`/`reNotifyAwayCooldownMinutes`/
`autoEndThreshold`/`starvationMode`; the `Checkpoint.icon` field + the #60 runbook model (`RunbookEntry`
collection); the server-only `checkpointTrips`, `entryTrips` (GM-readable, #67/#73), `rationWindowPings`
(#72), and `starvationSweeps` (#11) latches; `Broadcast.pushed` (#69) + `Broadcast.dismissedBy` (#71);
`RevealedMarker.visibleFrom` (#48); `PlayerLocation.battery` (#35); the `cloneGame`/`submitRation`/
`fireRunbookEntry`/`rationPings`/`starvationSweep`/`transferGmOrEndGame` (#29) callables/functions;
and the shared `common/` helpers `pointInBoundary`, `validateGameConfig`, `startPreflight`
(#63/#64/#23); `RunbookEntry.playerIds` + `RunbookEntry.revealOnFire` (#80 — per-entry player
targeting and the entry-driven reveal into the existing `markers` projection; both optional, so
untargeted legacy entries still fire for everyone and reveal nothing); `Game.winnerId` +
`Game.winnerName` (#81 — the sole survivor, stamped on `status → ended` by winner detection in-txn
(auto path) and by the `cleanupRationPhotosOnGameEnd` chokepoint on the manual End Game path;
`winnerName` denormalized onto the game doc because players can't read other members; both optional,
absent when there's no single winner). Tier 7 (#20–28) added **no** new schema.

---

## 46. App Check enforcement

The per-UID throttle on `joinGameByCode` already shipped (`enforceJoinRateLimit` — an internal,
admin-SDK-only `rateLimits/{uid}` doc, not client-readable, rejecting > N tries / window with
`resource-exhausted`). Remaining: flip `ENFORCE_APP_CHECK → true` in `functions/src/games.ts` after
both platforms are registered and verified. No game-doc change.

## 57. Per-GM teams *(later tier)*

```ts
export interface GameMember {
  // ...existing...
  /** GM (member userId) who owns this player's team; notifications/map filter by it. */
  teamGmId?: string;
}
```

GMs assign players to themselves; the geofence/arrival push routes only to the owning GM's tokens, and
GM map/roster views filter to `teamGmId === me`. Unassigned/legacy players fall back to all-GMs
(today's behavior). Deferred per the 2026-06-07 field test.

## 82. Location jitter — diagnostics & display stabilization

Shipped 2026-09-05. Additive and optional; legacy fixes without these fields read as "unknown".

**`PlayerLocation`** (`types/index.ts`) — written by all three upload paths in
`services/locationTask.ts`:

| Field | Type | Notes |
|---|---|---|
| `speed` | `number?` | Doppler ground speed m/s. **Correction (2026-09-05 field trail): absence is NOT the signal.** Android reports `0`, never null — zero missing values across 126 fixes. The value still correlates with bad fixes (every held candidate showed `speed 0`), so use the value, not its presence. |
| `mocked` | `boolean?` | Android mock-provider flag; separates a developer-options mock from a genuine bad fix. |
| `steps` | `number?` | Cumulative steps for the tracking session. **Recording only** — no gameplay decision reads it. |

> **Write semantics.** `updatePlayerLocation` uses `setDoc` **without** `{merge:true}`, so an omitted
> key is *deleted*, not preserved — the conditional-spread pattern does **not** carry a prior value
> forward (the older #35 `battery` comment claimed it did and was wrong). Readers must treat absent
> as *unknown*, never as *last known*.

**`locationTrail/{id}`** (server-written, `functions/src/geofence.ts`) gains `speed`, `mocked`,
`steps`, and `stepsSincePrev`. The last is `null` when either count is missing **or when the delta
would be negative** — a negative means the counter reset (rejoin / process recycle), not backwards
walking. Pair `stepsSincePrev` with the existing `metersSincePrev` to separate "they walked" from
"the fix moved but they didn't".

**No Firestore rules change.** The `locations/{userId}` write rule validates `userId` and the
lat/lng ranges but uses no `hasOnly()` key allowlist, so the new fields pass as-is.

**`StabilizedLocation`** (`common/locationStabilizer.ts`) is a *view* type, never persisted:
`PlayerLocation` plus `held` / `heldReason` / `ageMs` / `confidenceM` / `stale`. Both GM contexts
expose `playerLocations` as this type; because it's a superset, existing consumers are unaffected.

| Field | Type | Notes |
|---|---|---|
| `heldReason` | `'steps' \| 'speed' \| null` | Which gate held the fix; `null` when it was accepted. `held` is now exactly `heldReason !== null`. Diagnostic — recorded so the gate constants can be re-derived from a `locationTrail` capture. |

**`NSMotionUsageDescription`** (`app.json` → `ios.infoPlist`) is **required**, not optional polish.
`expo-sensors` is deliberately absent from `plugins` (its only iOS job is this key), so the key is
declared directly. Without it `Pedometer.requestPermissionsAsync()` reaches `RCTFatal` in
`EXMotionPermissionRequester.m` and **aborts the process** — an OS-level kill that `stepCounter.ts`'s
fail-soft `try/catch` cannot intercept. Verify with `npx expo config --type introspect --json`.
Android needs nothing: `expo-sensors` merges its own `ACTIVITY_RECOGNITION` declaration.

**Capture context on `PlayerLocation`** (added 2026-09-05c, all optional):

| Field | Type | Notes |
|---|---|---|
| `appState` | `string?` | `AppState` at fix time. The first walk could not distinguish "bad handset" from "phone left locked"; it was the latter, and only conversation revealed it. |
| `msSinceForeground` | `number?` | ms since last foregrounded (0 while active). **The load-bearing one** — screen state alone would not have explained the data, because the frequently-checked phone's background fixes were still good. Doze depth tracks how long a device sat untouched. |
| `batteryOptimized` | `boolean?` | Android battery-optimization state at fix time. Absent when unreadable — note the underlying check fails *open*. |
| `wakeLock` | `boolean?` | Was the partial CPU wake lock held? Identifies which A/B arm a fix belongs to. |

**Two new `GameConfig` knobs:**

| Field | Default | Notes |
|---|---|---|
| `wakeLockEnabled` | `false` | Hold a partial CPU wake lock while tracking (Android). **The one capture-layer variable under test** — changing anything else in the location request at the same time makes the result uninterpretable. Costs battery; that is the trade being quantified. Enable for a subset of players to get both arms from one walk. |
| `maxDisplayAccuracyMeters` | `80` | Reject fixes worse than this **from the GM map only** — never from checkpoint evaluation, which keeps using `minFixAccuracyMeters`. 0 disables. |

**`modules/outdoor-native`** — a local Expo module (autolinked; `android/` is CNG output so native
code cannot live there). Android implements `getStepCount()` over the cumulative
`TYPE_STEP_COUNTER` and `acquire/release/isWakeLockHeld`; iOS is a deliberate no-op (no
user-acquirable CPU lock, and CMPedometer's historical query already covers suspended time). New
manifest permissions: `WAKE_LOCK`, `ACTIVITY_RECOGNITION`.

**`HoldReason`** is now `'accuracy' | 'speed'`. The `'steps'` motion gate was deleted before
shipping — replayed against the trail it suppressed 556 m and 980 m of two players' genuine
movement, because Android batches step delivery and a locked phone's listener never fires.

**`GameConfig.locationTrail`** (existing, #50) is the capture switch — no new config knob. Constants
(`MAX_PLAUSIBLE_SPEED_MS` 7, `MAX_HOLD_MS` 60 s, `STALE_AFTER_MS` 45 s, and for the motion gate
`MAX_STRIDE_M` 1.5, `STEP_GATE_SLACK_M` 25, `DOPPLER_MOVING_MS` 0.5) are module-level in
`locationStabilizer.ts`, deliberately not GM-tunable until field data justifies values.

---

## No schema change — enforcement / logic only

These **outstanding** items are pure logic, rules, client architecture, or ops — no new fields or
collections. (Shipped no-schema items — 20–28, 48–56, 58's prerequisites, etc. — are retired; see the
[ROADMAP.md](ROADMAP.md) Built & removed callout and git history.)

- **47** Maps-key restriction — Cloud Console ops task.
