# Outdoor GM — Enhancement Roadmap

Outstanding work only. **Built functionality lives in the [README](README.md#features)**;
implementation-ready schema/enforcement detail for the items below is in
[ROADMAP_DATA_MODEL.md](ROADMAP_DATA_MODEL.md) (keyed by the same item numbers); see
[COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) for prioritization rationale.

**Current focus: a beautifully functional APK for a limited, trusted user base** — not a public
store launch. Items are grouped by tier, roughly in build order. Numbers are stable and never reused
once an item lands; the list was **renumbered 2026-06-06** (a one-time reset after a large batch
shipped — earlier `#`/`§` numbers are retired and don't map forward) and **trimmed 2026-06-07** when
the batch below shipped (so it opens at Tier 4 / item 11).

> **Built & removed** (retired numbers, never reused — see git history + the
> [README](README.md#features)):
> - **1–10** — Tier 1 deploy blockers (Twilio secrets, run-sheet index), Tier 2 safety
>   (SOS→SMS, offline write queue, persistent SOS + GM ack, End-Game block on unaccounted players,
>   boundary-exit alert), Tier 3 correctness (GM-excluded winner detection, no shared-device
>   double-push, transactional arrival dedup).
> - **17** purge locations/arrivals on game end · **18** `getMyGames` parallelized ·
>   **19** single shared broadcast subscription · **31** coordinate range validation in rules ·
>   **32** SMS rebrand · **34** dropped the unused `arrivals` index.
> - **36–38** Tier 9 UX (game-list sort + `gameDate`, join name prefill, navigate-after-join).
> - **39–40** Tier 10 follow-ons (web polygon authoring; per-player checkpoints + GM↔GM messaging).

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

**16. Cache game-phase/member-role in `onLocationUpdate`.** The lobby short-circuit, zero-checkpoint
skip, and checkpoint cache shipped, but the trigger still reads the game doc **and** the member doc
on every location write. Cache phase/role (short TTL, like the checkpoint cache) to cut the
remaining per-write reads. Model cost at expected player counts before launch.

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

**29. Handle the sole-GM case in `deleteAccount`.** Membership deletes are already chunked into
≤450-write batches; the remaining gap is the *sole GM* of a game — deleting them orphans it (players
remain, no GM). Transfer GM, or server-side end the game.

**30. Stabilize the player tracking effect.** Drive tracking from one controller keyed on a stable
`shouldTrack` boolean so `displayName` arriving (`'' → name`) doesn't stop/restart the background
service, and the AppState effect can't start it concurrently.

**33. Reset login button loading on stuck nav.** `app/(auth)/login.tsx` only clears `loading` on
error; add `finally { setLoading(false) }` so the button can't spin forever if nav stalls.

**35. Low-battery beacon.** Players report battery level with each fix; the GM roster flags a
player about to go dark (Rule 21) so they can be checked on before they vanish.

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

1. **Tier 4** (11–12) completes the ration loop; **Tier 5** (13–15) cleans up its UX.
2. **Tier 6** (16) trims the last geofence read cost; **Tier 7** (20–28) — integrity invariants —
   land alongside the features they protect.
3. **Tier 8** (29, 30, 33, 35) trails as robustness/polish.
4. **Tier 11** (41–45) is P3 polish (43/45 deprioritized).
5. **Deferred** (46–47) waits for a real public-store launch.
