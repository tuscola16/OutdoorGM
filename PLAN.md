# Implementation Plan — next 5 roadmap items

**Status:** not started. **Created:** 2026-06-08. **Owner:** (pick up in a fresh session.)

This plan covers the **next 5 recommended roadmap items** — the P1 field-test batch from
[ROADMAP.md](ROADMAP.md) "Suggested order": **#74, #63, #64, #68, #72**. Each has
implementation-ready detail keyed to the same numbers in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md). When an item lands, mark it built per the roadmap
convention (move to the Built & removed callout; never reuse numbers) and delete its section here.

> **How to use this doc in a new session:** read the *Orientation* section first (it's a monorepo
> with three surfaces and a specific deploy story), then do *Shared groundwork*, then the items in
> the *Build sequence* order. Don't kick an EAS build without the user explicitly asking
> (rate-limited — see `~/.claude` memory / CLAUDE.md).

---

## Orientation (read first)

**Repo:** `OutdoorGM` — React Native (Expo) player/GM app + a web GM dashboard + Firebase backend.
Three code surfaces:

| Surface | Path | Lang/stack | How it reaches the field |
| --- | --- | --- | --- |
| **Mobile app** (players + GM) | `app/`, `components/`, `hooks/`, `services/`, `context/` | Expo RN + `@react-native-firebase` | **Needs an EAS APK build** (cannot hot-deploy) |
| **Web GM dashboard** | `web/` (Vite + React + Firebase JS SDK) | uses `@shared` alias → repo-root `types/` | `firebase deploy --only hosting` |
| **Cloud Functions** | `functions/src/` (admin SDK) | TS, 1st-gen functions | `firebase deploy --only functions` |
| **Rules** | `firestore.rules`, `storage.rules` | — | `firebase deploy --only firestore:rules` (or `storage`) |

Shared TypeScript types live in repo-root **`types/index.ts`** — imported by web via the `@shared`
alias and by mobile via `@/types`. The geofence/functions can't import them, so functions **mirror**
the types inline (see top of `functions/src/geofence.ts`).

**Build / verify commands:**
```bash
# Web (run inside web/):  tsc --noEmit && vite build
cd web && npm run build && cd ..
# Functions (inside functions/): tsc
cd functions && npm run build && cd ..
# Mobile typecheck (repo root): catches RN type errors
npx tsc --noEmit -p tsconfig.json   # NOTE: 2 pre-existing expo-router Href errors in
                                    # app/(app)/gm/[gameId]/checkpoints.tsx + runsheet.tsx are
                                    # KNOWN/flaky (typed-routes generation) — ignore those two.
# Lint: web → (inside web/) npx eslint src/...   |   mobile → (root) npx eslint "app/(app)/..."
#   ⚠ Run web eslint from INSIDE web/ (root eslint can't resolve the @ alias → false positives).
```

**Deploy story for this batch:** every item below is split into a **web/functions half (deploy
now, backward-compatible with the installed APK)** and a **mobile half (ships with the next APK)**.
Land the deployable halves first; bundle all mobile halves into one EAS build at the end.

**Already deployed this cycle (don't re-do):** `onLocationUpdate` (per-entry tripping + enriched
`entryTrips`), `cloneGame`, `onBroadcastCreate`, rules (`entryTrips` GM-readable), and hosting.
**Already built but NOT yet in an APK** (will ride the next build alongside this batch): #66 mobile
ration gating, #70 persistent `AlertOverlay`, mobile Clone action.

**Conventions:** commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
work on `main` (push when the user asks — they've been fine with push, but **deploy only on request**
for this batch unless told otherwise); new shared-type fields stay **optional** so legacy games keep
working.

---

## Shared groundwork (do this first — ~S)

Two helpers are reused by multiple items. Build them once.

### G1. Client `pointInBoundary` (for #64)
The boundary test only exists **server-side** today in `functions/src/geofence.ts` (`pointInBoundary`
+ `pointInPolygon`, ~lines 123–148: polygon ray-cast when `boundary.polygon.length >= 3`, else
min/max bbox). Port a client copy:
- **Web:** add to `web/src/services/` (e.g. `geo.ts`), exported `pointInBoundary(lat, lng, boundary: MapBoundary)`.
- **Mobile:** add the same to `services/` (e.g. `services/geo.ts`).
- (Optional nicer: a single module under repo-root importable by both via aliases — but a ~15-line
  duplicate in each client is acceptable and lower-risk.)
- Keep the signature identical to the server's so behavior matches exactly. `MapBoundary` is in
  `types/index.ts`.

