# Google Play submission kit

The Android counterpart to [APP_STORE_SUBMISSION.md](APP_STORE_SUBMISSION.md). Same app,
same backend, different store — and Play asks for several things Apple never does.

App: **Outdoor GM** · package `com.bagelrun.outdoorgm` · Play Console app already created.

> **No credentials in this file.** The repo is public. Test-account passwords go into the
> Play Console *App access* field only, never into git.

---

## 1. Listing text

Short and full descriptions live in [STORE_LISTING.md](STORE_LISTING.md) — the full
description is shared with the App Store. Play-specific limits:

| Field | Limit | Value |
|---|---|---|
| App name | 30 | `Outdoor GM` |
| Short description | 80 | `Run live outdoor games: watch players on a map, get instant checkpoint alerts.` (78) |
| Full description | 4000 | reuse the App Store description |

**URLs** — all live, verified 2026-08-29:

| Field | URL |
|---|---|
| Privacy policy | https://outdoor-gm.web.app/privacy |
| Terms | https://outdoor-gm.web.app/terms |
| Support | https://outdoor-gm.web.app/support |
| Contact email | `tuscola16@gmail.com` |

---

## 2. Assets — CHECKED IN

All in `store-screenshots/`. See its README for how to regenerate.

| Asset | File | Pixels |
|---|---|---|
| Phone screenshots ×5 | `play-phone/01…05-*.png` | 1080 × 1920 |
| Feature graphic | `play-feature-graphic.png` | 1024 × 500 |
| Listing icon | `play-icon-512.png` | 512 × 512, 32-bit |

> **Do not upload the `6.5/`, `6.7/`, or `6.9/` folders.** Those are the App Store captures
> at ~1:2.17; Play requires 16:9 or 9:16 and rejects them.

Tablet screenshots are optional and not captured — the app is portrait-phone only.
The feature graphic is a serviceable placeholder assembled from the icon and palette, not
a designed asset; it's the first thing worth replacing.

---

## 3. App access — REQUIRED, easy to miss

Outdoor GM is entirely behind a login, so Play **will** reject a submission that leaves this
blank. Provide the same demo account used for App Review:

- Username: `reviewer@outdoorgm.test`
- Password: → Play Console field only
- Instructions: the "how to test without going outside" steps from §4 of the App Store kit,
  adapted — on Android, location is simulated from Android Studio's Extended Controls
  (Location → Routes) or `adb emu geo fix <lon> <lat>`.

---

## 4. Data safety form

Play's vocabulary differs from Apple's. **Collected** = sent off the device. **Shared** =
transferred to another company *or made visible to other users*. Location and display name
are visible to that game's Game Masters, so they count as shared.

| Data type | Collected | Shared | Purpose | Required? |
|---|---|---|---|---|
| Precise location | Yes | **Yes** — with the game's GMs | App functionality | Required |
| Email address | Yes | No | Account management | Required |
| Name (display name) | Yes | **Yes** — with game participants | App functionality | Required |
| Photos (ration cards) | Yes | **Yes** — with the game's GMs | App functionality | Optional |
| Device or other IDs (FCM token) | Yes | No | App functionality (push) | Required |
| Crash logs | Yes | No | Analytics / app functionality | Optional |

Also answer:

- **Encrypted in transit** — Yes. All traffic is Firebase over TLS.
- **Users can request deletion** — Yes. In-app at *Profile → Delete account*
  (`services/gameService.ts` → `deleteAccount`), plus the contact address.
- **Collected in the background** — Yes, for location. This is the answer that triggers §5.

> Keep this table consistent with `ios.privacyManifests` in `app.json` and §3 of the App
> Store kit. If a data flow changes, all three change together.

---

## 5. Background location declaration — THE LONG POLE

Play reviews this separately from the app, and it runs one to several weeks. **File it
early**, not after the build is ready.

### Written justification

```
Outdoor GM coordinates real-world outdoor games — scavenger hunts, survival games, field
exercises, LARP and airsoft events. One person acts as the Game Master and watches every
player on a live map. Players share their location and see only themselves; no player ever
sees another player.

Background location is the app's core function, not an enhancement. Players are physically
spread across a large outdoor area for one to four hours with their phones pocketed and
screens locked. Three features depend on position updates continuing while the app is
backgrounded:

1. The Game Master's live map, which is the entire point of the product.
2. Checkpoint geofence alerts, which fire when a player physically reaches a location.
3. The safety alert, which sends the player's current position to the Game Master.

Without background location, a player disappears from the map the moment they pocket their
phone, and the game cannot be run.

Location sharing is bounded and user-initiated. It starts only after the player joins a
game with a code and the Game Master starts that game; it stops when the player taps out,
is eliminated, leaves, or the game ends. Location is visible only to the Game Masters of
that game. Location and arrival records are deleted automatically when the game ends.

Prominent disclosure: before any location permission is requested, the player sees a
permission primer (components/LobbyPermissions.tsx) naming each permission and why it is
needed. While tracking runs, a persistent foreground-service notification states that the
player's location is being shared with their Game Master.
```

