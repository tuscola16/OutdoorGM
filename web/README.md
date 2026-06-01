# Outdoor GM — Web GM Dashboard

A desktop web app for **Game Masters**, living in this repo's `web/` subfolder. It
talks to the **same Firebase backend** as the mobile app (same project, Firestore
schema, security rules, and Cloud Functions) via the **Firebase JS SDK**. Players
stay on the mobile app — the web app is GM-only (no GPS/background tracking).

Stack: Vite + React + TypeScript + `firebase` (JS SDK) + `mapbox-gl`.

## Setup

```bash
cd web
npm install
cp .env.example .env   # then fill in the values
```

Fill `.env`:

- `VITE_FIREBASE_*` — from Firebase console → Project settings → **Your apps** →
  **Add app → Web** (project `outdoor-gm`). These are not secrets; access is
  controlled by Firestore security rules.
- `VITE_MAPBOX_TOKEN` — the same public `pk.` token used by the mobile app's
  `EXPO_PUBLIC_MAPBOX_TOKEN` (https://account.mapbox.com/access-tokens/).

## Develop

```bash
cd web
npm run dev          # http://localhost:5174
```

Against local Firebase emulators (run from the repo root:
`firebase emulators:start --config firebase.emulator.json`), set
`VITE_USE_EMULATOR=true` in `.env`.

## Build & deploy (Firebase Hosting)

```bash
cd web && npm run build           # outputs web/dist
cd .. && firebase deploy --only hosting
```

`firebase.json` points Hosting at `web/dist` (SPA rewrite to `index.html`).

## What it does

Full GM parity with the mobile app, phase-driven (`setup → lobby → play →
results`):

- **setup** — draw the play boundary (click-drag on the map), add/edit checkpoints
  (click the map), write rules.
- **lobby** — share the player code, watch players join, start the game.
- **play** — live map of all players + checkpoints, alerts feed, elapsed timer, end game.
- **results** — per-player times.
- **Players** — promote/demote co-GMs, remove members.
- Create a game, or join an existing one with its **GM code**.

## Notes

- Shared TypeScript types come from the repo-root `types/` via the `@shared`
  alias (see `vite.config.ts` / `tsconfig.json`).
- App Check is not enforced (`ENFORCE_APP_CHECK = false` in
  `functions/src/games.ts`). If you later enable it, register a reCAPTCHA v3
  provider for the web app and initialize App Check here.
