# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the **outstanding** [ROADMAP.md](ROADMAP.md) items, keyed by the
same item numbers. Everything here extends the existing types in
[types/index.ts](types/index.ts) and the `Collections` map in
[services/firebase.ts](services/firebase.ts); the built foundation (`GameConfig`, `Broadcast`,
`RationSubmission`, `CheckpointEvent`/`eventQueue`, `ScheduledEvent`, member elimination/`district`/
`sos`, the `markers`/reveal model) is already in those files and is the baseline below.

New fields stay **optional** so legacy games keep working. Timestamps use the platform-neutral
`FsTimestamp` so types compile in both the mobile app and `web/`.

Only items with a real data-model/infra delta appear here; pure logic/UI/enforcement items are
listed under [No schema change](#no-schema-change-enforcement--logic-only).

---

## 1. Twilio off `functions.config()` *(infra, not schema)*

Replace the `functions.config().twilio.*` reads in `functions/src/sms.ts` with
`defineSecret('TWILIO_SID' | 'TWILIO_TOKEN' | 'TWILIO_FROM')`, declare them on the SMS-sending
functions (`runWith({ secrets: [...] })` / params), and set with `firebase functions:secrets:set`.
`sendArrivalSMS` keeps no-op'ing when a secret is unset (same graceful skip as today).

## 2. Run-sheet collection-group index *(index)*

Add the single-field override so the `collectionGroup('scheduledEvents').where('firedAt','==',null)`
sweep (`functions/src/runsheet.ts`) has a collection-group index (mirrors `members.userId`):

```jsonc
// firestore.indexes.json → fieldOverrides[]
{
  "collectionGroup": "scheduledEvents",
  "fieldPath": "firedAt",
  "indexes": [{ "order": "ASCENDING", "queryScope": "COLLECTION_GROUP" }]
}
```

Redeploy with `firebase deploy --only firestore:indexes`.

## 5. SOS persists & must be acknowledged

```ts
export interface GameMember {
  // ...existing (out, cause, sos, sosAt, sosLocation, district)...
  /** GM acknowledged this member's SOS; the SOS stays "open" until set. Null = unacked. */
  sosAckAt?: FsTimestamp | null;
}
```

`sosAckAt` is **GM-write-only** (`firestore.rules`). The SOS UI treats `sos === true &&
sosAckAt == null` as the live, escalating state; nothing auto-clears it.

## 7. Player-left-the-boundary alert

```ts
export interface GameMember {
  // ...existing...
  /** Latched true while the player is outside game.boundary, so the exit alert fires once. */
  outOfBounds?: boolean;
}
```

The location/geofence function sets `outOfBounds` when a player leaves `game.boundary` and emits a
GM-only alert (reuses the existing GM broadcast/push path — no new collection). Clears when they
re-enter. With item 39's polygon, the in/out test becomes point-in-polygon.

## 11. Auto-starvation sweep *(function logic; no new schema)*

Reuses the built `RationSubmission` (`rations/{playerId}_{intervalIndex}`), the interval math
(`rationInterval(game, now)`), and `EliminationCause: 'starvation'`. Scheduled function: at each
interval boundary, every living player lacking a non-rejected submission for the **prior** interval
→ eliminate with `cause: 'starvation'` + death broadcast. Skipped when `rationsEnabled` is false or
`starvationMode === 'gm-confirmed'` (then only flags for GM review). Must be idempotent (item 26).

## 17. Purge locations & arrivals on game end *(lifecycle)*

Extend `cleanupRationPhotosOnGameEnd` (`functions/src/cleanup.ts`), already triggered on the
`status: active → ended` transition, to also `recursiveDelete` the game's `locations` (and
optionally `arrivals`) subcollections. No schema; document the retention window in the privacy policy.

## 31. Coordinate range validation *(rules)*

In the `firestore.rules` locations `create, update`, add to the existing `is number` checks:
`latitude >= -90 && <= 90` and `longitude >= -180 && <= 180`.

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

## 36. Game-list ordering + optional `gameDate`

```ts
export interface Game {
  // ...existing...
  /** GM-set event date, distinct from system `createdAt`. Sort/display when present. */
  gameDate?: FsTimestamp | null;
}
```

Client sorts My Games by `gameDate ?? createdAt` descending (in-memory — no index). GM create/setup
gains an optional date picker.

## 39. Polygon boundary authoring + point-in-polygon

Schema already shipped and is the baseline:

```ts
export interface MapBoundary {
  minLat; maxLat; minLng; maxLng;            // rectangle (legacy + framing fallback)
  polygon?: { latitude: number; longitude: number }[]; // ≥3 verts; wins when present
}
```