### G2. Shared numeric-config validator (for #63)
Add `validateGameConfig(cfg): Record<string, string>` (field → human error) + small per-field
helpers (`requirePositiveInt`, ordering check). Put it where both the web `ConfigModal` and the
mobile config screen can import it. Web reads config types from `@shared`; mobile from `@/types`. A
pragmatic option is a tiny pure module duplicated per client (no RN/web imports), or a shared
root module. Rules enforced:
- every numeric field **> 0** (no 0/negative): `durationMinutes`, `rationIntervalMinutes`,
  `rationWindowMinutes`, `tripIntervalMinutes`, `geofenceConfirmFixes`, `reNotifyAwayCooldownMinutes`,
  reveal `offsetMinutes`, runbook timed `atMinute` (≥ 0 ok here), runbook `priority` (any int),
  checkpoint `radius` ≥ 10.
- **ordering:** `rationWindowMinutes ≤ rationIntervalMinutes ≤ durationMinutes`.
- Return inline messages; **do not silently clamp** (today the web `ConfigModal.save()` silently
  `Math.max`/`Math.min`-clamps — replace with validation + a visible reason).

---

## 1. #74 — GM-prompted notification missing from the player's feed  *(P1 · S · mobile-first)*

**Goal:** firing a `gm-prompted` runbook entry at a player makes the message appear in that player's
in-app notification list (and as a push).

**Context / where it lives:**
- GM fires via the `fireRunbookEntry` callable — `functions/src/runbook.ts`. For a **targeted**
  non-`gm-notify` effect it writes a `broadcasts/*` doc `{ kind:'checkpoint-event', eventKind,
  message, targetPlayerId: <playerId>, pushed:true }` and pushes that player's token. For
  `gm-notify` kind it does **GM-only** (no player broadcast — by design). For all-players `notify`
  it writes one global broadcast (`targetPlayerId:null`).
- Player feed: `context/BroadcastsContext.tsx` runs two listeners and merges — `targetPlayerId == null`
  **and** `targetPlayerId == uid`. `components/BroadcastFeed.tsx` renders the merged list;
  `components/broadcastVisuals.ts` already maps `checkpoint-event` (hazard/boon/notify) → icon/color/title.

**So the happy path *should* already work.** This is **investigate-then-fix**; check in order:
1. **Most likely:** the test fired a **`gm-notify`** entry (GM-only by design → no player broadcast).
   Confirm the entry's `effect.kind`. If the expectation is "player sees gm-prompted gm-notify," that's
   a product decision — gm-notify is defined as GM-only; a player-facing prompt must be `notify`.
2. Verify the targeted broadcast doc actually lands with `targetPlayerId == <thatPlayer's uid>`
   (read `games/{id}/broadcasts` live via the Firebase MCP during a repro).
3. Verify `BroadcastsContext`'s "mine" listener is active (it needs `auth().currentUser?.uid`); on a
   cold/poor connection confirm it isn't being dropped.
4. Confirm `BroadcastFeed` doesn't filter out `checkpoint-event` or dedupe it away.

**Likely fix candidates:** if all-players vs targeted is the gap, ensure `fireRunbookEntry`'s
targeted branch is taken when the GM picks a specific player; if it's a feed-render gap, fix
`BroadcastFeed`/`broadcastVisuals`. **Files:** `functions/src/runbook.ts`, `context/BroadcastsContext.tsx`,
`components/BroadcastFeed.tsx`, `components/broadcastVisuals.ts`. **Surface:** mobile (+ maybe functions).
**Verify:** GM fires a **targeted `notify`** entry at one player → that player sees it in-feed + push;
other players don't. Fire an **all-players `notify`** → everyone sees it. **Risk:** low.

---

## 2. #63 — Numeric-field validation + cross-field bounds  *(P1 · M · web now + mobile APK)*

**Goal:** no numeric field accepts 0/negative; dependent fields stay ordered
(`rationWindow ≤ rationInterval ≤ gameLength`; `radius ≥ 10`); errors are shown inline, not clamped.

**Approach:** use **G2** (`validateGameConfig` + field helpers) in every save path; block save + show
the message.

**Web inputs to cover (`web/src/screens/`):**
- `GameScreen.tsx` → `ConfigModal.save()` — currently clamps `durationMinutes` (`Math.max(5,…)`),
  `rationIntervalMinutes`, `rationWindowMinutes` (clamped to interval), and `tripIntervalMinutes`.
  Replace clamps with validation. Also covers `playerCountBroadcast`/toggles (no validation needed).
