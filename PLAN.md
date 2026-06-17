# Implementation Plan — "Harden for the first real event" (next batch)

**Status:** not started. **Created:** 2026-06-17. **Owner:** (pick up in a fresh session.)

> **✓ RESOLVED — 2026-06-17 APK crash-loop.** The new preview APK crash-looped (~5 s) because it
> was installed **over** the prior build and inherited **stale `expo-updates` cache/state**: every
> preview build shared runtimeVersion `1.0.0` (static `version` + `appVersion` policy), so the new
> native runtime tried to load the old cached JS → `globalThis.expo` never installed →
> `expo-modules-core` threw `Cannot read property 'NativeModule' of undefined` → `"main" not
> registered` → expo-updates error-recovery reload loop. **Fix applied:** `adb shell pm clear
> com.bagelrun.outdoorgm` (loads the good embedded bundle). **Prevention:** `preview` now uses
> `autoIncrement: "version"` in `eas.json`, so each APK gets a unique runtimeVersion and can't load
> another build's cached payload; also **clean-install** (uninstall first) when distributing.

This batch is the **Tiers 4/6/8/13 "harden for the first real event"** cluster — correctness, cost,
robustness, safety, and the tooling to verify it. It deliberately skips Tier 11 polish (#41–45, #57)
and the deferred public-launch gating (#46/#47), matching the trusted-APK milestone. Items carry the
**stable roadmap numbers**; see [ROADMAP.md](ROADMAP.md) + [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md)
under the same numbers. Mark each built per the roadmap convention when it lands.

---

## Orientation (read first)

Same monorepo + deploy story as the Tier 7 cycle:

| Surface | Path | Reaches the field via |
| --- | --- | --- |
| **Mobile app** | `app/`, `components/`, `services/`, `context/` | **EAS APK** (can't hot-deploy) |
| **Web GM dashboard** | `web/` (Vite + Firebase JS SDK; `@shared` → repo root) | `firebase deploy --only hosting` |
| **Cloud Functions** | `functions/src/` (admin SDK, 1st-gen) | `firebase deploy --only functions` |
| **Rules** | `firestore.rules`, `storage.rules` | `firebase deploy --only firestore:rules` |

Shared TS types in repo-root `types/index.ts` (`@shared/types` web · `@/types` mobile); pure
cross-client helpers in repo-root `common/` (`@shared/common/<x>` web · `@/common/<x>` mobile).
Functions mirror types inline (can't import app types).

**Build / verify:**
```bash
cd web && npm run build && cd ..            # tsc --noEmit && vite build
cd functions && npm run build && cd ..      # tsc
npx tsc --noEmit -p tsconfig.json           # mobile (2 known expo-router Href errors — ignore)
# Rules: validate with firebase_validate_security_rules (Firebase MCP) before deploying.
```

**Conventions:** commits end `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; work on `main`;
push/deploy only when asked. EAS builds are rate-limited — **never kick a build without an explicit ask.**

---

## 1. #16 — Cache phase/role in `onLocationUpdate` *(Tier 6 · server-only · deploy now, no APK)*

**Goal:** cut the per-location-write reads. The lobby short-circuit, zero-checkpoint skip, and the
checkpoint cache shipped, but the trigger still reads the **game doc** and **member doc** on every
location write — and #20/#24's rules now add a game-doc `get()` on some writes, so this matters more.

**Approach:** add a short-TTL in-memory cache (mirror `CP_CACHE_TTL_MS` in `functions/src/geofence.ts`)
keyed by `gameId` for the game phase, and by `gameId+uid` for member role, so a burst of fixes from one
player reuses one read. Invalidate on TTL only (phase/role rarely change mid-write-burst). Model cost at
expected player counts. **Surface:** functions. **Deploy now.**

## 2. #29 — Sole-GM `deleteAccount` *(Tier 8 · functions + client)*

**Goal:** deleting the **only GM** of a game orphans it (players remain, no GM). Close the gap left by
#20's `deleteAccount` carve-out (which now scrub-and-eliminates a live game's member but doesn't handle
the sole-GM case).

**Approach:** a small server-side callable (e.g. `transferGmOrEndGame`) invoked from `deleteAccount`:
for each game where the leaver is the sole GM, either promote the longest-tenured active player to GM,
or — if no players remain — server-side end the game. GM role changes must stay server-authoritative
(never client-self-assigned). **Surface:** functions + client wiring. **Schema:** none.

## 3. #35 — Low-battery beacon *(Tier 8 · client + schema)*

**Goal:** the GM roster flags a player about to go dark (Rule 21) before they vanish.

**Approach:** player writes `PlayerLocation.battery` (0–1) with each fix (allowed by the existing
self-write rule — add the field in `locationTask.ts`'s `updatePlayerLocation` payload via
`expo-battery` or RN `DeviceInfo`); the GM players list + map flag anyone below a threshold. **Surface:**
mobile (report) + web/mobile GM roster. **Schema:** `PlayerLocation.battery?` (optional — see
ROADMAP_DATA_MODEL §35). Pairs with the stale-fix indicator already on the roster.

## 4. #12 — Auto per-interval "N remaining" broadcast *(Tier 4 · small)*

**Goal:** stop the GM hand-adding a player-count row each interval. Trivial now that #61 shipped the
"Scheduled announcements" authoring over `scheduledEvents` + the `runScheduledEvents` sweep.

**Approach:** when the `playerCountBroadcast` config toggle is on, auto-seed a repeating
`template:'player-count'` scheduled-announcement row per ration interval at Start (or have the sweep
self-reschedule). Today the toggle is stored but does nothing automatic. **Surface:** functions (seed)
+ a small client note. **Schema:** none (reuses `ScheduledEvent`).

## 5. #58 — Single-game test checklist (+ optional `seedTestGame`) *(Tier 13 · tooling)*

**Goal:** validate the whole feature surface in one sitting — directly useful for shaking out this
APK and everything after.

**Approach:** a documented checklist (every checkpoint visibility/runbook trigger + timed transition,
the key game settings, the ration loop in unique-card mode — a game runs one ration mode at a time).
Optionally back it with a one-tap `seedTestGame` helper that scaffolds a fully-configured game.
**Surface:** doc + optional callable. **Schema:** none.

---

## Build sequence

1. **#16** — server-only cost cut; deploys now without an APK. Warm-up.
2. **#29** — sole-GM callable (follows #20's deleteAccount path we just touched).
3. **#35** — battery beacon (schema + report + roster flag).
4. **#12** — auto per-interval count (small).
5. **#58** — test checklist + optional `seedTestGame`.
6. After each: web `npm run build` + functions `npm run build` + mobile `tsc --noEmit` + lint +
   (rules changes) `firebase_validate_security_rules`.

**Trim options:** drop **#12** and/or **#58** for a focused 4 (#16/#29/#35).

## Deploy & APK split
- **Deploy now (no APK):** #16 (functions), the server side of #29 + #12, once built.
- **Next APK (only when asked):** the #35 battery report, the #29 client wiring, the #12 toggle note
  — plus the still-unshipped Tier 7 / batch mobile halves already queued. The `preview` profile now
  `autoIncrement`s the version, so each APK gets a unique runtimeVersion (see the resolved note up top).

## Definition of done (per item)
- [ ] Code + builds green (web, functions, RN tsc, lint; rules validated where touched).
- [ ] Roadmap updated: move to the **Built & removed** callout in `ROADMAP.md`; prune the
      `ROADMAP_DATA_MODEL.md` entry; delete the section here.
- [ ] Committed to `main` (when asked); deployed / queued per the split above.
