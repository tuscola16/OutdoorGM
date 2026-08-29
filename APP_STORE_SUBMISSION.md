# App Store submission kit

Everything needed to fill out the **Outdoor GM** App Store Connect listing
(app ID `6777033380`, bundle `com.bagelrun.outdoorgm`).

> **No credentials in this file.** The repo is public. The demo account goes
> straight into the App Store Connect *App Review Information* fields, never into git.

---

## 1. Listing text

> **App Store Connect is canonical for listing copy.** The text below is a mirror of what
> is actually live on the record (verified 2026-08-15). If you change one, change the other.

**Name:** Outdoor GM
**Subtitle (30 char max):** `Game master for the outdoors`
**Categories:** primary **Entertainment**, secondary **Sports**

**Promotional text (170 max):**
> Gather your group, head outside, and run your own live game. Watch every player on one
> map and get an instant alert the moment someone reaches a checkpoint.

**Keywords (100 char max, comma-separated, no spaces):**
```
gps,gamemaster,livemap,tracker,checkpoint,survival,team,group,event,geocaching,larp,tag,trail,hike
```

**Description:**
```
Outdoor GM turns any park, woods, trail, or campus into the board for your own live-action game.

One person runs the game as the Game Master. Everyone else joins with a code and heads out. As players move through the real world, the GM watches them all on a single live map and gets an instant alert the moment a player reaches a checkpoint — no radios, no guessing, no spreadsheets.

FOR THE GAME MASTER
- Live map of every player, updating in real time
- Drop checkpoints anywhere and get alerted the instant someone arrives
- Set a play-area boundary and get warned if a player wanders out of it
- Broadcast announcements and events to everyone, or send one to a single player
- Build a timed run-sheet that fires events, opens locations, and pings you on schedule
- Track who's still in, who's out, and how long everyone has played

FOR PLAYERS
- Join in seconds with a game code
- See your own position on the map and your time remaining
- Get game events and alerts the moment they happen, even with your screen locked
- One-tap safety alert to reach the Game Master if you ever need help

BUILT FOR REAL OUTDOOR PLAY
- Keeps you on the map in the background, even with the app closed
- Battery-saver mode for long sessions
- Optional timed check-ins keep everyone in the game

Whether it's a last-one-standing survival game, a checkpoint race, capture-the-flag, or your own invented format, Outdoor GM gives you the live map and the tools to run it.

LOCATION & PRIVACY
Outdoor GM uses your location — including in the background during a game — so your Game Master can see you on the map and the game can react when you reach a checkpoint. Your location is shared only with the Game Master of a game you join, and only while you're playing. Leave a game at any time to stop sharing.
```

---

## 2. Required URLs — LIVE

Both are deployed, public (no auth), and **now set on the App Store Connect record**:

| Field | URL | Status |
|---|---|---|
| Privacy policy | https://outdoor-gm.web.app/privacy | live, set on record |
| Support | https://outdoor-gm.web.app/support | live, set on record |

> The record previously carried `https://tuscola16.github.io/OutdoorGM/support.html` as the
> support URL, which **404s**, and had no privacy policy URL at all. Both were corrected on
> 2026-08-15. App Review opens both links, so re-check them with a plain `curl -I` before
> each submission rather than trusting this table.

The privacy page is written against what the code actually does — background GPS during
lobby/play/endgame, automatic deletion of location and arrival data on game end, ration
photos visible to that game's GMs, in-app account deletion. **If those behaviours change,
`web/src/screens/LegalScreens.tsx` has to change with them**, because App Review reads this
page for a location-tracking app.

The contact address on all three pages is `tuscola16@gmail.com`. It was previously
`support@outdoorgm.app`, which **never worked** — `outdoorgm.app` has never been registered
and returns NXDOMAIN for both A and MX, so every mail to it hard-bounced. Neither store
requires a branded address, only one that receives mail; this is the same address eatMyPack
ships on its own privacy/support pages. If you ever do buy the domain, change it here, in
`web/src/screens/LegalScreens.tsx`, and on both store records together.