- `GameScreen.tsx` → `NewCheckpointModal` + `CheckpointBehaviorModal` radius (`radius >= 10`, already
  partially checked — make consistent).
- `RunbookScreen.tsx` → `EntryEditor` priority (int) and `BoundEditor` `atMinute` (≥ 0); reveal
  `offsetMinutes` in `CheckpointBehaviorModal`.

**Mobile inputs to cover:**
- Config editing on the GM game screen — `app/(app)/gm/[gameId]/index.tsx` (search for
  `updateGameConfig` / the duration/ration inputs).
- Checkpoint radius — `components/checkpointForm.tsx` and/or `app/(app)/gm/[gameId]/checkpoint/[checkpointId].tsx`.

**Surface:** web (deploy now) + mobile (APK). **No schema.** **Effort:** M (lots of inputs).
**Risk:** low; mostly additive guards. **Verify:** can't save `window > interval`,
`interval > gameLength`, `radius < 10`, or any field = 0 — each shows a specific message.

---

## 3. #64 — Constrain checkpoints to the play boundary  *(P1 · M · web now + mobile APK)*

**Goal:** a GM can't place (or drag) a checkpoint outside the set boundary.

**Approach:** use **G1** (`pointInBoundary`). On placement and on edit-save, reject a coordinate that
fails the test with a clear "outside the play area" message. If **no boundary is set yet**, either
require one first or warn (recommend: warn + allow, since GMs sometimes place before drawing — decide
with product, default to *block with a "draw the boundary first" message*).

**Web (`web/src/screens/GameScreen.tsx`):**
- `SetupView.handleMapClick(coord)` — guard before opening `NewCheckpointModal` (or inside the modal's
  save). The map + boundary already live here; `GameMap` calls `onMapClick`.
- `CheckpointBehaviorModal` save — re-validate lat/lng (covers any future drag-to-move).

**Mobile:** `app/(app)/gm/[gameId]/checkpoints.tsx` (map placement) + the checkpoint form save path.

**Surface:** web (deploy now) + mobile (APK). **No schema.** **Effort:** M. **Risk:** low — but make
the polygon/bbox test exactly mirror the server's so a placed checkpoint can always actually fire.
**Verify:** click/drag outside polygon (and outside bbox for rectangle boundaries) → rejected; inside
→ allowed; no-boundary → the chosen guard message.

---

## 4. #68 — Server-enforce unique ration card numbers  *(P1 · M · functions now + mobile APK)*

**Goal:** with `config.enforceUniqueRationCards` on, a duplicate card number is **blocked at
submission**, not just flagged after the fact.

**Current flow (all client-side):** mobile `components/RationPanel.tsx` uploads the photo to Storage
(`services/storage.ts`) then calls `submitRation(...)` in `services/gameService.ts`, which does a
direct client Firestore write to `games/{id}/rations/{playerId}_{intervalIndex}`. `firestore.rules`
(~line 155) currently allows a member to `create` their own pending ration. Rules **can't** do a
"is this card number unique across the collection" check.

**Approach — move submission behind a callable:**
1. New `submitRation` **callable** in `functions/src/` (+ export in `functions/src/index.ts`). It:
   - verifies the caller is a non-GM member of the game and the game is in `play`;
   - if `enforceUniqueRationCards` and a `cardNumber` is given, runs a **transaction**: query
     `rations` for a non-`rejected` doc with the same `cardNumber` **by a different player** → if
     found, throw `HttpsError('failed-precondition', 'card-in-use')`;
   - writes the deterministic `{playerId}_{intervalIndex}` doc (idempotent: the *same* player
     re-submitting the *same* card is fine).
2. `firestore.rules`: change `rations` `create` to `if false` (only the callable/admin writes); keep
   GM/owner `read` and GM/owner `update` (the GM review path `reviewRation` is a client update — keep
   it, or also move to a callable later; out of scope here).
3. Client: `services/gameService.ts` `submitRation` → call the callable; `RationPanel.tsx` catches
   `card-in-use` and shows an inline error (don't consume the window). Keep the GM "reused" flag in
   the review feed as a backstop.

**Surface:** functions + rules (deploy now) + mobile (APK). **Schema:** none. **Effort:** M.
**Risk:** medium — the create-rule change means **the new callable must ship before/with the rules
change**, and the **old APK still writes directly** until the new APK ships. Sequence carefully:
deploy the callable, but **delay the `rations` create-rule lock** until the APK that uses the callable
is out — otherwise the installed app's direct writes break. (Until then, the callable can coexist;
keep the permissive create rule, ship the APK, then tighten the rule.) **Verify:** two players submit
the same card # with enforcement on → second gets a clear inline rejection; same player re-submitting
their own card is accepted.

