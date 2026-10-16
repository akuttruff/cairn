# Cairn

A personal daily log that runs on your own machine: what you ate, drank,
weighed and did, with the numbers worked out for you. Mobile-first (it is a
PWA you add to the home screen), served from a desktop over your own
network, and backed by a local SQLite file. No accounts, no cloud.

## What it tracks

- **Meals and macros**: calories, protein, carbs, fat and fiber per entry,
  with daily targets and a Day / Week / Month view.
- **Food lookup** three ways: search the USDA FoodData Central and Open Food
  Facts databases; scan a nutrition label from a photo or screenshot (a local
  vision model reads it); or ask for an online lookup, where a local model
  with a web-research tool reads the restaurant's or brand's own page. Every
  lookup produces candidates for you to check before anything is logged.
- **My foods**: anything you have typed or confirmed, for one-tap re-logging.
- **Water, alcohol, workouts, dog walks and meditation** as their own
  trackers.
- **Body**: weight and composition, with an optional Withings import.
- **Notes and goals** for a day or a range.

## Stack

Vite + React 19 + TypeScript, with the API as a Vite plugin
(`server/api.ts`) so one process serves both. Data lives in `.data/`
(SQLite via `node:sqlite`, Node 24+). Tests run under vitest; lint is oxlint.

## Running it

```bash
npm install
npm run dev        # http://localhost:8200, scratch database
npm run check      # typecheck + lint + tests
npm run build
npm run preview    # the persistent instance, :8210, data in .data/
```

Settings in the app hold the LM Studio address and token used for label
scanning and online lookup, and an optional USDA API key (the free
`DEMO_KEY` works but is rate-limited). Nothing is required for plain food
search and manual logging.

## Running it all the time

`npm run deploy` rebuilds and restarts a launchd job named `com.amie.cairn`
that runs `vite preview`. Create that job once with a plist that runs
`npm run preview` from this directory with `KeepAlive` on. To reach it from a
phone, put :8210 behind Tailscale Serve and open the `.ts.net` address.

## Withings (optional)

`node scripts/withings.mjs auth` signs in once and stores tokens outside the
repo in `~/.config/cairn/withings.json`; `probe` lists the measurements your
account returns. Put your Withings client id and secret in that file first.

## Layout

```
server/   api.ts (routes), store.ts (SQLite), foods.ts (USDA + Open Food Facts),
          label.ts (vision model), research.ts (online lookup), notes.ts
src/      App.tsx, components/ (trackers, sheets, the Add flow in add/), lib/
scripts/  deploy.sh, withings.mjs
```