---

## 3. Privacy nutrition labels

Derived from the actual data flows, and consistent with `ios.privacyManifests` in `app.json`.

| Data type | Collected | Linked to identity | Used for tracking | Purpose |
|---|---|---|---|---|
| Precise location | Yes | Yes | No | App functionality |
| Email address | Yes | Yes | No | App functionality |
| Name | Yes | Yes | No | App functionality |
| Photos | Yes | Yes | No | App functionality |
| Device ID (FCM token) | Yes | Yes | No | App functionality |
| Crash data | Yes | No | No | App functionality |

Nothing is used for advertising, and there is no third-party tracking — answer **No** to
the tracking question, matching `NSPrivacyTracking: false`.

---

## 4. App Review information

**This is the section that decides whether background location passes review.**

A reviewer sitting at a desk cannot exercise this app alone: it needs a Game Master
watching a map *and* a player physically crossing a geofence. Say so explicitly, and give
them a way to see it without walking outside.

**Demo account:** `reviewer@outdoorgm.test` — set on the record, and confirmed to exist and
sign in against Firebase Auth. The password lives in the ASC field only, never in git.

**Notes to reviewer — LIVE on the record** (set 2026-08-15; mirror below, ASC is canonical):
```
Outdoor GM coordinates real-world outdoor games — scavenger hunts, survival games, field
exercises, LARP and airsoft events. One person acts as the Game Master and watches every
player on a live map. Players share their location and see only themselves; no player ever
sees another player.

WHY THIS APP NEEDS "ALWAYS" LOCATION
Players are physically spread across a large outdoor area for one to four hours with their
phones in a pocket and the screen locked. The Game Master's live map, the checkpoint
geofence alerts, and the SOS safety feature all depend on position updates continuing while
the app is backgrounded. Without background location the app cannot perform its core
function.

Location sharing starts only when a Game Master starts a game, and stops automatically when
the player taps out or the game ends. Location and arrival data are deleted when the game
ends. Location is shared only with the Game Master of a game the player has chosen to join.

HOW TO TEST WITHOUT GOING OUTSIDE
Sign in with the demo account above. It is a Game Master account.

1. Tap "Create Game". Pan the map to set a play boundary, add a checkpoint, then tap
   "Open to Players". You now see the Game Master view: live map, player roster, and
   checkpoint list.
2. The game screen shows a 6-character player code. Joining with that code from a second
   device — or after signing out on this one — shows the restricted player view.
3. Location can be simulated without walking outside: in the iOS Simulator use
   Features > Location > Freeway Drive, or use Xcode's location simulation on a device.
   Moving inside a checkpoint radius fires an arrival alert to the Game Master.

Privacy policy: https://outdoor-gm.web.app/privacy
Support: https://outdoor-gm.web.app/support
```

> These notes deliberately walk the reviewer through **creating** a game rather than pointing
> at a pre-seeded one, so they don't rot. If you do seed a `lobby` game for a submission, add
> its name and player code here and shorten step 1 — but then the notes have a dependency
> that has to be re-checked every time.

**Attach a screen recording.** For an Always-location app this is the single highest-value
thing you can provide. Record a real game: GM starts it, a player walks into a checkpoint,
the alert lands, phone locks and the dot keeps moving.

---

## 5. Screenshots — GENERATED AND UPLOADED

15 files, checked in at `store-screenshots/`, at Apple's exact dimensions. **10 of them are
uploaded** to the 1.0.0 record (verified `assetDeliveryState: COMPLETE`, no errors/warnings):

| Folder | Pixels | Device class | ASC display type |
|---|---|---|---|
| `6.9/` | 1320 × 2868 | iPhone 16 Pro Max | `APP_IPHONE_67` ← uploaded |
| `6.7/` | 1290 × 2796 | iPhone 15 Pro Max | `APP_IPHONE_67` — redundant, not uploaded |
| `6.5/` | 1242 × 2688 | iPhone 11 Pro Max / XS Max | `APP_IPHONE_65` ← uploaded |

