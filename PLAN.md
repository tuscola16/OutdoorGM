# Implementation Plan — next 5 roadmap items

**Status:** not started. **Created:** 2026-06-08. **Owner:** (pick up in a fresh session.)

This plan covers the **next 5 recommended roadmap items** from [ROADMAP.md](ROADMAP.md): the three
outstanding **P2 field-test polish** items **#62, #75, #71**, then the next-tier work the roadmap's
"Suggested order" points to — **#11** (Tier 4, completes the ration loop) and **#61** (Tier 14,
restores timed announcements lost when the web run-sheet UI was removed). Implementation-ready
detail is keyed to the same numbers in [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md). When an item
lands, mark it built per the roadmap convention (move to the Built & removed callout; never reuse
numbers) and delete its section here.

> **The remaining P1, #77** (closed-phone pass-through), is intentionally **not** in this batch — the
> roadmap holds it for an **on-device locked-phone test** rather than blind code changes. See *After
> these five*.

> **How to use this doc in a new session:** read the *Orientation* section first (it's a monorepo
> with three surfaces and a specific deploy story), then do the items in *Build sequence* order.
> Don't kick an EAS build without the user explicitly asking (rate-limited — see `~/.claude`
> memory / CLAUDE.md). Deploy only on request.

---

## Orientation (read first)

**Repo:** `OutdoorGM` — React Native (Expo) player/GM app + a web GM dashboard + Firebase backend.
Three code surfaces:

| Surface | Path | Lang/stack | How it reaches the field |
| --- | --- | --- | --- |
| **Mobile app** (players + GM) | `app/`, `components/`, `hooks/`, `services/`, `context/` | Expo RN + `@react-native-firebase` | **Needs an EAS APK build** (cannot hot-deploy) |
| **Web GM dashboard** | `web/` (Vite + React + Firebase JS SDK) | uses `@shared` alias → repo root | `firebase deploy --only hosting` |
| **Cloud Functions** | `functions/src/` (admin SDK) | TS, 1st-gen functions | `firebase deploy --only functions` |
| **Rules** | `firestore.rules`, `storage.rules` | — | `firebase deploy --only firestore:rules` (or `storage`) |

Shared TypeScript types live in repo-root **`types/index.ts`** — imported by web via the `@shared`
alias and by mobile via `@/types`. **Pure cross-client helpers** now live in repo-root **`common/`**
(created in the prior batch): web imports `@shared/common/<x>`, mobile imports `@/common/<x>`. Both
aliases resolve to the repo root (`web/tsconfig.json` + `web/vite.config.ts`; mobile `babel.config.js`
+ `tsconfig.json`). The geofence/functions can't import app types, so functions **mirror** them inline
(see top of `functions/src/geofence.ts`, `rations.ts`, `rationPings.ts`).

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
# Rules: validate with the Firebase MCP (firebase_validate_security_rules) before deploying.
```

**Already deployed this cycle (don't re-do):** the **#63/#64/#68/#72/#74** batch is live — web
validation + boundary guard, the `submitRation` callable, the `rationPings` scheduled function, the
admin-only `rationWindowPings` rule, and the gm-notify fire warning. Functions, rules, and hosting
were deployed; the **mobile halves ride the next APK**.

**⚠ Standing deploy debt — do this when the next APK ships (before/with this batch's APK):** the
**#68 `rations` create-rule lock** is still deferred. The installed APK writes ration docs directly;
once the new APK (which uses the `submitRation` callable) is out, change the `rations` `create` rule
in `firestore.rules` to `if false` and `firebase deploy --only firestore:rules`. Until then, leave it
permissive.

**Conventions:** commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`;
work on `main` (push + deploy only when the user asks); new shared-type fields stay **optional** so
legacy games keep working.

---

## 1. #62 — Audit the `/demo` screen for parity with shipped features  *(P2 · S · web-only, deploy now)*

