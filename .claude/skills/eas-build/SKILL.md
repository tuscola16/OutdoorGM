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

On success the command prints a line ending in the build page URL — the label has
varied across CLI versions (`See logs:` or `Build details:`), so match on the URL
shape, not the label:

```
See logs: https://expo.dev/accounts/<account>/projects/outdoor-gm/builds/<build-id>
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

Key fields on each build object (verified against the JSON output):
- **Status:** `.status` — `IN_QUEUE` / `IN_PROGRESS` (not ready), `FINISHED` (ready),
  `ERRORED` (failed).
- **Direct download (installable artifact):** `.artifacts.applicationArchiveUrl`.
  Note: `.artifacts` is an **empty object `{}`** until the build is `FINISHED`, so
  this is only present on finished builds.
- **Dashboard page:** there is *no* URL field in the JSON — construct it from
  `https://expo.dev/accounts/<.project.ownerAccount.name>/projects/<.project.slug>/builds/<.id>`.

Parse with **node** (this is a Node project; `python` may not be installed on
Windows). Drop `--platform` to get the latest build of any platform:

```bash
eas build:list --platform android --limit 1 --non-interactive --json \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s)[0];const p=b.project;const dash=\`https://expo.dev/accounts/\${p.ownerAccount.name}/projects/\${p.slug}/builds/\${b.id}\`;const dl=(b.artifacts||{}).applicationArchiveUrl;console.log('status:',b.status);console.log('dashboard:',dash);console.log('download:',dl||'(not ready — build not FINISHED)');})"
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