> **There is no `APP_IPHONE_69` display type.** The API enum stops at `APP_IPHONE_67`, and
> that one slot accepts either 1290 × 2796 or 1320 × 2868 — only one set can occupy it. We
> upload the 6.9" (1320 × 2868) because it is the current required size, which makes the
> `6.7/` folder dead weight for iOS. Keep generating it only if you want it for other stores.

Display order (the first two do the selling):

1. **gm-play** — live GM map, players and checkpoints, stale-player warning
2. **gm-endgame** — final showdown with the rally point
3. **gm-alerts** — notification feed: arrivals, hazards, boons
4. **player-map** — the player's restricted view
5. **results** — final times plus the post-game recap card

No iPad sizes needed — `ios.supportsTablet` is `false`.

Regenerate with the recipe in `store-screenshots/README.md`. They are browser-rendered
mocks, not device captures, so check them against the real app before each submission.

---

## 6. Pre-submission checklist

Record state as of **2026-08-15**: version `1.0.0`, `PREPARE_FOR_SUBMISSION`, **no build ever
uploaded**. Everything below marked done was verified by reading the field back from the API,
not just by a 200 response — see the `contentRightsDeclaration` note for why that matters.

**Done**

- [x] ~~Privacy policy URL live *and set on the record*~~ — https://outdoor-gm.web.app/privacy
- [x] ~~Support URL live *and set on the record*~~ — https://outdoor-gm.web.app/support (the old value 404'd)
- [x] ~~Screenshots generated~~ — `store-screenshots/`, all three sizes
- [x] ~~Screenshots uploaded to App Store Connect~~ — 5 × `APP_IPHONE_67` + 5 × `APP_IPHONE_65`, all `COMPLETE`
- [x] ~~Version string matches the binary~~ — record moved `1.0` → `1.0.0` to match `app.json`
- [x] ~~Categories set~~ — primary Entertainment, secondary Sports
- [x] ~~Review notes written~~ — the "why Always location" + simulator test recipe, ~1.8k chars
- [x] ~~Demo account~~ — `reviewer@outdoorgm.test` exists in Firebase Auth and signs in
- [x] ~~Age rating~~ — `FOUR_PLUS`, declaration complete
- [x] ~~APNs auth key uploaded to Firebase~~ — `UTTR598W4P`, verified in console
- [x] ~~Encryption declaration~~ — `ITSAppUsesNonExemptEncryption: false` in `app.json`

**Console-only — no public API exists**

- [ ] **App Privacy nutrition labels** — §3 has the table; ASC exposes no endpoint for these
- [ ] **Content rights declaration** — `PATCH /v1/apps/{id}` accepts `contentRightsDeclaration`
      and **echoes it back in a 200, but never persists it** (read-back is still `null`).
      Do not trust the 200; set it in the console.
- [ ] Duplicate listing "Outdoor Game Master" (`com.outdoorgamemaster.app`, ID 6775019774) removed

**Blocked on a device / a build**

- [ ] Build uploaded and attached to 1.0.0
- [ ] Screen recording of a real game attached to review notes
- [ ] A game left in `lobby` phase for the reviewer — every game on the demo account is
      currently `results`/ended. The review notes deliberately tell the reviewer to *create*
      a game instead, so this is optional polish rather than a blocker.

**Still open**

- [ ] Price schedule (Free) + territory availability — never configured on this record
- [ ] App Store Connect API key wired to `eas submit` — key `9DN225MYUH` already exists with Admin access
- [x] ~~Contact address receives mail~~ — now `tuscola16@gmail.com`; the old
      `support@outdoorgm.app` bounced (domain never registered)
- [ ] Google Maps API keys restricted by bundle ID (repo is public; the iOS Maps key doubles as the Firebase `API_KEY`)
- [ ] App Check enforcement considered before real users