**Goal:** the marketing/`/demo` mocks honestly reflect the current app, so store screenshots aren't a
lie.

**Where it lives:** `web/src/screens/DemoScreen.tsx` — static screenshot mocks of the player + GM
screens. It has drifted from two shipped changes:
- **#60 checkpoint/runbook overhaul** — checkpoints are now *identity + visibility only*; all behavior
  (hazard/boon/notify/gm-notify, fixed-order/always-on/timed/gm-prompted) lives in the **Runbook**.
  Any mock that shows "event type" *on the checkpoint* is stale; show the Runbook model instead.
- **Terminal ration approval** — a reviewed ration is final (no GM undo); the player sees a "fed this
  window" state (`RationPanel`'s `status === 'valid'` branch). Refresh any ration mock to match.

**Approach:** walk each mocked screen in `DemoScreen.tsx` against the live app
(`web/src/screens/GameScreen.tsx`, `RunbookScreen.tsx`, mobile `RationPanel.tsx`) and refresh
copy/controls/layout. Pure content/markup — **no schema, no logic**. Also sanity-check colors/labels
against `constants/colors.ts` + `web/src/services/checkpointKinds.ts` so the mock matches real
KIND/VIS metadata.

**Surface:** web only. **Deploy:** hosting. **Effort:** S. **Risk:** very low (static content).
**Verify:** open `/demo` locally (`cd web && npm run dev`), compare each panel to the real screens;
no mention of on-checkpoint event types, ration approval shown as terminal + "fed this window".

---

## 2. #75 — GM notification feed: cap the sidebar + full notifications page  *(P2 · M · web-only, deploy now)*

**Goal:** with ~24 players the Play-view **Notifications** sidebar gets unusable; cap it and give the
GM a full, filterable page.

