---
name: eas-build
description: >-
  Kick off an EAS cloud build for the Outdoor GM app and return the build's
  dashboard URL (where the installable download link appears when it finishes).
  Use this whenever the user wants to build the app, ship a new build, make an
  APK/IPA, "kick a build", "cut a build", get a fresh install link, or asks for
  a download link for the app — even if they don't say "EAS" or "Expo". Defaults
  to an Android APK (the `preview` profile) but accepts a platform and/or profile
  override. Also use it to fetch the download link of the most recent build.
---

# EAS Build (Outdoor GM)

Outdoor GM is built in the cloud with **EAS Build** (profiles defined in `eas.json`:
`development`, `preview`, `production`). This skill kicks off a build and hands
back the EAS dashboard URL right away — the actual artifact download link shows up
on that page once the build finishes (~10–20 min).

The app uses native modules and can't run in Expo Go, so a real build is the only
way to get an installable artifact. See `RUNNING.md` for how to install/run it.

## Defaults

Unless the user specifies otherwise:
- **Platform:** `android`
- **Profile:** `preview` → produces an installable **`.apk`** with a direct download
  link (see `eas.json`: `preview.android.buildType = "apk"`). This is the right
  default for "give me a download link" because an APK can be sideloaded directly.
- **Mode:** `--no-wait` → queue the build and return immediately with the dashboard
  URL, rather than blocking for the whole build.

Map a user's words to overrides:
- "dev build" / "dev client" → profile `development`
- "release" / "store build" / "production" → profile `production`
- "iphone" / "ios" → platform `ios`  ·  "both" / "android and ios" → platform `all`

## Workflow

### 1. Verify the EAS CLI is authenticated

```bash
eas whoami
```

If `eas` isn't found, prefix every command with `npx` (e.g. `npx eas whoami`).
If it prints "Not logged in", tell the user to run `eas login` (interactive — it
needs their Expo credentials, so they must run it themselves) and stop here.

### 2. Kick off the build

Run from the repo root. Substitute the platform/profile per the user's request,
defaulting as above:

```bash
eas build --profile preview --platform android --non-interactive --no-wait
```

`--non-interactive` prevents prompts (e.g. credential questions) from hanging the
run. If the command fails because credentials aren't set up yet, that step is
genuinely interactive — surface the error and let the user run the build manually
once to establish credentials.

### 3. Return the dashboard URL

The command prints a line like:

```
Build details: https://expo.dev/accounts/<account>/projects/outdoor-gm/builds/<build-id>
```

Extract that `https://expo.dev/...builds/<id>` URL from the output and give it to
the user as the build link. If the output didn't surface it (or scrolled off),
recover it with the snippet in the next section.

Tell the user plainly: the build is queued; open that URL to watch progress, and
the **Download** button (the installable artifact link) appears there once the
build succeeds.

## Fetching the download link of the latest build

Use this when the user asks for the download link after a build has finished, or
to recover the dashboard URL. It reads the most recent build as JSON:

```bash
eas build:list --platform android --limit 1 --non-interactive --json
```

From the JSON of that one build:
- **Direct download (installable artifact):** `.[0].artifacts.applicationArchiveUrl`
- **Dashboard page:** `.[0].artifacts.buildUrl`
- **Status:** `.[0].status` — only `FINISHED` builds have a usable download URL;
  `IN_QUEUE` / `IN_PROGRESS` mean it isn't ready yet, `ERRORED` means it failed.

Example to pull just the download link (drop `--platform` to get the latest of any
platform):

```bash
eas build:list --platform android --limit 1 --non-interactive --json \
  | python -c "import json,sys; b=json.load(sys.stdin)[0]; print(b.get('status'), b.get('artifacts',{}).get('applicationArchiveUrl') or b.get('artifacts',{}).get('buildUrl'))"
```

If the status isn't `FINISHED`, report the status and the dashboard URL instead of
a download link, and let the user know to check back.

## Notes

- Don't run `eas login`, credential setup, or any other interactive/credential
  prompt on the user's behalf — those need their input. Hand them the exact command
  to run.
- A build uploads the current project state; there's no need to commit first, but
  uncommitted changes that affect the native build (app.json, plugins) will be
  included as-is.
- iOS `preview`/`development` artifacts can't be freely sideloaded without
  registered devices or TestFlight — flag this if the user asks for an iOS
  download link expecting to just tap-to-install.
