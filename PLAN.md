# Implementation Plan — "Tier 11 P3 polish" (#41–45)

**Status:** not started. **Created:** 2026-06-17. **Owner:** (pick up in a fresh session.)

This batch is the **Tier 11 P3 polish** cluster (#41–45): end-game phase, custom arena map overlay,
practice game, voucher-site run-sheet preset, and post-game media. Items carry the **stable roadmap
numbers**; see [ROADMAP.md](ROADMAP.md) + [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) under the
same numbers. Mark each built per the roadmap convention when it lands.

**Design decisions locked in (2026-06-17):**
- **#41 end-game** = a labeled phase that auto-disables rations, pushes a "final showdown"
  broadcast, **and projects a GM-dropped convergence marker** to all players. Live systems
  (tracking, boundary, SOS, geofence) keep running; only the ration loop turns off.
- **#42 overlay** = GM uploads an arena image and **drags/scales four corners** to georeference it.
  Authoring is **web-only** (mirrors polygon authoring); rendered on **both** web (true quad) and
  mobile (axis-aligned bbox of the corners — a documented react-native-maps limitation).
- **Sequence:** the prioritized three (**#41, #42, #44**) first; **#43** and **#45** trail as
  optional/last.

---

## Orientation (read first)

Same monorepo + deploy story as prior cycles:

| Surface | Path | Reaches the field via |
| --- | --- | --- |
| **Mobile app** | `app/`, `components/`, `services/`, `context/` | **EAS APK** (can't hot-deploy) |
| **Web GM dashboard** | `web/` (Vite + Firebase JS SDK; `@shared` → repo root) | `firebase deploy --only hosting` |
| **Cloud Functions** | `functions/src/` (admin SDK, 1st-gen) | `firebase deploy --only functions` |
| **Rules** | `firestore.rules`, `storage.rules` | `firebase deploy --only firestore:rules` / `storage` |

Shared TS types in repo-root `types/index.ts` (`@shared/types` web · `@/types` mobile); pure
cross-client helpers in repo-root `common/` (`@shared/common/<x>` web · `@/common/<x>` mobile).
Functions mirror types inline (can't import app types).

Phase/lifecycle helpers live in `services/gameService.ts` (`openLobby`, `reopenSetup`, `startGame`,
`endGame`, `updateGameConfig`, `markPlayerOut`, `gamePhase`) and mirror in `web/src/services/gameService.ts`.
The game-doc `update` rule in `firestore.rules` whitelists changeable keys via `affectedKeys().hasOnly([...])`
and freezes the interval-config trio once the *resolved* phase is `play` (#24).

**Build / verify:**
```bash
cd web && npm run build && cd ..            # tsc --noEmit && vite build
cd functions && npm run build && cd ..      # tsc
npx tsc --noEmit -p tsconfig.json           # mobile (2 known expo-router Href errors — ignore)
npm run lint                                 # touched files only; web @/@shared no-unresolved are pre-existing
# Rules: validate with firebase_validate_security_rules (Firebase MCP) before deploying.
```

**Conventions:** commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; work on `main`;
push/deploy only when asked. EAS builds are rate-limited — **never kick a build without an explicit ask.**

---

## 1. #41 — End-game phase (convergence) *(Tier 11 · client + functions + rules)*

**Goal:** model the schedule's end-game block — a GM-triggered "final showdown" between `play` and
`results` that auto-disables rations and rallies players to a convergence point.

**Schema** (`types/index.ts`, + web is automatic via `@shared`):
- Extend `GamePhase`: `'setup' | 'lobby' | 'play' | 'endgame' | 'results'`.
- **No game-doc field** for the rally: reuse the `markers` collection. The convergence point is a
  `markers/endgame-rally` doc (name "Final Rally", `audiencePlayerIds: null` → all players), written
  by the GM client (rules already allow GM writes to `markers`). This rides the existing #48 reveal
  plumbing — players already render `markers` with the `visibleFrom` gate.

**Approach:**
- `services/gameService.ts` + web mirror: add `startEndgame(gameId, rally: {latitude, longitude})`
  — sets `phase: 'endgame'`, writes the `endgame-rally` marker, and writes a `kind: 'gm-message'`
  broadcast ("⚔️ Final showdown — converge on the rally point!") pushed to all living players (reuse
  `sendBroadcast`). `gamePhase()` keeps defaulting legacy games (unchanged — new value is additive).
- **Monotonic guard (#22):** allow `play → endgame → results`; `endGame()` already → `results`
  works from `endgame`. Add `endgame` to the guarded forward-only transition map. Reopen paths
  (`reopenSetup`, the #21 results→play revive) are unaffected.
- **Live systems stay on in endgame, rations off:**
  - `functions/src/geofence.ts`: widen the early gate from `phase !== 'play'` to
    `phase !== 'play' && phase !== 'endgame'` so tracking, boundary-exit alerts, SOS, and checkpoint
    eval continue (a convergence checkpoint can still fire).
  - Ration loop auto-disables: `rationInterval`/`gameConfig` consumers and the
    `rationPings`/`starvationSweep` functions + `RationPanel` treat `phase === 'endgame'` as
    "rations off" (no new pings, no starvation sweeps, panel hidden). Gate on resolved phase, not a
    config flip (keeps `config` immutable).
  - Player play-screen tracking continues through `endgame` (it must — players are still on the map);
    only the ration UI hides.
- **Rules:** the game-doc `update` whitelist already includes `'phase'`. The #24 interval freeze
  keys off `phase != 'play'`, so in `endgame` the trio is technically editable again — extend the
  freeze predicate to also hold when resolved phase is `'endgame'` (interval edits there are moot but
  the freeze should stay closed). No new whitelist key (rally lives in `markers`).
- **UI:** GM main screen (`app/(app)/gm/[gameId]/index.tsx` + web `GameScreen`) gains a **Start
  End-Game** action in `play` (tap-to-place the rally on the map, confirm), an **End-Game** banner in
  the phase, and **End Game** still closes to `results`. Player play-screen shows a "Final showdown"
  state + the rally marker. Results phase unchanged.

**Surface:** mobile + web (UI/helpers), functions (geofence gate + ration gates), rules (freeze
predicate). **Schema:** `GamePhase` adds `'endgame'`; reuses `markers`.

## 2. #42 — Custom arena map overlay *(Tier 11 · web author + both render + storage)*

**Goal:** let the GM overlay a real arena map image on the live map instead of generic tiles + the
boundary (Rule 33).

**Schema** (`types/index.ts`):
```ts
export interface Game {
  // ...existing...
  mapOverlay?: {
    url: string;                                   // Firebase Storage download URL
    corners: { latitude: number; longitude: number }[]; // 4 corners TL,TR,BR,BL (quad placement)
    opacity?: number;                              // 0–1, default ~0.7
    updatedAt: FsTimestamp;
    updatedBy: string;
  };
}
```
- **Storage:** image at `games/{gameId}/overlay/arena.<ext>`; `storage.rules` — GM-of-the-game write,
  members read (mirror the ration-photo pattern). Enable + deploy `storage.rules`.

**Approach:**
- **Web authoring (`web/`):** in setup, an "Arena overlay" panel — upload the image (Firebase JS SDK
  Storage), then a draggable/scalable **4-corner editor** over the Mapbox map (reuse the
  `mapbox-gl-draw` interaction style already used for polygon authoring). Persist `corners` + `url` +
  `opacity` to the game doc via the game-doc update (GM-only). Default the corners to the boundary's
  bbox on first upload so the GM starts from a sane quad.
- **Web render:** Mapbox `image` source + `raster` layer using the 4 `corners` (true quad,
  rotation-capable), below the checkpoint/player marker layers, honoring `opacity`. Add to
  `web/src/components/GameMap.tsx`.
- **Mobile render (`components/GameMap.tsx`):** react-native-maps `<Overlay image={{uri:url}}
  bounds={[[minLat,minLng],[maxLat,maxLng]]} />`. **Documented limitation:** `Overlay` is
  axis-aligned (2-corner bbox), so mobile renders the **bounding box** of the 4 corners — no
  rotation/skew. Derive the bbox from `corners`. View-only on mobile.
- **Rules:** add `'mapOverlay'` to the game-doc `affectedKeys().hasOnly([...])` whitelist.

**Surface:** web (author + render), mobile (render), storage rules, firestore rules. **Schema:**
`Game.mapOverlay`.

## 3. #44 — Voucher-site run-sheet preset *(Tier 11 · client only · small)*

**Goal:** one tap scaffolds the open/close/announce run-sheet rows for a time-windowed "voucher"
checkpoint, since vouchers are paper/in-person (the app mints nothing).

**Approach (no schema — reuses `scheduledEvents` + the timed-reveal model):**
- In the run-sheet authoring UI (mobile `app/(app)/gm/[gameId]/runsheet.tsx` + web `RunbookScreen`),
  add a **"Voucher site" preset** action: pick a checkpoint, an **open** offset, and a **close**
  offset; the preset then scaffolds, via the existing `addScheduledEvent`:
  - a `reveal-checkpoint` row at *open* (marker becomes visible), if the checkpoint is
    `shown-on-trigger`;
  - a `broadcast` "🎟️ Voucher site **<name>** is open at <place>" at *open*;
  - a `broadcast` "⏳ **<name>** voucher site closes in N min" a few minutes before *close*;
  - a `broadcast` "🚫 **<name>** voucher site is now closed" at *close*.
- Pure client scaffolding over existing helpers — no functions, rules, or schema. The GM can edit/
  delete any scaffolded row afterward (they're ordinary run-sheet rows).

**Surface:** mobile + web run-sheet UI. **Schema:** none.

## 4. #43 — Night-before practice game *(Tier 11 · client + functions · deprioritized)*

**Goal:** a disposable, badged, re-runnable on-site dress-rehearsal game that exercises
joins/tracking/events/pushes end-to-end, with relaxed guards and a GM readiness view.

**Schema** (`types/index.ts`):
```ts
export interface Game { practice?: boolean; }       // GM-write-only, set at createGame
export interface Checkpoint { test?: boolean; }      // "drop test checkpoint here" marker
```

**Approach:**
- **Create:** `createGame` gains an optional `practice: true` (set server-side, like `isTest`). Every
  screen shows a **PRACTICE** badge (reuse the test-event badge styling).
- **Relaxed guards:** the integrity invariants that block destructive actions (#20 member delete-lock
  in play, #22 monotonic-phase, #28 End-Game confirm/unaccounted block) are **bypassed when
  `practice`** — the point is to tear down and re-run freely (client checks + a rules carve-out where
  those invariants are rule-enforced, e.g. the member delete-lock `gamePhase(gameId) != 'play'`
  gains `|| game.practice == true`).
- **Drop test checkpoint here:** a GM action that creates a `test: true` checkpoint at current GPS
  (generous radius, a demo runbook entry), firing the real `onLocationUpdate` path so events/pushes
  can be verified off-venue.
- **GM reset:** clears `arrivals`/`locations`/`rations` (+ `checkpointTrips`/`entryTrips`) so a
  rehearsal can be re-run; practice games **auto-delete** (doc + Storage photos) on end — extend
  `cleanupRationPhotosOnGameEnd` to `recursiveDelete` the whole game when `practice`.
- **Readiness view:** derived GM-side state (no schema) — joined-vs-expected, fresh-fix count
  (`services/locationStatus.ts`), per-device push confirmation.

**Surface:** mobile + web (badge/reset/readiness/drop-test), functions (createGame practice,
cleanup extension), rules (practice carve-outs). **Schema:** `Game.practice`, `Checkpoint.test`.

## 5. #45 — Post-game media *(Tier 11 · client + functions + rules · lowest priority)*

**Goal:** after `results`, let a GM attach a YouTube recap + Google Photos album; everyone but the
setter is pushed "recap is up"; results screens show outbound links.

**Schema** (`types/index.ts`):
```ts
export interface Game {
  media?: {
    youtubeUrl?: string;        // validate host: youtube.com / youtu.be
    photosAlbumUrl?: string;    // validate host: photos.google.com / photos.app.goo.gl
    updatedAt: FsTimestamp;
    updatedBy: string;
  };
}
```

**Approach:**
- **Authoring:** GM-only, on the **results** screen (gated on the game being finished). Host-validate
  the two URLs client-side before write.
- **Notify:** a Firestore-trigger Cloud Function (`onGameMediaWrite`, `games/{gameId}` onUpdate) fires
  when `media.youtubeUrl`/`photosAlbumUrl` changes, writes a `kind: 'gm-message'` broadcast, and
  pushes every member token **except the setter** (`media.updatedBy`) — reuses the broadcast/push
  pipeline (`Broadcast.pushed`).
- **Display:** results screens (mobile + web) show outbound **Watch**/**View** links
  (`Linking.openURL` / `<a target="_blank" rel="noopener">`) — no in-app player.
- **Rules:** add `'media'` to the game-doc `affectedKeys().hasOnly([...])` whitelist.

**Surface:** mobile + web (results authoring + links), functions (media trigger), rules. **Schema:**
`Game.media`.

---

## Build sequence

1. **#41** end-game phase — touches phase plumbing across both clients + functions + rules; do first
   so the `GamePhase` change settles before other work.
2. **#42** arena overlay — web author + both render + storage/rules; self-contained.
3. **#44** voucher preset — small, client-only over existing run-sheet helpers.
4. **#43** practice game — deprioritized; schema + guards + cleanup.
5. **#45** post-game media — lowest priority; schema + trigger + rules.
6. After each: web `npm run build` + functions `npm run build` + mobile `tsc --noEmit` + lint +
   (rules changes) `firebase_validate_security_rules`.

**Trim options:** ship the focused three (#41/#42/#44) and defer #43/#45.

## Deploy & APK split
- **Deploy now (no APK):** the server/web/rules sides — #41 geofence + ration gates + rules; #42 web
  author/render + storage/firestore rules; #45 media trigger + rules; #43 functions (createGame
  practice + cleanup) once built.
- **Next APK (only when asked):** the mobile halves — #41 end-game UI + player rally view; #42 mobile
  overlay render; #44 mobile voucher preset; #43 mobile badge/reset/drop-test/readiness; #45 mobile
  results links. The `preview` profile auto-bumps the version, so each APK gets a unique
  runtimeVersion.

## Definition of done (per item)
- [ ] Code + builds green (web, functions, RN tsc, lint; rules validated where touched).
- [ ] Roadmap updated: move to the **Built & removed** callout in `ROADMAP.md`; prune the
      `ROADMAP_DATA_MODEL.md` entry; delete the section here.
- [ ] Committed to `main` (when asked); deployed / queued per the split above.

## Open sub-decisions (flag during build, sensible defaults chosen above)
- **#42 mobile fidelity:** axis-aligned bbox render is the default (react-native-maps `Overlay`
  limit). If true-quad mobile rendering is needed later, it requires a custom tile/skew approach —
  out of scope here.
- **#41 convergence checkpoint:** the rally is a plain marker by default. If the GM should be able to
  attach a *runbook effect* at the rally (e.g. a final hazard), that's a follow-up — the geofence
  already keeps firing in `endgame`, so it's purely authoring UI.
- **#43 build timing:** deprioritized — "slot in just ahead of the first real rehearsal." Confirm
  before building if APK budget is tight.