### Demo video

Play wants a video showing the background-location use case. Unlisted YouTube is fine.
Shot list — needs two devices, or one device plus the web GM dashboard:

1. Player taps the permission primer and grants **Allow all the time**. Show the primer
   text on screen; this is the prominent disclosure.
2. Game Master's map with the player's dot moving.
3. Player **locks the phone** — hold on the lock screen showing the persistent location
   notification.
4. Cut to the GM map: the dot is still moving with the phone locked. This is the shot the
   reviewer needs.
5. Player walks into a checkpoint radius → the GM's arrival alert lands.
6. Player taps **I'm Out** → tracking stops, notification clears.

---

## 6. Content rating (IARC questionnaire)

Answer honestly; the app depicts no violence, only a map.

| Question | Answer |
|---|---|
| Violence, sexual content, profanity, drugs | No to all — the elimination theme is conceptual, never depicted |
| Users can interact / communicate | **Yes** — the GM sends free-text announcements to players |
| Users can share content with other users | **Yes** — display name, location, and ration photos |
| Shares user location with other users | **Yes** |
| User-generated content with no moderation | Yes — GM announcements are free text |

Expect **Teen** or equivalent. The location-sharing answers drive the rating more than
anything thematic.

> There is **no player↔player channel** (`types/index.ts:568` — GM→player is one-way).
> Say so if the questionnaire gives room; it's a materially safer product than open chat.

---

## 7. Target audience — a real trap

Select **13+ and above. Do not select any under-13 audience.**

Choosing an under-13 bracket puts the app under the Families policy, which effectively
prohibits background location collection — it would invalidate §5 and sink the submission.
This matches the privacy policy, which states the app is not directed at children under 13.

---

## 8. Remaining declarations

| Declaration | Answer |
|---|---|
| Ads | No ads |
| Government app | No |
| News app | No |
| Financial features | No |
| Health apps | No |
| Data deletion URL | https://outdoor-gm.web.app/support (documents in-app deletion + contact) |

---

## 9. Build and submit

`eas.json` already carries `submit.production.android`, tracked to `internal` — the first
upload should land in internal testing, not production.

```bash
eas build --platform android --profile production   # produces an AAB
eas submit --platform android
```

Still to do before that works:

- [ ] Create a Google Cloud service account, grant it Play Console access, download the
      JSON to `./play-service-account.json` (gitignored). eatMyPack has a working example:
      `google-play-deploy@eatmypack.iam.gserviceaccount.com`.
- [ ] **A production build uses a different keystore than `preview`.** Register its SHA-1
      on the Android Maps key and its SHA-256 for Play Integrity / Firebase, or the first
      production install shows a blank map. See the App Check notes in the project memory.

---

## 10. Checklist

**Done**

- [x] ~~Play Console app created~~ — `com.bagelrun.outdoorgm`
- [x] ~~Privacy, terms, support URLs live~~ — verified 2026-08-29
- [x] ~~Contact address receives mail~~ — `tuscola16@gmail.com`
- [x] ~~Phone screenshots at 9:16~~ — `store-screenshots/play-phone/`, 5 × 1080 × 1920
- [x] ~~Feature graphic + 512 icon~~ — checked in
- [x] ~~`eas submit` android config~~ — `eas.json`, track `internal`
- [x] ~~targetSdk meets the deadline~~ — RN 0.86 pins 36; Play required 36 from 2026-08-31

**Open — needs the Play Console**

- [ ] Store listing text pasted; assets uploaded
- [ ] App access (test credentials) — submission is rejected without it
- [ ] Data safety form (§4)
- [ ] Background location declaration + video (§5) — **start first, longest lead time**
- [ ] Content rating questionnaire (§6)
- [ ] Target audience set to 13+ (§7)
- [ ] Remaining declarations (§8)

**Open — needs a build or a device**

- [ ] Play service-account JSON
- [ ] Production AAB (every Android build so far is a `preview` APK)
- [ ] Background-location demo video
- [ ] Production keystore SHA-1 / SHA-256 registered