**Where it lives:** `web/src/components/NotificationFeed.tsx` already derives a unified, filterable
stream from `entryTrips` (#73 fired events) + neutral arrivals + sos/death, with a filter chip row
(`All/Events/Arrivals/Safety`). It's rendered in `GameScreen.tsx` `PlayView` under the "Notifications"
`<h3>` (a fixed-height `minHeight:0` container).

**Approach:**
1. **Cap the sidebar:** pass a `max` (e.g. 4) prop into `NotificationFeed` (or render a capped slice
   in `PlayView`) so the sidebar shows only the latest 4 rows. Keep the existing filter chips out of
   the capped sidebar (or hide them there) to save vertical space — decide for cleanliness.
2. **Make the header a button:** turn the "Notifications" `<h3>` in `PlayView` into a clickable
   control that opens a full view. Reuse the existing `Modal` (`web/src/components/Modal.tsx`, already
   used across `GameScreen`) holding a **full-height** `NotificationFeed` (no cap) with its
   filter chips and scroll. Optionally extend the filters to include by-player / by-checkpoint /
   by-kind (the `Notif` items already carry player/checkpoint/kind-derived fields — add a secondary
   filter or a search box; keep it simple if time-boxed).

**Surface:** web GM dashboard only. **Schema:** none. **Effort:** M (mostly a modal + a `max` prop +
wiring). **Risk:** low. **Verify:** seed many arrivals/trips; the sidebar shows 4, the header opens a
scrollable modal showing all, filters work.

---

## 3. #71 — Players dismiss notifications from the in-app list  *(P2 · M · rules now + mobile APK)*

**Goal:** a player can clear items from their in-app notification list, and (optionally) that
dismissal syncs across their devices.

**Context / where it lives:**
- #70 shipped a **device-local** dismissed set: `components/AlertOverlay.tsx` persists acked ids in
  `AsyncStorage` (`acked_broadcasts_{gameId}`) so a backgrounded event still re-pops once, then is
  suppressed when cleared. That covers the *heads-up modal*, **not** the persistent
  `components/BroadcastFeed.tsx` list (which has no dismiss control today).
- The shared subscription is `context/BroadcastsContext.tsx` (global + own-targeted broadcasts merged,
  newest-first). `BroadcastFeed` renders `useBroadcasts().broadcasts`.

**Approach (two layers — do the schema/server half first so it deploys without an APK):**
1. **Cross-device model (schema + rules + service — deploy now):** add an optional field to
   `Broadcast` in `types/index.ts` (see [ROADMAP_DATA_MODEL.md §71](ROADMAP_DATA_MODEL.md)):
   ```ts
   /** Per-player handling: userIds who dismissed this broadcast in-app (#71). */
   dismissedBy?: string[];
   ```
   Add a `dismissBroadcast(gameId, broadcastId, uid)` service that writes
   `dismissedBy: arrayUnion(uid)` (mobile `services/gameService.ts`; web mirror not needed — players
   are mobile-only). **`firestore.rules`:** today only GMs may `update` a broadcast; add a narrow
   self-update clause letting a **player** update **only** `dismissedBy`, adding **their own** uid —
   `affectedKeys().hasOnly(['dismissedBy'])` and the new value's `dismissedBy` differs from the old
   only by `request.auth.uid` (mirror the careful diff style already used for member self-updates and
   the SOS-ack rule). Keep co-GM (`audience:'gm-only'`) broadcasts off-limits to players.
2. **In-list dismiss control (mobile — APK half):** add a small dismiss affordance (an ✕ / swipe) to
   each row in `BroadcastFeed.tsx`; on tap call `dismissBroadcast`. Filter the list in
   `BroadcastsContext` (or in `BroadcastFeed`) to hide broadcasts whose `dismissedBy` includes the
   current uid. Keep the device-local `AlertOverlay` ack as-is — it governs the *pop*, this governs the
   *list*; optionally have an in-list dismiss also `ack()` the overlay set so the two agree.

**Surface:** mobile (APK) + rules (deploy now) + 1 optional schema field. **Effort:** M. **Risk:**
medium — the rules clause is the sharp edge (don't let a player edit anyone else's broadcast or any
field but `dismissedBy`). **Validate the rule with the Firebase MCP**, and test that a player can add
only their own uid. **Verify:** player dismisses an item → it leaves their list and stays gone on
reopen + on a second device; other players still see it; a player can't dismiss for others or edit
other fields.

---

## 4. #11 — Auto-starvation sweep  *(Tier 4 · M · functions now + opt-in config UI for the APK)*

**Goal:** at each ration-interval boundary, a living player with no valid ration for the **prior**
interval is auto-eliminated (`cause: 'starvation'`) — gated behind `starvationMode: 'auto'` (default
stays `gm-confirmed`, i.e. manual, until the photo path is field-proven).

**Context / where it lives:**
- `GameConfig.starvationMode` (`'auto' | 'gm-confirmed'`) already exists in `types/index.ts`
  (default `'gm-confirmed'`), but **no UI exposes it** and **no function acts on it**.
- The interval math is `rationInterval(game, now)` (`services/gameService.ts`); a submission is
  `rations/{playerId}_{intervalIndex}` with `status` `pending|valid|rejected`.
- Eliminating a player = set `member.out`/`outAt`/`cause` (here `'starvation'`). The death broadcast
  **and** winner detection then fire automatically in `functions/src/members.ts` `onMemberWrite`
  (`handleDeath`) — so the sweep only needs to flip the member doc; **do not** duplicate the death
  broadcast.

**Approach (mirror `rationPings.ts` — that file is the template):**
1. **Scheduled function** `functions/src/starvation.ts`, `every 1 minutes`. Query
   `games.where('phase','==','play')` (single-field index, like `rationPings`). For each game with
   `rationsEnabled !== false` **and** `starvationMode === 'auto'`:
   - resolve the interval math inline (reuse the same constants as `rationPings.ts`); compute the
     **just-closed** interval `i-1` when the current interval boundary was crossed in the last ~minute
     (i.e. a window just *ended*). Only act on the boundary so we evaluate each interval once.
   - for each living non-GM member, check for a **non-rejected** `rations/{uid}_{i-1}` doc; if absent,
     mark `out: true, outAt: serverTimestamp(), cause: 'starvation'` (let `onMemberWrite` handle the
     toll + winner). Use an **idempotent latch** `games/{id}/starvationSweeps/{intervalIndex}`
     (create-if-absent transaction, like `rationWindowPings`) so overlapping sweeps don't double-run;
     admin-only rule; purge in `cleanup.ts`. (Marking an already-`out` player is also naturally
     idempotent — `rose(before,after,'out')` won't re-fire.)
   - When `starvationMode !== 'auto'` (default): do nothing automatic — the GM still eliminates by hand
     from the Players list (today's behavior; the "not eaten this window" glance already exists).
   - Export in `functions/src/index.ts`.
2. **Opt-in toggle (web + mobile config — the deploy-now-safe but APK-visible half):** surface
   `starvationMode` as a toggle in the game-settings modal (web `ConfigModal` in
   `GameScreen.tsx`; mobile config modal in `app/(app)/gm/[gameId]/index.tsx`) — "Auto-eliminate on
   missed ration" → writes `starvationMode: 'auto' | 'gm-confirmed'`. Default off. (Web toggle deploys
   now; the mobile toggle rides the APK. The function is harmless until a GM opts in.)

**Surface:** functions + rules + cleanup (deploy now) + config UI (web now, mobile APK). **Schema:**
new admin-only `starvationSweeps` latch subcollection; reuses existing `starvationMode`. **Effort:**
M. **Risk:** medium — **auto-elimination is destructive**; keep the default manual, make the toggle's
copy explicit, and be careful the interval-boundary math evaluates the *prior* (fully-closed) interval
so no one is starved mid-window. Idempotency is mandatory (#26). **Verify (emulator):** short interval,
`starvationMode:'auto'`, one player skips a window → exactly one starvation elimination at the
boundary + the existing death toll; a player who submitted (valid or pending) survives; re-running the
sweep doesn't double-eliminate.

---

## 5. #61 — Timed, crossing-independent actions in the Runbook  *(Tier 14 · M · web now + functions)*

**Goal:** restore the **clock-triggered, crossing-independent** actions the web run-sheet UI used to
author (removed alongside #60), folded into the web Runbook editor: a **timed announcement**, the
**auto living-player-count** broadcast, a **gear-drop** announcement, and a **GM-only timed reminder**.
(Timed *checkpoint reveal* is NOT lost — it's covered by `reveal.trigger:'timed'`.)

**Context / where it lives:**
- The backend already runs them: `functions/src/runsheet.ts` `runScheduledEvents` sweeps
  `games/{id}/scheduledEvents` (`firedAt == null`) every minute and executes `broadcast` / `gear-drop`
  / `gm-reminder` / `reveal-checkpoint` (`ScheduledEvent` / `ScheduledActionType` in `types/index.ts`).
  The CRUD helpers exist in **both** `services/gameService.ts` and `web/src/services/gameService.ts`
  (`addScheduledEvent`/`updateScheduledEvent`/`deleteScheduledEvent`). The **mobile** run-sheet screen
  (`app/(app)/gm/[gameId]/runsheet.tsx`) still authors them; the **web** dashboard has no UI for them
  anymore.
- So this is **almost entirely a web authoring-UI item** — the data model + sweep are done.

**Approach:**
1. **Web "Scheduled announcements" pane** in the Runbook editor (`web/src/screens/RunbookScreen.tsx`)
   — a dedicated section (sibling to the entry list) that lists/creates `scheduledEvents` of type
   `broadcast` (free text), `gear-drop`, `gm-reminder`, and a `broadcast` with `template:'player-count'`
   for the auto count. Each row authors `offsetMinutes` (minutes after Start) + message/template, via
   the existing `addScheduledEvent`/`updateScheduledEvent`/`deleteScheduledEvent` web helpers. Mirror
   the mobile run-sheet's authoring affordances. **Validate `offsetMinutes > 0`** with the shared
   `requirePositiveInt` (`@shared/common/gameConfigValidation`) — reuse #63's groundwork.
2. **Surface it** from `GameScreen.tsx` (e.g. a "Scheduled" button in the Runbook, or a section in the
   Runbook screen) so a GM finds it without the mobile app.
3. No new schema or function needed — `ScheduledEvent` + `runScheduledEvents` already cover all four
   action types. (Optional polish later: a checkpoint-edit warning when a pending scheduled event
   points at a deleted checkpoint — that's #25, out of scope.)

**Surface:** web (deploy via hosting). **Functions/schema:** none (reuse existing). **Effort:** M
(authoring UI). **Risk:** low — the sweep + rules (`scheduledEvents` GM-only) are already live and
field-tested via mobile. **Verify:** author a `+2m` announcement + a `player-count` row on web; with a
started game, both fire to players within ~a minute of their offset (check `runScheduledEvents` logs /
the player feed); a `gm-reminder` reaches only GMs.

---

## Build sequence

1. **#62** — smallest, web-only content; warm-up + an honest `/demo`.
2. **#75** — web-only; builds directly on the existing `NotificationFeed` (#73).
3. **#71** — schema field + rules (deploy now) + the mobile in-list control (APK). Validate the rule
   with the Firebase MCP.
4. **#11** — functions + latch + cleanup (mirror `rationPings.ts`) + the opt-in config toggle. Test on
   the **emulator** (destructive).
5. **#61** — web Runbook authoring pane over the existing `scheduledEvents` sweep.
6. After each item: web `npm run build` + functions `npm run build` + root `tsc --noEmit` + lint (web
   from inside `web/`) + (for rules changes) `firebase_validate_security_rules`.

## Deploy & APK rollout

- **Phase 1 — deploy now (no APK):** `firebase deploy --only functions,firestore:rules,hosting`
  carrying: #62 web mocks, #75 web feed page, the #71 `dismissedBy` rule, the #11 `starvation` function
  + `starvationSweeps` rule + web `starvationMode` toggle, and the #61 web scheduled-announcements pane.
- **Phase 2 — one EAS APK** (only when the user asks): the **#71** in-list dismiss control and the
  **#11** mobile `starvationMode` toggle, **plus the still-unshipped mobile backlog** from prior
  batches (#63/#64/#74 + the #68 callable client/ration-queue change, #66 gating, #70, mobile Clone).
  **When that APK is live, also apply the deferred #68 `rations` create-rule lock** (set `create` to
  `if false` and `firebase deploy --only firestore:rules`).

## Definition of done (per item)
- [ ] Code + builds green (web, functions, RN tsc, lint; rules validated where touched).
- [ ] Roadmap updated: move the item to the **Built & removed** callout in `ROADMAP.md` with a
      one-line summary + deploy/APK status; remove its section from `ROADMAP_DATA_MODEL.md`; delete
      its section here.
- [ ] Committed + pushed to `main` (when the user asks).
- [ ] Deployed (phase 1) and/or queued for the APK (phase 2), per the rollout above.

## After these five
- **#77** (closed-phone pass-through) is the outstanding **P1** but is **held for an on-device
  locked-phone test** rather than blind code changes — background-location cadence/`deferred` tuning,
  possibly a larger `MAX_SEGMENT_METERS`, or a foreground-resume retro-test in
  `functions/src/geofence.ts` (the #49 caveat). Schedule a device test before coding.
- Then the **integrity invariants** (Tier 7, #20–28) land alongside the features they protect —
  notably **#24** (lock interval-defining config once `play` begins; pairs naturally with #63's
  validation work) and **#20** (no mid-game player delete). **#16** (Tier 6) trims the last geofence
  read cost. **#12** (auto per-interval count) becomes trivial once #61 ships the scheduled-announcement
  authoring.
