# Outdoor GM — Enhancement Roadmap

Derived directly from the game ruleset (single-elimination, last-one-alive combat
survival event) and mapped onto the existing architecture (game phases, `GameContext`,
Firestore subcollections, the geofence Cloud Function). Tiers are by criticality:
**P0** items are mechanics the game *cannot run on the app without*; lower tiers are
field robustness and polish.

> See [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for why the prior, generic
> "team-based scavenger" framing was reprioritized for this specific game. Data-model
> detail for each item lives in [ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md).

## Implementation status (this branch)

Landed (compiles; app `tsc` + functions build green):

- **`game.config`** schema + `gameConfig()` resolver and `rationInterval()` math
  (`types/index.ts`, `services/gameService.ts`).
- **Broadcasts** end-to-end: `broadcasts` collection, rules, `GameContext` listener,
  `sendBroadcast()`, a player-facing `BroadcastFeed` component (wired into the player
  screen), and a GM composer modal + quick "living-player count" action.
- **Elimination + winner + SOS** (server-authoritative): `eliminatePlayer()`,
  `raiseSos()`/`clearSos()`, `setDeathLocation()`, and the `onMemberWrite` Cloud Function
  (death broadcast, winner detection → `results`, SOS push to GMs). Player screen now has
  "I've been killed" (honor system) + a safety-alert button.
- **Checkpoint-triggered events**: `Checkpoint.event` schema + the geofence function routes
  `beast-attack`/`gear-drop`/`announcement`/`silent-alert` by audience to broadcasts/pushes.

Also landed (second pass — no new native deps):

- **GM elimination + SOS controls** (`gm/[gameId]/players.tsx`): per-player eliminate
  (skull), live SOS highlight + clear, dead/alive badges, and an "N alive" count.
- **Game clock / countdown** (P1 #6): `useRemaining()` hook; player screen leads with
  "TIME LEFT" + elapsed subline; GM stats bar shows Remaining / Alive / Active / Arrivals.
- **Death-drop gear pin** (P2 #9): player's last position is stamped on death
  (`setDeathLocation`), rendered as skull markers on the GM map (`GameMap` `deathMarkers`).
- **Per-GM config screen** (P3): a "Game settings" modal in setup — duration, auto
  player-count, winner detection, battery saver — persisted to `game.config`.
- **Battery-aware tracking** (P2 #7): `startLocationTracking({ batterySaver })` uses
  balanced accuracy + 15s/30m cadence when enabled; player reads it from `game.config`.

Not yet done (ration mechanic — deferred to last for testing; needs new native deps):

- **Ration photo capture/upload UI** and the **scheduled starvation** function (requires
  `@react-native-firebase/storage` + a camera picker, i.e. a dev-client rebuild). Service
  layer (`submitRation`, `reviewRation`) + rules are already in place; only the photo UI,
  the **GM ration review feed**, and the timed starvation sweep remain. Holding the
  auto-starvation function until the photo path ships avoids wrongly starving everyone.
- **Offline resilience** (P2 #8 — now safety-critical, see the Pingo consequence note),
  **graceful SMS fallback for SOS**, **custom arena map overlay** (P3, needs storage),
  **sponsorship tracking** (P3).
- **Pingo reconciliation**: decided — Outdoor GM replaces it (no code; rewrite Rule 26).

Landed (Pingo-replacement hardening):

- **Stale-fix indicator**: per-player "last fix Xm ago" + color dot in the GM roster
  (`players.tsx`), and a "N players not reporting" warning chip on the GM map screen that
  deep-links to the roster. Backed by `hooks/useNow.ts` + `services/locationStatus.ts`.
  Marker bitmaps stay static (avoids the Android marker-thrash crash).

## Cross-cutting theme: per-GM configurability

Almost every mechanic below needs config knobs on the game doc. Today `game.rules` is
just free text. Add a structured **`game.config`** object so the base rules are
*defaults a GM can override*: ration interval length, game duration, starvation
auto/manual, which checkpoints fire which events, broadcast cadence, etc. The
"base game rules" remain the seed values for a new game.

---

## P0 — Blockers (core loop & win condition)

### 1. Ration-card survival loop — *the heartbeat of the game*
**Rules 6–9.** Every 30-min window each player photographs a numbered ration card and
sends it to the GM, or **dies of starvation**. The app has nothing for this today.

- **Player:** a per-interval "Submit ration" action that captures a timestamped photo and
  uploads it (Firebase Storage) to `games/{id}/rations/{playerId}/{intervalIndex}`.
- **GM:** a verification feed — incoming photos per player per window, mark valid/invalid,
  and a glance view of who hasn't eaten this window.
- **Auto-starvation:** a Cloud Function (scheduled at each interval boundary) marks any
  living player with no valid submission as dead → triggers death broadcast (#2).
- **Config:** interval length (default 30 min), starvation auto vs. GM-confirmed, whether
  ration photos must be unique (Rule 6, "may only be used once").

### 2. Elimination state, death broadcast & winner detection — *the win condition*
**Rules 1, 2, 8, 14, 16, 23, 32.** "Last one alive wins"; deaths are broadcast.

- Reframe the existing **"I'm Out"** (`markPlayerOut`) into an honor-system
  **"I've been killed"** self-report (Rule 16).
- **GM-initiated elimination** for starvation (Rule 8), bad sportsmanship (Rule 14),
  stealing a drop (Rule 32), or player-to-player comms (Rule 23).
- **Death broadcast** to all players: "[X] has fallen — N tributes remain."
- **Winner detection:** when one living player remains, surface a win state → move the
  game to `results`.
- Builds on existing `member.out`/`outAt`; add `cause` and a broadcast write.

### 3. Safety SOS / "I need help" — *non-negotiable*
**Rules 22, 27, 28.** Players must be able to reach the GM if unsafe/injured/cold.

- A prominent panic button → high-priority push/SMS to the GM with the player's live
  location.
- A "tap out (cold / safe retreat)" variant distinct from a combat death.
- Low effort, high stakes — a 3.5-hour outdoor combat event can't responsibly run
  without it.

---

## P1 — The defining experience

### 4. GM one-way broadcast + auto player-count updates
**Rules 23, 24, 32.** GM→player is the *only* allowed channel (player↔player is bannable —
do **not** build player chat).

- Broadcast to all (gear-drop locations, announcements) **and targeted-to-one** messages
  (Rule 32: drops marked for a specific person).
- Auto "**N players remaining**" push every interval (Rule 24).
- New `games/{id}/broadcasts` collection; players see a read-only message feed (replaces
  the dead "waiting" screen).

### 5. Checkpoint-triggered events
The geofence Cloud Function already fires on checkpoint entry. Extend an arrival to fire a
**GM-authored event** instead of just an alert.

- Per-checkpoint config: event type (`beast-attack`, `gear-drop`, `announcement`,
  `silent-alert`), payload text, and audience (the crossing player, all players, GM-only).
- Checkpoints here are often **hazards**, not objectives — a crossing may push
  "A beast attacks! Defend or flee" to that player and notify the GM.

### 6. Game clock & ration-window countdown
**Rules 5–7.** Replace the count-up elapsed timer with a **3.5-hour countdown** plus a
**rolling 30-min ration-window indicator** ("eat within 7:42"). GM gets the same clock
plus per-player window status. Configurable duration/interval.

---

## P2 — Field robustness

### 7. Battery-aware tracking
**Rule 21** (charge phones, bring batteries). 3.5 hrs of 10s/20m GPS uploads is brutal.
Add coarser cadence when stationary and a low-power mode; show a battery note.

### 8. Offline / poor-signal resilience
Outdoor venues drop signal. Queue location/ration writes and flush on reconnect so a dead
zone doesn't equal a missed ration (= wrongful starvation death).

### 9. Death-drop gear pin
**Rules 19, 20.** On death, prompt the player to drop a pin where they left their
pack/weapons so the GM can recover it; show these pins on the GM map. Cheap given the
location infrastructure already exists.

---

## P3 — Polish & admin

- **Per-GM config screen** — surface all the knobs above (the cross-cutting theme made
  concrete).
- **Custom arena map overlay** (Rule 33) — let the GM upload the arena map image as a map
  overlay instead of relying only on generic tiles + a rectangle boundary.
- **Sponsorship / prize-pool tracking** (Rules 3, 30–32) — mostly admin/out-of-app; low
  app priority.
- ~~Reconcile the Pingo redundancy~~ — **DECIDED: Outdoor GM replaces "Find My Kids by
  Pingo".** Only one location app runs. Rule 26 should be rewritten to onboard Outdoor GM
  the night before instead of Pingo. See the consequence note below.

---

## Consequence of replacing Pingo (sole location & safety tool)

Outdoor GM is now the **only** thing tracking players and the only channel to reach the
GM. That promotes two items from "robustness" to **load-bearing / safety-critical**:

- **Location reliability & background tracking** must be rock-solid — a player who
  force-quits, loses permission, or drops signal silently disappears from the only map
  anyone has. Add a GM-visible **"stale fix" indicator** (last-seen age per player) so the
  GM can tell "stopped moving" from "stopped reporting."
- **Offline / poor-signal resilience (P2 #8)** is no longer just about gameplay fairness —
  it's a safety gap. Queue-and-flush location writes, and the **SOS path** should degrade
  gracefully (e.g. fall back to SMS if push/Firestore is unreachable).
- **Onboarding**: since setup moves into Outdoor GM, the night-before flow now means
  installing the app, signing in, granting **"Always" location**, and joining the game
  code — worth a short pre-game checklist screen.

These don't change the P0 ordering, but they raise P2 #8 and the tracking-hardening work
to "must ship before a real game" rather than "nice to have."

---

## Suggested build order

`3` (safety, cheap) → `2` (elimination/broadcast plumbing) → `1` (ration loop, reuses 2's
broadcast) → `4` → `6` → `5` → P2 → P3.

Items **2** and **4** share the broadcast pipeline, so build them adjacently to save work.
