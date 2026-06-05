# Outdoor GM — Store Listing Copy

Paste-ready metadata for the App Store and Play Store. Review-safe framing: this is a
tool for **running real outdoor games** (live map + GPS + safety), so the copy leads with
the Game-Master/tracking utility and keeps the "last one standing" theme light — Apple/Google
are sensitive about real-people + location + violence, and the app itself shows a map, not combat.

App Store app: **6777033380** · bundle **com.bagelrun.outdoorgm** · SKU `outdoorgm`

---

## App Store (iOS)

**Name** (≤30): `Outdoor GM`

**Subtitle** (≤30): `Run live outdoor games`
- alternates: `Live GPS games for groups` (25) · `Game master for the outdoors` (28)

**Promotional Text** (≤170, editable anytime without review):
> Gather your group, head outside, and run your own live game. Watch every player on one map and get an instant alert the moment someone reaches a checkpoint.

**Keywords** (≤100 chars, comma-separated, **no spaces**, don't repeat words already in the name/subtitle — Apple ignores those):
```
gps,gamemaster,livemap,tracker,checkpoint,survival,team,group,event,geocaching,larp,tag,trail,hike
```
(~96 chars — verify in ASC; trim if it flags over 100.)

**Description** (≤4000):
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

**URLs**
- Privacy Policy: `https://tuscola16.github.io/OutdoorGM/privacy.html`
- Support URL: `https://tuscola16.github.io/OutdoorGM/support.html`
- Marketing URL (optional): `https://tuscola16.github.io/OutdoorGM/`

**Category:** Primary **Entertainment** · Secondary **Sports** (alt: Utilities)

**Age rating:** answer the questionnaire honestly — the app depicts no violence (just a map), so it lands around **9+**. The "elimination/last one standing" is conceptual, not shown.

**Privacy "Nutrition Label" / Data collected** (none used for tracking or ads):
| Data | Purpose | Linked to user? | Tracking? |
|---|---|---|---|
| Precise Location | App Functionality (core: live map + checkpoints) | Yes | No |
| Email Address | App Functionality (account) | Yes | No |
| Name (display name) | App Functionality | Yes | No |
| Photos (ration-card photos) | App Functionality | Yes | No |
| Device ID / Push token (FCM) | App Functionality (notifications) | Yes | No |

> Be ready to justify **background location** in App Review notes: *"Players share location in the background so the Game Master can see them on a live map and the game can trigger checkpoint events while phones are pocketed/locked. Shared only with the game's GM, only during an active game."*

---

## Play Store (Android) — for the listing you'll create for com.bagelrun.outdoorgm

**Short description** (≤80):
> Run live outdoor games: watch players on a map and get instant checkpoint alerts.

**Full description** (≤4000): reuse the App Store description above.

**Data safety form:** mirror the table above (Location — collected, shared with other users [the GM], app functionality, not for tracking; plus email, photos, FCM token).

> Background-location justification (Play requires a short video + declaration): same wording as the App Review note above. The in-app foreground-service notification ("Your location is being shared with your Game Master") already satisfies the prominent-disclosure requirement.

---

## Notes
- App display name in builds comes from `app.json` (`expo.name = "Outdoor GM"`); the store **listing** name is set here in the console and must stay ≤30 chars and unique (already freed from the old record).
- Screenshots needed: 6.7" iPhone (required) + 6.5"/5.5" as desired; Android phone + 7"/10" tablet optional. Capture the GM live map, a player map, the checkpoint/alerts view, and the lobby.
