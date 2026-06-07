# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are stable from here and
not reused once an item lands; the list was **renumbered 2026-06-06** (a one-time reset after a
large batch shipped — earlier `#`/`§` numbers are retired and don't map forward).

---

## Tier 1 — Functional-APK blockers (break deploy or fail at runtime)

**1. Migrate Twilio off `functions.config()`.** `functions/src/sms.ts` reads creds via
`functions.config()`, removed in the current `firebase-functions` generation — a fresh deploy
returns `undefined` and silently kills SMS, the only non-push SOS channel (item 3). Move to
`defineSecret`/params (`TWILIO_SID`/`TWILIO_TOKEN`/`TWILIO_FROM`).

> **Built** (commit `0219d78`): `sms.ts` reads `process.env.TWILIO_*` and exports
> `TWILIO_SECRETS`; `onLocationUpdate` (`geofence.ts`) and `onMemberWrite` (`members.ts`) bind them
> via `.runWith({ secrets: TWILIO_SECRETS })`. A real SID must start with `AC`, so unset/placeholder
> secrets no-op cleanly. No `functions.config()` reads remain.

**2. Add the run-sheet collection-group index.** `functions/src/runsheet.ts` runs
`collectionGroup('scheduledEvents').where('firedAt','==',null)` with no `COLLECTION_GROUP` index,
so the per-minute sweep throws `FAILED_PRECONDITION` and **every scheduled action silently never
fires**. Add the field override in `firestore.indexes.json` (mirrors `members.userId`) and redeploy.

> **Built** (commit `7a03cf4`): the `scheduledEvents` / `firedAt` `COLLECTION_GROUP` field override
> is present in `firestore.indexes.json`.

---

## Tier 2 — Safety-critical (must ship before a real game)

Outdoor GM replaced Pingo as the *only* location/safety tool, so these are load-bearing, not polish.

**3. SOS → SMS fallback.** The SOS button + GM push are built; if push/Firestore is unreachable
the SOS must degrade to SMS (Twilio) so an injured player can always reach the GM. Depends on item 1.

> **Built:** `handleSos` (`functions/src/members.ts`) already fires GM push **and** Twilio SMS in
> parallel (`Promise.allSettled`) on every raised SOS — a muted/asleep phone can't swallow a safety
> alert. SMS can only originate server-side (the device can't hold Twilio creds), so it rides the
> `onMemberWrite` trigger; the one remaining link — guaranteeing the SOS *write* lands when the
> device is briefly offline so the trigger fires — is covered by the offline write queue (item 4).

**4. Offline / poor-signal resilience.** Queue location/ration writes and flush on reconnect, so a
dead zone doesn't mean a missed ration (= wrongful starvation) or a silently dropped SOS.

> **Built** (SDK + thin retry): Firestore offline persistence is made explicit in
> `services/firebase.ts` (`persistence: true`) — location, ration-doc, and SOS writes are cached
> on-device and flushed on reconnect by the SDK, so none are silently dropped. The one write the SDK
> can't queue is the ration **photo** upload (Firebase Storage); `services/rationQueue.ts` is a
> durable AsyncStorage-backed retry for it — a failed submit persists the capture and `RationPanel`
> flushes it on mount + app-foreground, showing a "saved offline" state until it lands (idempotent
> via the deterministic submission id). The player SOS button now confirms optimistically (the write
> is durably queued), so it feels instant in a dead zone and still reaches the GM on reconnect.

**5. SOS persists and must be acknowledged.** A raised SOS escalates and stays open until a GM
explicitly acks it (`sosAckAt`) — nothing auto-clears it.

> **Built:** `sosAckAt` added to `GameMember`. `ackSos()` (mobile + web `gameService`) stamps it;
> `raiseSos()` resets it to null so a fresh SOS is live again; `clearSos()` stands the SOS down
> (`sos:false` + `sosAckAt:null`). `firestore.rules` makes `sosAckAt` GM-write-only (a player
> self-update may leave it unchanged or null it, never set a timestamp). The live, escalating state
> is `sos === true && sosAckAt == null`; the GM roster + per-player screen + web dashboard show a
> two-step **Acknowledge → Clear** with a distinct acknowledged (amber) state. Consumed by item 6.

**6. Block End Game while a player is unaccounted-for.** Refuse End Game (hard override only) when
a player has an open unacked SOS or hasn't reported a fix in N minutes.

> **Built:** `unaccountedPlayers()` (`services/locationStatus.ts`, mirrored in `web/`) returns the
> living players with an open unacked SOS (`sos && !sosAckAt`, #5) or no fix fresher than `STALE_MS`
> (2 min). The GM End-Game handler (mobile `gm/[gameId]/index.tsx` + web `GameScreen` `onEnd`)
> lists them and requires a hard "End anyway" override; with none, the normal confirm shows. Trusted
> GMs, so this is a client guard (no server lock).

**7. Player-left-the-boundary alert.** When a tracked player exits `game.boundary`, alert the GM
(distinct from a checkpoint crossing). A per-member `outOfBounds` latch fires it once on exit.

> **Built:** `onLocationUpdate` (`geofence.ts`) runs a boundary test before the checkpoint work
> (so it fires even with zero checkpoints). A per-member `outOfBounds` latch flips on the
> boundary transition: on exit it pushes + SMSes the GMs ("X left the play area") once; on re-entry
> it clears and sends a quiet "back in the area" GM push. The test is point-in-polygon (ray-cast)
> when `boundary.polygon` is set, else the min/max bbox — this is the geofence half of #39. The GM
> roster (`gm/[gameId]/players.tsx`) shows a "🚧 Outside the play area" flag.

---

## Tier 3 — Correctness bugs (fix before a real game)

**8. Winner detection must exclude GMs.** A 1-player/1-GM game crowned the GM when the player
tapped out. `functions/src/members.ts` should treat "sole remaining member is a GM" as the
zero-survivor path, never a winner. Investigate whether the GM doc carries `role:'player'` or a
stale transaction snapshot; add a regression guard.

> **Built:** every roster pass in `members.ts` (`handleDeath`'s immediate count, and the
> winner-detection transaction) filters `m.role !== 'gm'`, and the death trigger itself is gated on
> `after.role !== 'gm'`. A sole-GM survivor therefore yields `living.length === 0` → the explicit
> "no winner" broadcast, never a winner. The GM is excluded at the role layer, so a stale snapshot
> can't crown them.

**9. Don't double-push the crossing player on a shared device.** In `dispatchCheckpointEvent`
(`functions/src/geofence.ts`), filter the crossing player's token out of `gmTokens` (and
`allPlayerTokens`) so a device signed into both accounts doesn't get both the player and GM pushes
(which also leaks GM-internal text).

> **Built:** `onLocationUpdate` drops the crossing player's `fcmToken` from `gmTokens` when building
> the GM recipient list, so the shared-device GM alert (and the GM-only arrival ping) never lands on
> the crosser. `allPlayerTokens` is intentionally **left** containing the crosser — they're a valid
> recipient of an all-players event, which has no separate direct push, so filtering `gmTokens`
> alone yields exactly one push to the device with no GM-text leak.

**10. Make single-event arrival dedup transactional.** The `eventQueue` path guards double-fire
with a transaction; the single-`event` path relies on a non-transactional read, so concurrent
writes can create duplicate arrivals/notifications. Reuse the transactional check for both.

> **Built** (commit `0219d78`): the single-`event` path in `geofence.ts` now records the arrival
> inside `db.runTransaction` — reading existing arrivals for the checkpoint and writing only if this
> player isn't already among them — mirroring the `eventQueue` path. Concurrent location writes for
> the same player can no longer both pass dedup.

---

## Tier 4 — Core ration loop

**11. Auto-starvation sweep.** Scheduled function: at each interval boundary, mark any living
player with no valid submission for the prior window as dead (death broadcast already built).
Gated by `starvationMode`; default stays `gm-confirmed` (GM flips to `auto`) until the photo path
is field-proven. Tester-confirmed wanted.

**12. Auto per-interval "N remaining" broadcast.** A config toggle that seeds repeating
player-count entries each ration interval, so the GM needn't add each run-sheet row by hand.
Low priority — the run-sheet covers it manually today.

---

## Tier 5 — Ration review / submission UX

All in the built Rules 6–9 path (`components/RationPanel.tsx`, `gm/[gameId]/rations.tsx`, web `RationsModal`).

**13. Terminal GM review action.** Once a card is `valid`/`rejected`, replace the Approve/Reject
pair with a resolved chip ("✓ Approved" / "✕ Rejected") — no ever-present opposite button. Any
flip is a deliberate "change decision" control.

**14. Viewport-fit, scrollable photo review.** The review image must fit the viewport
(`resizeMode:'contain'`, aspect preserved) inside a scrollable surface, so a tall portrait card
isn't clipped — mobile lightbox and web modal alike.

**15. One submission per window, state-driven panel.** Drive `RationPanel` off the current
interval's doc: `pending` → "approval pending" (capture hidden); `valid` → "approved" + countdown
to next window; `rejected` (open) → re-enable capture; closed → missed state. No multiple submits.

---

## Tier 6 — Cost, privacy & performance (before a real event)

**16. Reduce geofence read cost.** `onLocationUpdate` does ~4 reads on every location write,
including no-op lobby writes. Short-circuit lobby writes, skip when the game has zero checkpoints,
and/or cache game-phase/member-role. Model cost at expected player counts before launch.

**17. Purge locations & arrivals on game end.** Only ration *photos* are cleaned today; player
`locations/*` and `arrivals/*` persist forever (privacy + unbounded growth). Extend
`cleanupRationPhotosOnGameEnd` to delete them on `play → ended`; reflect in the privacy policy.

**18. Parallelize `getMyGames`.** `services/gameService.ts` awaits a per-game read in a `for` loop
on every Games-screen focus. Wrap in `Promise.all` (consider caching).

**19. Consolidate duplicate broadcast listeners.** `AlertOverlay` + `BroadcastFeed` each open two
listeners; a player holds 4–6 on the same collection. Lift into one shared subscription and feed
both components.

---

## Tier 7 — Integrity invariants (land alongside the features they protect)

Backend guards so a running game can't be corrupted.

**20. No mid-game player removal.** In `play`, member docs are delete-locked; the only way out is
an elimination (`out`/`cause`), preserving timing/death-location/ration history. Hard deletes only
in `setup`/`lobby`. (`removePlayer` has no phase lock today — the gap.)

**21. Reversible elimination.** `revivePlayer()` clears `out`/`outAt`/`cause` and posts a
correcting broadcast; if an accidental kill had ended the game, return `results → play`.

**22. Guarded, monotonic phases.** Phase only advances; the lone backward move is `reopenSetup`
(warns it resets `startedAt`/timers). Confirm remaining gaps are closed.

**23. Full Start-Game preflight.** Refuse/hard-warn to start with no boundary, zero checkpoints,
zero joined players, or no GM holding a valid FCM token (the partial fix-warning exists).

**24. Lock interval-defining config during play.** Freeze `rationIntervalMinutes`,
`durationMinutes`, `startedAt` once `play` begins — changing them rescrambles ration intervals and
could retroactively starve everyone. Editable only in setup, shown disabled with a reason.

**25. Preserve history on checkpoint edits.** Deleting/moving a checkpoint mid-game keeps its
`arrivals`; warn if pending run-sheet events still point at it. Never orphan arrival/scheduled records.

**26. Idempotent destructive server actions.** Winner detection, the starvation sweep (item 11),
and the run-sheet dedupe must be safe under retry/double-trigger (deterministic ids / `firedAt`),
tested as an explicit invariant.

**27. Late-join lock.** Joining closes once the game reaches `play` (no exceptions for MVP), so an
eliminated player can't rejoin under a fresh name. (GM opt-in for stragglers is post-MVP.)

**28. Confirm fleet-wide destructive broadcasts.** "Void all vouchers / ration cards" and End Game
take a two-step confirm and are logged.

---

## Tier 8 — Robustness & polish

**29. Harden `deleteAccount`.** Chunk membership deletes into ≤500-write batches (a 250+-game user
throws today) and handle deleting the sole GM of a game (transfer GM, or server-side end the game).

**30. Stabilize the player tracking effect.** Drive tracking from one controller keyed on a stable
`shouldTrack` boolean so `displayName` arriving (`'' → name`) doesn't stop/restart the background
service, and the AppState effect can't start it concurrently.

**31. Range-validate coordinates in the location rule.** `firestore.rules` checks `is number` but
not ±90 / ±180; add the two range checks so a member can't write nonsense coordinates.

**32. Rebrand the SMS prefix.** `functions/src/sms.ts` prefixes bodies with `[HungerGamesLocator]`
— rebrand to Outdoor GM. (Internal `hgl-*` identifiers are harmless.)

**33. Reset login button loading on stuck nav.** `app/(auth)/login.tsx` only clears `loading` on
error; add `finally { setLoading(false) }` so the button can't spin forever if nav stalls.

**34. Remove the unused `arrivals` composite index.** `firestore.indexes.json` defines an
`arrivals (playerId, timestamp)` index no query uses — drop it (or add the query that needs it).

**35. Low-battery beacon.** Players report battery level with each fix; the GM roster flags a
player about to go dark (Rule 21) so they can be checked on before they vanish.

---

## Tier 9 — UX quick wins

**36. Sort My Games newest-first + optional `gameDate`.** Sort `app/(app)/games.tsx` by
`gameDate ?? createdAt` descending; add an optional GM-set `gameDate` (event date, distinct from
`createdAt`) editable at create/setup.

**37. Pre-populate join display name from profile.** `app/(app)/join.tsx` seeds from
`profile?.displayName` but should handle a late-arriving profile and show a "from your profile"
hint so the player knows it's an overridable default.

**38. Navigate to the game after joining.** `joinGameByCode` returns `{ gameId, role }` — navigate
straight into the game screen instead of back to My Games. "Enter code → you're in the game."

---

## Tier 10 — Feature follow-ons

**39. Polygon boundary authoring (web) + point-in-polygon.** The `polygon` schema and viewing
shipped; remaining is the **web-only** draw/edit UI (e.g. `@mapbox/mapbox-gl-draw` in
`web/src/components/GameMap.tsx` + `GameScreen.tsx`) and the ray-cast point-in-polygon test in the
geofence (only needed once the boundary-exit alert, item 7, lands). Low priority — the rectangle
works.

**40. GM per-player follow-ons.** On the built per-player screen: author **per-player checkpoints**
(the GM side of the built reveal model's per-player case — `reveal.audience: specific-players`) and
**GM↔GM messaging** (new — broadcasts are GM→player only today).

---

## Tier 11 — P3 polish

**41. End-game phase.** Add an `endgame` phase between `play` and `results` (e.g. a final
convergence / sudden-death window) the GM triggers, so the app models the schedule's end-game block.

**42. Custom arena map overlay.** Let the GM upload the arena map image as a map overlay instead of
relying only on generic tiles + the boundary (Rule 33).

**43. Night-before practice game.** A disposable, badged, re-runnable on-site dress-rehearsal game
(`game.practice`) with a one-tap "drop test checkpoint here", relaxed safety guards, and a GM
readiness view — exercises joins/tracking/events/pushes end-to-end. *Deprioritized:* slot in just
ahead of the first real rehearsal, not ahead of everyday APK work.

**44. Voucher-site run-sheet preset.** Vouchers are paper/in-person, so the app mints nothing — a
voucher site is just a time-windowed checkpoint with announcing run-sheet rows. A one-tap "voucher
site" preset that scaffolds the open/close/announce rows is the only (optional) work.

**45. Post-game media.** After `results`, let a GM attach a YouTube recap + Google Photos album on
the game doc (`media` object); a Cloud Function pushes "recap is up" to everyone but the setter;
results screens show outbound Watch/View links. *Lowest priority* — stitching footage happens well
after the event.

---

## Deferred — public launch / app-store gating

Only matter when going **wide** (public store listing / large distribution); they do **not** block
the functional APK.

**46. App Check enforcement + callable rate-limiting.** `functions/src/games.ts` has
`ENFORCE_APP_CHECK = false` and no callable throttle. Before a public launch: register App Check on
both platforms, verify real builds get tokens, flip the flag, and add a per-UID throttle on
`joinGameByCode`. *(Pull the rate-limit forward independently if abuse shows up in the trusted group.)*

**47. Restrict the Google Maps API keys.** `app.json` ships Maps keys in the binary — lock each to
its bundle ID / SHA-1 and the Maps SDK in Cloud Console before wide release. Console/ops task, no code.

---

## Suggested order

1. **Tier 1** (1–2) clears the deploy/runtime blockers for any working build.
2. **Tiers 2–3** (3–10) — safety-critical hardening + correctness bugs — ship before a real game.
3. **Tier 4** (11–12) completes the ration loop; **Tier 5** (13–15) cleans up its UX.
4. **Tiers 6–7** (16–28) — cost/privacy + integrity invariants — before a real event; invariants
   land alongside the features they protect.
5. **Tiers 8–9** (29–38) trail as robustness/polish and quick wins.
6. **Tiers 10–11** (39–45) are feature follow-ons and P3 polish (43/45 deprioritized).
7. **Deferred** (46–47) waits for a real public-store launch.