Outstanding: a **web-only** vertex draw/edit UI (e.g. `@mapbox/mapbox-gl-draw` in
`web/src/components/GameMap.tsx` + `GameScreen.tsx`) that writes `polygon` (and keeps min/max as its
bbox); and a **point-in-polygon** (ray-cast) test in `functions/src/geofence.ts` + any client
boundary check, used when `polygon` is set (absent → unchanged box behavior). The geofence test is
only needed once the boundary-exit alert (item 7) lands.

## 40. GM↔GM messaging *(per-player checkpoints need no new schema)*

Per-player checkpoints reuse the built reveal model's `reveal.audience: 'specific-players'` +
`recipientPlayerIds` — authoring only. GM↔GM messaging is **new**: either add a
`targetRole: 'gm'` (or `audience: 'gm-only'`) to `Broadcast`, or a small `gmMessages` channel.
Spec when prioritized.

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

## 46. App Check enforcement + callable rate-limiting

Flip `ENFORCE_APP_CHECK → true` in `functions/src/games.ts` after both platforms are registered and
verified. Add a per-UID throttle to `joinGameByCode`: an internal, admin-SDK-only
`rateLimits/{uid}` doc (not in `Collections`, not client-readable) stamped each attempt, rejecting
> N tries / window with `resource-exhausted`. No game-doc change.

---

## No schema change — enforcement / logic only

These items are pure logic, rules, client architecture, or ops — no new fields or collections:

- **3** SOS → SMS fallback — wire the SMS path (item 1) as the fallback channel in the SOS sender.
- **4** Offline resilience — client write-queue + flush on reconnect.
- **8** Winner detection GM-exclusion — `functions/src/members.ts` guard + roster-data investigation.
- **9** Crossing-player double-push — filter `crossingPlayerToken` out of `gmTokens`/`allPlayerTokens` in `dispatchCheckpointEvent`.
- **10** Transactional single-event dedup — wrap the single-`event` write in the `eventQueue` path's `runTransaction` guard.
- **12** Auto per-interval count — a `playerCountBroadcast` toggle seeds repeating run-sheet rows (existing `template:'player-count'`).
- **13–15** Ration review/submit UX — render off the existing `RationSubmission.status`; `resizeMode:'contain'` + scroll; one-doc-per-window state machine.
- **16** Geofence read cost — fewer reads per write (lobby short-circuit, zero-checkpoint skip, cache phase/role).
- **18** `getMyGames` N+1 — `Promise.all` the per-game reads.
- **19** Shared broadcast subscription — one `useBroadcasts(gameId)` source feeding `AlertOverlay`/`BroadcastFeed`.
- **20** No mid-game delete — deny member `delete` when `gamePhase(game) === 'play'` (`firestore.rules` + `removePlayer`).
- **21** Reversible elimination — `revivePlayer()` clears `out`/`outAt`/`cause`, posts a correcting broadcast, and reverts `results → play` if needed.
- **22** Monotonic phases — phase-transition helpers; `reopenSetup` warns; End Game confirm-gated and single-fire.
- **23** Start-Game preflight — checks in `startGame` (boundary, ≥1 checkpoint, ≥1 player, ≥1 GM FCM token).
- **24** Config lock — freeze interval-defining fields in `updateGameConfig` once `play` begins.
- **25** Checkpoint-edit history — keep `arrivals`; warn on pending run-sheet events; never orphan records.
- **26** Idempotent server actions — deterministic ids / `firedAt` across winner/starvation/run-sheet.
- **27** Late-join lock — `joinGameByCode` rejects any join once `gamePhase(game) !== 'lobby'`.
- **28** Confirm destructive broadcasts — two-step confirm + log for void-economy / End Game.
- **29** `deleteAccount` — ≤500-write batches; sole-GM transfer or server-side end (maybe a small `transferGm`/`deleteGameForce` callable).
- **30** Tracking controller — collapse the effect + AppState re-assert into one `shouldTrack`-gated controller.
- **32** SMS rebrand — change the `[HungerGamesLocator]` prefix in `functions/src/sms.ts`.
- **33** Login loading reset — `finally { setLoading(false) }` (or a mounted guard) in `app/(auth)/login.tsx`.
- **34** Drop unused `arrivals` composite index from `firestore.indexes.json`.
- **37** Join name prefill — handle late-arriving `profile` + a "from your profile" hint in `join.tsx`.
- **38** Navigate-after-join — use `joinGameByCode`'s returned `{ gameId, role }` to route into the game.
- **42** Arena map overlay — a GM-uploaded image overlay (asset/storage + map layer; spec when prioritized).
- **44** Voucher-site preset — a one-tap scaffold of open/close/announce run-sheet rows on a time-windowed checkpoint.
- **47** Maps-key restriction — Cloud Console ops task.
