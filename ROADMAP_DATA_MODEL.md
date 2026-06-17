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
(#63/#64/#23). Tier 7 (#20–28) added **no** new schema.

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

## No schema change — enforcement / logic only

These **outstanding** items are pure logic, rules, client architecture, or ops — no new fields or
collections. (Shipped no-schema items — 20–28, 48–56, 58's prerequisites, etc. — are retired; see the
[ROADMAP.md](ROADMAP.md) Built & removed callout and git history.)

- **47** Maps-key restriction — Cloud Console ops task.
- **77** Closed-phone pass-through reliability — #49 follow-up; tuning of background-location cadence / `MAX_SEGMENT_METERS` / foreground-resume retro-test. No schema; needs an on-device locked-phone test.