---

## 5. #72 — Reliable ration-window-open notification  *(P1 · M · functions now + mobile APK)*

**Goal:** the "window is open" alert stops firing 2–3 minutes late.

**Diagnosis:** `hooks/useRationReminders.ts` already schedules a local notification per interval with
deterministic ids and **reschedules on config/`startedAt` change** (effect deps). So the logic is
sound — the lateness is almost certainly **OS delivery latency** of a scheduled *local* notification
on a dozing device. The robust fix is a **server push** as the source of truth.

**Approach (two-pronged):**
1. **Server (authoritative):** new scheduled function `functions/src/rationPings.ts` (sibling to
   `runScheduledEvents` in `runsheet.ts`) running `every 1 minutes`. For each `play`-phase game with
   `rationsEnabled`, compute whether a ration window just opened (reuse the interval math —
   `windowStartsAt`), and if so push **living players once** via `sendPushToTokens(..., 'broadcasts')`.
   Dedup with an idempotent latch `games/{id}/rationWindowPings/{intervalIndex}` (create-if-absent;
   admin-only in rules; purge on game end in `functions/src/cleanup.ts` alongside the others). Export
   in `index.ts`.
2. **Client (fallback):** keep `useRationReminders` as a fast-path local fallback; optionally tag its
   notification so it's deduped against the server push if both arrive (or just accept a rare double —
   harmless). Minor hardening only.

**Surface:** functions + rules (deploy now) + mobile (APK, only if you touch the hook). **Schema:**
new admin-only `rationWindowPings` subcollection (rule + cleanup). **Effort:** M. **Risk:** medium —
a per-minute collection-group sweep over active games (model cost; mirror `runScheduledEvents`'s
pattern and guards). **Verify:** with a short interval/window, the open push lands within ~60 s of the
boundary, exactly once per window, even with the app backgrounded/locked.

---

## Build sequence

1. **Shared groundwork** G1 (`pointInBoundary`) + G2 (`validateGameConfig`).
2. **#74** — smallest; closes the loop on the recent notification work. Investigate first.
3. **#63 → #64** together — both touch the same web + mobile authoring screens (`ConfigModal`,
   checkpoint forms, placement).
4. **#68 → #72** together — both add a callable / scheduled function + rules + a mobile touchpoint.
5. After each item: web `npm run build` + functions `npm run build` + root `tsc --noEmit` + lint
   (web from inside `web/`).

## Deploy & APK rollout

- **Phase 1 — deploy now (no APK):** `firebase deploy --only functions,firestore:rules,hosting`
  carrying: #63 web validation, #64 web placement guard, #68 `submitRation` callable + #72
  `rationPings` function, and the `rationWindowPings` rule. **Hold the `rations` create-rule lock
  (#68 step 2) until the APK ships** (see #68 risk).
- **Phase 2 — one EAS APK** (only when the user asks): mobile halves of #63/#64/#68/#72 + #74, **plus
  the already-built-but-unshipped** #66 mobile gating, #70 persistent modal, mobile Clone, and the
  stale-OS-notification-tray cleanup (`Notifications.dismissAllNotificationsAsync()` on `play` start)
  — so a single build clears the whole mobile backlog. After it's live, tighten the #68 `rations`
  create rule and deploy rules.

## Definition of done (per item)
- [ ] Code + builds green (web, functions, RN tsc, lint).
- [ ] Roadmap updated: move the item to the **Built & removed** callout in `ROADMAP.md` with a
      one-line summary + deploy/APK status; remove its section from `ROADMAP_DATA_MODEL.md`; delete
      its section here.
- [ ] Committed + pushed to `main`.
- [ ] Deployed (phase 1) and/or queued for the APK (phase 2), per the rollout above.

## After these five
**#77** (closed-phone pass-through) is the next P1 but is **held for an on-device locked-phone test**
rather than blind code changes — `hooks`/background-location cadence tuning + possibly enlarging
`MAX_SEGMENT_METERS` or a foreground-resume retro-test in `functions/src/geofence.ts`. Then the P2
polish: **#62** (/demo audit), **#71** (in-list dismiss + cross-device `Broadcast.dismissedBy`),
**#75** (GM notifications page — builds on #73's `entryTrips`-driven feed).
