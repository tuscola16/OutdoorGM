# Single-Game Test Checklist (ROADMAP #58)

A **one-sitting** validation pass that exercises the whole feature surface inside **one game**:
every checkpoint visibility + runbook trigger, the timed transitions, the key game settings, and
the ration loop in its **most restrictive (unique-card) mode**. A single game can only run one
ration-card mode at a time, so unique-card is chosen here because it covers the strictest path.

> **Scope.** This is a feature-surface smoke test for a trusted-build shake-out — not a load test
> and not the on-device locked-phone pass-through re-test (that's ROADMAP **#77**, which needs its
> own field run). Run it with **2–3 player accounts** (so arrival ordinals, all-players notifies,
> district pairing, and winner detection are all reachable) plus your GM account.

## How to use

- Tick each box as you confirm it. A box covers *one observable behavior* — push received, marker
  appeared, row fired, state changed.
- The **GM** uses the mobile app or the **web dashboard** (`web/`); the dashboard mirrors the same
  backend, so checkpoint/runbook authoring and the roster checks can be done there.
- Walking the geofence needs real GPS movement (or a simulated route). The strict in-radius
  debounce is `geofenceConfirmFixes` consecutive fixes (default 2), so dwell briefly at each site.
- A faster scaffold for the *basics*: create the game with **"This is a test"** checked — the
  guided **Test Event** auto-configures a short game + one fixed-order checkpoint and walks you
  through the core event kinds. This checklist is the **superset**: it adds every visibility mode,
  the timed/always-on/gm-prompted triggers, and the unique-card ration loop.

---

## 0. Setup — build the test game

