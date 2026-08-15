# App Store screenshots

Generated from the `/demo` screenshot page, which renders pixel-matched mocks of the React
Native screens. Regenerate any time the UI changes — these are checked in so the submission
assets travel with the project, not so they're edited by hand.

## Regenerating

`/demo` accepts `?shot=<size>`, which renders the phone layout scaled to Apple's exact pixel
dimensions. A plain viewport-sized capture is then already submission-ready — no upscaling
(which blurs) and no DevTools DPI fiddling.

```bash
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=4000 \
  --screenshot=out.png --window-size=1290,2796 \
  "https://outdoor-gm.web.app/demo?state=gm-play&shot=6.7"
```

Chrome cannot write into the OneDrive-synced repo directory (access denied) — capture to a
temp path and copy the files in afterwards.

## Sizes

| Folder | Pixels | Device class |
|---|---|---|
| `6.9/` | 1320 × 2868 | iPhone 16 Pro Max |
| `6.7/` | 1290 × 2796 | iPhone 15 Pro Max |
| `6.5/` | 1242 × 2688 | iPhone 11 Pro Max / XS Max |

App Store Connect generally needs only the largest size and scales the rest, but it has
historically asked for 6.5" separately. All three are here so the upload can't be blocked by
a missing size. No iPad sizes are needed — `ios.supportsTablet` is `false`.

## Order

The numbering is the intended display order. The first two do the selling: a live map with
players on it, then the end-game showdown.

1. **gm-play** — the live GM map, players and checkpoints, a stale-player warning
2. **gm-endgame** — the final showdown with the rally point
3. **gm-alerts** — the notification feed: arrivals, hazards, boons
4. **player-map** — the player's restricted view: play area and own position only
5. **results** — final times plus the post-game recap card

## Caveat

These are mocks rendered in a browser, not captures from a device. They mirror the real
screens (same palette from `constants/colors.ts`, same Ionicons, metrics copied from each
screen's StyleSheet) but can drift when the app changes — the end-game and recap screens had
to be added after the Tier 11 work, and the map canvas had to be redrawn phone-tall so store
shots weren't mostly empty. Check them against the real app before each submission.
