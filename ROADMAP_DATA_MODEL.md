# Roadmap — Data Model & Schema Spec

Implementation-ready detail for the **outstanding** [ROADMAP.md](ROADMAP.md) items, keyed by the
same item numbers. Everything here extends the existing types in
[types/index.ts](types/index.ts) and the `Collections` map in
[services/firebase.ts](services/firebase.ts); the built foundation (`GameConfig`, `Broadcast`,
`RationSubmission`, `CheckpointEvent`/`eventQueue`, `ScheduledEvent`, member elimination/`district`/
`sos`/`sosAckAt`/`outOfBounds`, `Game.gameDate`, the `markers`/reveal model) is already in those
files and is the baseline below.

New fields stay **optional** so legacy games keep working. Timestamps use the platform-neutral
`FsTimestamp` so types compile in both the mobile app and `web/`.

Only items with a real data-model/infra delta appear here; pure logic/UI/enforcement items are
listed under [No schema change](#no-schema-change-enforcement--logic-only). Built items (1–10, 17,
18, 19, 31, 32, 34, 36–40) have shipped and been removed — their numbers are retired.

---

## 11. Auto-starvation sweep *(function logic; no new schema)*

Reuses the built `RationSubmission` (`rations/{playerId}_{intervalIndex}`), the interval math
(`rationInterval(game, now)`), and `EliminationCause: 'starvation'`. Scheduled function: at each
interval boundary, every living player lacking a non-rejected submission for the **prior** interval
→ eliminate with `cause: 'starvation'` + death broadcast. Skipped when `rationsEnabled` is false or
`starvationMode === 'gm-confirmed'` (then only flags for GM review). Must be idempotent (item 26).

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

## 46. App Check enforcement + callable rate-limiting

Flip `ENFORCE_APP_CHECK → true` in `functions/src/games.ts` after both platforms are registered and
verified. Add a per-UID throttle to `joinGameByCode`: an internal, admin-SDK-only
`rateLimits/{uid}` doc (not in `Collections`, not client-readable) stamped each attempt, rejecting
> N tries / window with `resource-exhausted`. No game-doc change.

---

## No schema change — enforcement / logic only

These items are pure logic, rules, client architecture, or ops — no new fields or collections:

- **12** Auto per-interval count — a `playerCountBroadcast` toggle seeds repeating run-sheet rows (existing `template:'player-count'`).
- **13–15** Ration review/submit UX — render off the existing `RationSubmission.status`; `resizeMode:'contain'` + scroll; one-doc-per-window state machine.
- **16** Geofence read cost — remaining work: cache phase/role per write (lobby short-circuit, zero-checkpoint skip, and checkpoint cache already shipped).
- **20** No mid-game delete — deny member `delete` when `gamePhase(game) === 'play'` (`firestore.rules` + `removePlayer`).
- **21** Reversible elimination — `revivePlayer()` clears `out`/`outAt`/`cause`, posts a correcting broadcast, and reverts `results → play` if needed.
- **22** Monotonic phases — phase-transition helpers; `reopenSetup` warns; End Game confirm-gated and single-fire.
- **23** Start-Game preflight — checks in `startGame` (boundary, ≥1 checkpoint, ≥1 player, ≥1 GM FCM token).
- **24** Config lock — freeze interval-defining fields in `updateGameConfig` once `play` begins.
- **25** Checkpoint-edit history — keep `arrivals`; warn on pending run-sheet events; never orphan records.
- **26** Idempotent server actions — deterministic ids / `firedAt` across winner/starvation/run-sheet.
- **27** Late-join lock — `joinGameByCode` rejects any join once `gamePhase(game) !== 'lobby'`.
- **28** Confirm destructive broadcasts — two-step confirm + log for void-economy / End Game.
- **29** `deleteAccount` — remaining work: sole-GM transfer or server-side end (chunked ≤450-write batches already shipped). Maybe a small `transferGm`/`deleteGameForce` callable.
- **30** Tracking controller — collapse the effect + AppState re-assert into one `shouldTrack`-gated controller.
- **33** Login loading reset — `finally { setLoading(false) }` (or a mounted guard) in `app/(auth)/login.tsx`.
- **42** Arena map overlay — a GM-uploaded image overlay (asset/storage + map layer; spec when prioritized).
- **44** Voucher-site preset — a one-tap scaffold of open/close/announce run-sheet rows on a time-windowed checkpoint.
- **47** Maps-key restriction — Cloud Console ops task.