- [ ] Create a game (GM). Note the **player code** and **GM code** (`Codes` button / share sheet).
- [ ] Open **Settings** and set:
  - [ ] **Duration** short enough to finish in one sitting (e.g. 20–30 min).
  - [ ] **Ration check ON**, **interval** short (e.g. 3–5 min), **eat-window** shorter than the
        interval (e.g. 2 min), **Unique ration cards ON**, **starvation mode = GM-confirmed**.
  - [ ] **Auto player-count updates ON** (#12 — should auto-schedule "N remain" pushes at Start).
  - [ ] **Declare a winner**: leave on (`one` / auto-end at 1 survivor) for the winner check.
  - [ ] **Battery saver** your choice; geofence knobs at defaults is fine.
- [ ] Set **rules** free-text; confirm it shows in the player tutorial later.
- [ ] Define a **boundary** (web: draw a polygon; mobile: capture the rectangle) sized so you can
      physically step outside it for the boundary-exit test.

## 1. Checkpoints & visibility

Author **one checkpoint per visibility mode** (place them close together for a quick walk):

- [ ] **Hidden** — never shown to players (default).
- [ ] **Shown** — visible to all players from Start.
- [ ] **Shown-on-trigger / reveal = player (triggerer)** — a "trap" that reveals only to the
      player who crosses it.
- [ ] **Shown-on-trigger / reveal = gm** — GM taps **Reveal now** to surface it.
- [ ] **Shown-on-trigger / reveal = timed** — reveals at an offset after Start (set a small offset).
- [ ] (Optional) **Shown-on-trigger / reveal = specific-players** — pick one player as recipient.

## 2. Runbook entries (behavior) — one of each trigger

Attach runbook entries to the checkpoints above (the checkpoint just needs geometry; the runbook
holds the behavior). Cover every **trigger** and every **effect kind**:

- [ ] **fixed-order** with `queueSlots` demonstrating each effect for successive arrivers:
      slot 0 = **hazard**, slot 1 = **boon**, slot 2 = **notify (crossing-player)**,
      slot 3 = **notify (all-players)**, default/extra = **gm-notify**.
- [ ] **always-on** — fires for every arriver each time it's eligible.
- [ ] **timed** — window `[game-start + X, game-end]` (or an explicit minute window); confirm it
      does **not** fire before the window and **does** fire once the window opens, even for a
      player who lingers in-radius (the `tripIntervalMinutes` re-evaluation).
- [ ] **gm-prompted** — never fires on a crossing; the GM fires it on demand to chosen targets.
- [ ] **Priority/tie** — two eligible entries on one checkpoint: confirm the **highest priority**
      fires first and the rest dole out on the re-evaluation cadence (one per `tripIntervalMinutes`).

## 3. Lobby → players join

- [ ] GM: **Open to Players** (phase → lobby).
- [ ] Each player joins with the **player code**, names themselves, sees the **tutorial** (with the
      GM's rules), then waits on the "waiting for the GM" screen. **No tracking yet** in lobby.
- [ ] (Optional) A second GM joins with the **GM code** and sees the full roster/map.
- [ ] GM assigns **districts** (#10): pair two players in the same district (for §6 trap suppression).

## 4. Start → play

- [ ] GM: **Start Game** (phase → play; `startedAt` stamped). Players' location tracking starts.
- [ ] **Shown** checkpoints appear on player maps; hidden ones don't.
- [ ] **Timed reveal** checkpoint appears at its offset; GM gets the "marker revealed" push.
- [ ] Player live **timer** runs; GM sees the live map + elapsed timer.
- [ ] **#12 auto player-count**: at the first ration interval, all players receive a
      "N tributes remain" push **without** the GM adding a run-sheet row.

## 5. Geofence crossings (the core loop)

- [ ] Walk a player into the **shown** checkpoint → GM gets an **arrival** ping.
- [ ] **fixed-order**: first arriver gets **hazard**, second gets **boon**, etc.; verify the
      **all-players notify** slot reaches *every* living player, not just the crosser.
- [ ] **trap (reveal = player)**: the crossing player sees its marker appear; others don't.
- [ ] **always-on**: fires on each crossing.
- [ ] **gm-notify**: only the GM is notified; the player sees nothing.
- [ ] **Bare arrival is silent (#83)**: cross a checkpoint with **no** eligible runbook entry —
      no GM push and no SMS, but the arrival **is** recorded: it shows under "See all" →
      **Arrivals** on web (and is absent from the compact sidebar feed).
- [ ] **Debounce (#50)**: a single jumpy fix near a radius does **not** create an arrival.

## 6. Safety, boundary, district, battery

- [ ] **Boundary exit (#7)**: a player steps outside the boundary → GM gets **one** "left the area"
      alert; stepping back in → **one** "re-entered" alert (latched, no spam).
- [ ] **Same-district trap suppression (#5)**: both district partners arrive at a trap within the
      co-arrival window → the trap is **withheld** and the GM sees the "trap withheld" note.
- [ ] **SOS (#5/#22)**: a player raises SOS → GM gets push **+ SMS** (if Twilio configured); GM
      **Acknowledge** stops the escalation, **Clear** stands it down. End Game is blocked while an
      SOS is open + unacked.
- [ ] **Low-battery beacon (#35)**: a player on a low battery (≤ 20%) shows the 🪫 flag on the GM
      **roster** and a "🪫 N%" note on their **map marker** / player-detail screen.
- [ ] **Stale fix indicator**: stop a player's app; within ~2 min the roster shows their fix going
      aging → stale.

## 7. Ration loop (unique-card mode)

- [ ] Before the eat-window opens, the player's ration panel shows a muted **"opens in …"**
      countdown (capture gated to the window, #21).
- [ ] When the window opens, the player gets the **scheduled local notification** (fires even
      backgrounded/locked).
- [ ] The player captures a ration photo with the **live camera only** (no library pick), enters a
      **card number**, and submits. Photo lands in Storage; the submission shows as **pending**.
- [ ] GM **review feed** (mobile `rations` screen / web RationsModal): thumbnail + lightbox;
      **Valid** / **Reject**; the "who hasn't eaten this window" glance is accurate.
- [ ] **Unique-card flag (#6)**: submit the **same card number** from a second player → the GM feed
      flags the reuse so the GM can reject it (enforcement is manual).
- [ ] A player who misses the window is **not** auto-eliminated (GM-confirmed mode) — the GM
      eliminates by hand from the Players list.

## 8. Run-sheet / scheduled announcements (#11/#61)

- [ ] Author a **timed broadcast** and a **gm-reminder**; confirm each fires at its offset (player
      broadcast pushed to all; GM reminder GM-only).
- [ ] Author a **gear-drop** announcement; confirm the "🎁 Gear drop" push.
- [ ] Confirm the **auto player-count** rows (#12) appear in the run-sheet and fire each interval.

## 9. Eliminations, winner, end

- [ ] GM **eliminates** a player (or a player marks **I'm Out**): a "has fallen — N remain"
      death toll posts **once** (no double-toll on retry).
- [ ] **Revive (#21)**: GM revives a player; if a death had ended the game, it **reopens**.
- [ ] **Winner detection**: eliminate down to one survivor → the survivor is crowned and the game
      auto-ends (phase → results, `status: ended`).
- [ ] **Results**: players see how long they played (start → their `outAt` / game `endedAt`);
      GM sees per-player times.
- [ ] **Cleanup**: on end, ration photos are purged (Storage), and location/arrival data is cleaned
      per the end-of-game triggers.

## 10. Account / lifecycle edge cases

- [ ] **Late-join lock (#27)**: a brand-new player can't join once the game left the lobby; an
      existing member reconnecting still can; a co-GM (GM code) can join any phase.
- [ ] **Archive**: a member archives the finished game from their own "My Games" (doesn't affect
      others).
- [ ] **Sole-GM account deletion (#29)**: with the GM as the only GM of an active game, delete the
      GM account → the longest-tenured active player is **promoted to GM** (or, if no active players
      remain, the game is **ended server-side**) — the game is never left orphaned.

---

### Quick reference — what each box maps to

| Area | Items |
| --- | --- |
| Checkpoint visibility / reveals | #48/#60 |
| Runbook triggers + effects | #60/#67 |
| Geofence debounce / pass-through / re-notify | #49/#50/#55 |
| Boundary exit · district suppression · SOS | #7 · #5/#10 · #5/#22 |
| Low-battery beacon | #35 |
| Ration loop (unique-card) | Rules 6–9 / #21/#68/#72 |
| Auto player-count | #12 |
| Run-sheet / scheduled announcements | #11/#61 |
| Winner / revive / cleanup | #1/#21/#30 |
| Late-join lock · sole-GM delete | #27 · #29 |
