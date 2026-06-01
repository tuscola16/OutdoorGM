# Outdoor GM — Competitive Analysis

## What Outdoor GM actually is

A **facilitator-run, real-time GPS field game**. A Game Master defines a play-area
boundary + checkpoints + rules, players join by code, and during play the GM watches
everyone live on a map and gets push/SMS alerts the instant a player crosses a checkpoint
geofence. The defining design choice is **asymmetric visibility**: the GM sees all
positions; each player sees only themselves. That makes it a "Hunger Games / manhunt /
hide-and-seek" engine, not a navigation toy.

## Market landscape

| Category | Examples | How they overlap | Where Outdoor GM wins / loses |
|---|---|---|---|
| **Organized scavenger hunts** | GooseChase, Scavify, Actionbound | Facilitator dashboard, join-by-code, group play | They win on **content** (photo/video/trivia/GPS task missions, scoring, leaderboards, branding). Outdoor GM wins on **live real-time positions + instant geofence alerts**, which they largely don't do. |
| **Location-based games** | Pokémon GO, Ingress, Turf | GPS + geofences + outdoor movement | They're persistent global games with huge content/AR. Outdoor GM is **ad-hoc, private, GM-authored** — a different use case (your event, your map). |
| **Live location sharing** | Life360, Find My, Glympse | Real-time map of people | They're utility/safety, not gamified, and symmetric. Outdoor GM adds **game structure + one-way visibility + checkpoints**. |
| **Geocaching** | Geocaching®, Cachly | Coordinates/checkpoints outdoors | They're a global cache database with offline maps. Outdoor GM is **transient and social**, no shared cache catalog. |
| **DIY "manhunt/assassin" apps** | various small apps | Pursuit games | Mostly unmaintained/clunky. This is Outdoor GM's **closest direct niche and a real gap to own.** |

## Differentiators (the moat)

- **Live GPS map of every player for the GM** + **server-authoritative geofence alerts**
  (push + optional SMS). This combination is rare; scavenger apps are task-submission
  based, not live-tracking based.
- **Asymmetric privacy model** ("players see only themselves") — purpose-built for
  pursuit/hide games. Genuinely differentiated.
- **Zero-friction, ephemeral games**: 6-char codes, phases (setup → lobby → play →
  results), no account/event setup overhead.
- **Background tracking done properly** (foreground service notification, "Always"
  permission, balanced accuracy).

## Gaps vs. the field (what reviewers/competitors will hit on)

1. **No content layer** — no photo/trivia/task missions, no scoring beyond elapsed time,
   no leaderboard. GooseChase/Scavify own this; Outdoor GM currently can't run a
   points-based hunt.
2. **No teams** — only `player`/`gm`. Most field games are team-vs-team. This is the
   highest-leverage feature gap.
3. **No in-app comms** — no chat, no GM broadcast/announcement, no "you've been
   caught/eliminated" mechanic. Players sit on a "waiting" screen.
4. **No offline / downloadable maps** — outdoor venues have poor signal; competitors
   (Geocaching, Avenza) lean on offline. Outdoor GM depends on map tiles + constant
   Firestore writes.
5. **No GM web dashboard** — GMs running an event want a laptop/big screen; the app is
   phone-only. (Note: a `web/` desktop GM dashboard exists in the repo and partially
   addresses this.)
6. **Battery & data cost** — continuous 10s/20m GPS uploads. No adaptive cadence, no
   "low-power" mode. This is the #1 complaint for field-game users.
7. **Player engagement during play is thin** — they see only their own dot + a timer. No
   sense of progress, proximity hints, or objectives feedback.
8. **Discovery/monetization undefined** — no template games, no per-event pricing or org
   tier (the model GooseChase/Scavify monetize on).

## Recommended near-term roadmap (highest ROI first)

1. **Teams** (player → team assignment, team colors on GM map, per-team results) —
   unlocks most real use cases.
2. **Checkpoint scoring + leaderboard** — turns "arrival alerts" into an actual game
   outcome.
3. **GM broadcast / elimination state** — a one-way message + a "caught/out" action the
   GM can trigger, which the player sees.
4. **Battery-aware tracking** (coarser cadence when stationary; user-visible battery note).
5. **GM web dashboard** (read the same Firestore live map in a browser) — cheap given the
   existing data model, big perceived value.
