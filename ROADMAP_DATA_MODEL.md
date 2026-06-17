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
`RevealedMarker.visibleFrom` (#48); the `cloneGame`/`submitRation`/`fireRunbookEntry`/`rationPings`/
`starvationSweep` callables/functions; and the shared `common/` helpers `pointInBoundary`,
`validateGameConfig`, `startPreflight` (#63/#64/#23). Tier 7 (#20–28) added **no** new schema.

---

## 35. Low-battery beacon

```ts
export interface PlayerLocation {
  // ...existing...
  /** Device battery 0–1, reported with each fix; drives the GM low-battery flag. */
  battery?: number;
}
```

Player writes its own `battery` with each location fix (allowed by the existing self-write rule);
the GM roster flags a player below a threshold.

## 41. End-game phase

```ts
phase?: 'setup' | 'lobby' | 'play' | 'endgame' | 'results';
```

Add `'endgame'` between `'play'` and `'results'`; a `startEndgame()` helper alongside
`startGame`/`endGame` in `gameService.ts`. `gamePhase(game)` keeps defaulting legacy games. The
ration loop can auto-disable in this phase. No new collection.

## 43. Practice / dress-rehearsal game

```ts
export interface Game {
  // ...existing...
  /** Disposable on-site rehearsal: PRACTICE badge, relaxed guards, auto-cleanup. */
  practice?: boolean;
}
export interface Checkpoint {
  // ...existing...
  /** "Drop test checkpoint here" marker; badged and bulk-removed with the practice game. */
  test?: boolean;
}
```

- `practice` is GM-write-only, set at creation (`createGame`). Every screen shows a PRACTICE badge.
- The integrity invariants that block destructive actions (items 20, 22, 28) are **bypassed** when
  `practice` — the point is to tear down and re-run freely.
- A "drop test checkpoint here" action creates a `test` checkpoint at current GPS (generous radius,
  test event), firing the real `onLocationUpdate` path so events/pushes can be verified off-venue.
- A GM reset clears `arrivals`/`locations`/`rations`; practice games auto-delete (doc + Storage
  photos) on end, extending `cleanupRationPhotosOnGameEnd` to remove the whole game.
- Readiness view is derived GM-side state (no schema): joined-vs-expected, fresh-fix count
  (`services/locationStatus.ts`), per-device push confirmation.

## 45. Post-game media

```ts
export interface Game {
  // ...existing...
  media?: {
    youtubeUrl?: string;        // validate host: youtube.com / youtu.be
    photosAlbumUrl?: string;    // validate host: photos.google.com / photos.app.goo.gl
    updatedAt: FsTimestamp;
    updatedBy: string;
  };
}
```

GM-authored on the **results** screen (gated on the game being finished). A Firestore-trigger Cloud
Function fires when `media.youtubeUrl`/`photosAlbumUrl` changes, writes a broadcast, and pushes
every member token **except the setter** (reuses the broadcast/push pipeline). Results screens show
outbound `Linking.openURL` / `<a target="_blank">` links — no in-app player. Add `'media'` to the
game-doc `affectedKeys().hasOnly([...])` whitelist in `firestore.rules`.

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

- **12** Auto per-interval count — wire the `playerCountBroadcast` toggle to auto-seed a repeating `template:'player-count'` scheduled-announcement row each interval (the #61 authoring + `runScheduledEvents` sweep already exist); today the toggle is stored but does nothing automatic.
- **16** Geofence read cost — cache phase/role per write (lobby short-circuit, zero-checkpoint skip, and checkpoint cache already shipped). NB: #20/#24's rules now add a game-doc `get()` on some member/game writes.
- **29** `deleteAccount` — sole-GM transfer or server-side end (chunked ≤450-write batches already shipped; #20's carve-out now scrubs-and-eliminates a live game's member). Maybe a small `transferGm`/`deleteGameForce` callable.
- **42** Arena map overlay — a GM-uploaded image overlay (asset/storage + map layer; spec when prioritized).
- **44** Voucher-site preset — a one-tap scaffold of open/close/announce run-sheet rows on a time-windowed checkpoint.
- **47** Maps-key restriction — Cloud Console ops task.
- **58** Single-game test checklist — a doc plus an optional `seedTestGame` helper; no new fields.
- **77** Closed-phone pass-through reliability — #49 follow-up; tuning of background-location cadence / `MAX_SEGMENT_METERS` / foreground-resume retro-test. No schema; needs an on-device locked-phone test.
