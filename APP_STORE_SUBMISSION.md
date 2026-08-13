# App Store submission kit

Everything needed to fill out the **Outdoor GM** App Store Connect listing
(app ID `6777033380`, bundle `com.bagelrun.outdoorgm`).

> **No credentials in this file.** The repo is public. The demo account goes
> straight into the App Store Connect *App Review Information* fields, never into git.

---

## 1. Listing text

**Name:** Outdoor GM
**Subtitle (30 char max):** `Live GPS games for real life`

**Promotional text (170 max):**
> Run large outdoor games with confidence. Watch every player on a live map, fire
> events when they reach checkpoints, and keep the whole field coordinated from your phone.

**Keywords (100 char max, comma-separated, no spaces):**
```
gps,outdoor,game master,live map,checkpoint,geofence,tracking,scavenger,larp,airsoft,survival,event
```

**Description:**
```
Outdoor GM turns a park, campus, or patch of woods into a live playing field.

FOR GAME MASTERS
Watch every player move on a real-time map. Draw your play boundary, drop checkpoints,
and attach events to them — a hazard, a boon, a message to one player or everyone. When
someone crosses a checkpoint, the event fires and you get an instant alert.

Build a run sheet ahead of time so announcements and reveals fire on a schedule, or
trigger anything by hand mid-game. Message co-GMs privately. See who has gone quiet,
who has called for help, and who is still standing.

FOR PLAYERS
Your phone shares your location so the Game Master can see you — and shows you only what
you're meant to see: the play area, your own position, and any locations revealed to you.
No player sees another player.

Raise an SOS if something goes wrong. Tap out when you're done. Watch the clock on how
long you've lasted.

BUILT FOR REAL EVENTS
- Location keeps updating in the background, even with your screen locked
- Practice mode for an on-site dress rehearsal the night before
- Custom arena maps: overlay your own hand-drawn map on the live map
- Post-game recap: attach a video and photo album everyone can see

Outdoor GM works for scavenger hunts, survival games, field exercises, LARP events,
airsoft, camp-wide games, and anything else where people spread out and someone needs
to see the whole board.

Requires a data connection and location permission. Battery use is significant during
play — bring a power bank for long events.
```

---

## 2. Required URLs

Both are **mandatory** for a location-tracking app. Neither exists yet — these must
be live pages before submission.

| Field | Needed |
|---|---|
| Privacy policy URL | Required. Must cover precise-location collection, background collection, retention, and deletion. |
| Support URL | Required. A contact page or email is enough. |
| Marketing URL | Optional. |

The Firebase Hosting site (`outdoor-gm.web.app`) already serves the GM dashboard and is
the cheapest place to host both — add `/privacy` and `/support` routes.

**Privacy policy must state**, to match what the code actually does:
- Precise GPS location is collected continuously while a game is in the `lobby`, `play`,
  or `endgame` phase, including in the background with the screen locked.
- Location stops when the player taps out, is eliminated, or the game ends.
- Email address and display name are collected at signup.
- Ration photos are uploaded and visible to that game's Game Masters.
- Location and arrival history are **deleted automatically when a game ends**
  (`cleanupRationPhotosOnGameEnd`), as are ration photos and arena overlays.
- Users can delete their account and data in-app (Profile → Delete account).
- Crash diagnostics go to Firebase Crashlytics.

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

**Demo account:** enter the shared test login directly in the ASC fields. Pre-create a
game in `lobby` phase and give the reviewer its player code so they skip setup.

**Notes to reviewer — draft:**
```
Outdoor GM coordinates real-world outdoor games. It needs "Always" location because the
core function is showing a Game Master where players are while players' phones are in
their pockets with the screen locked. Without background location the app cannot do the
one thing it exists to do.

HOW TO TEST WITHOUT GOING OUTSIDE
The demo account above is already a Game Master of a game named "[NAME]" in the lobby.

1. Sign in and open that game to see the Game Master map, player roster, and checkpoints.
2. To see a player's view, join the same game from a second device (or after signing out)
   with player code [CODE].
3. Location updates can be simulated in the iOS Simulator via
   Features > Location > Freeway Drive, or on a device with Xcode's location simulation.
   Crossing into a checkpoint radius fires an alert to the Game Master.

WHY BACKGROUND LOCATION
Players are physically moving across a large outdoor area for 1-4 hours with their phones
pocketed. The Game Master's live map, the checkpoint geofence alerts, and the SOS safety
feature all depend on position updates continuing while the app is backgrounded. Location
sharing starts only when a Game Master starts a game, and stops automatically when the
player taps out or the game ends.

A screen recording of a full game is attached / available at [URL].
```

**Attach a screen recording.** For an Always-location app this is the single highest-value
thing you can provide. Record a real game: GM starts it, a player walks into a checkpoint,
the alert lands, phone locks and the dot keeps moving.

---

## 5. Screenshots

Required at 6.7" (1290x2796) and 6.5" (1242x2688). These must come from a real device or
simulator — they cannot be mocked up from the web dashboard.

Suggested set, in order:
1. GM live map with several players and checkpoints visible
2. Checkpoint arrival alert / notification feed
3. Player view: play boundary and own position
4. Run sheet or checkpoint behavior editor
5. Results screen with player times

---

## 6. Pre-submission checklist

- [ ] Version string in App Store Connect matches the binary — record says `1.0`, build is `1.0.0`
- [ ] Duplicate listing "Outdoor Game Master" (`com.outdoorgamemaster.app`, ID 6775019774) removed
- [ ] APNs auth key uploaded to Firebase → Project Settings → Cloud Messaging (iOS push is dead without it)
- [ ] App Store Connect API key created so `eas submit` can run
- [ ] Privacy policy URL live
- [ ] Support URL live
- [ ] Screenshots uploaded
- [ ] Nutrition labels completed
- [ ] Review notes + demo account + recording attached
- [ ] Google Maps API keys restricted by bundle ID (repo is public; the iOS Maps key doubles as the Firebase `API_KEY`)
- [ ] App Check enforcement considered before real users
