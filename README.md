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

## Local models

Three things in Cairn use a model, all through [LM Studio](https://lmstudio.ai)
on this machine (its `/api/v1/chat` endpoint, so LM Studio 0.4 or newer).
Nothing leaves your network, and none of it is needed for logging by hand.

1. **Start LM Studio's server** in its **Developer** tab. The default
   address, `http://127.0.0.1:1234`, is what Settings starts with. If
   **Require Authentication** is on, create a token under **Manage Tokens**
   and paste it into Settings; it stays on the server. Authentication is
   required for the online lookup, which uses an MCP tool.
2. **Online lookup** (the *Model* field in Settings) runs a chat model with
   the `deep-research` MCP server enabled, so it can read a restaurant's or
   brand's own nutrition page. Install
   [minimal-mcp-deep-research](https://github.com/akuttruff/minimal-mcp-deep-research),
   add it to `~/.lmstudio/mcp.json` as `deep-research` (Cairn asks LM
   Studio for the plugin `mcp/deep-research`), and enable **Allow calling
   servers from mcp.json** in LM Studio's Developer settings. A model with
   good tool calling matters more than size here; `qwen/qwen3.8-27b` is what
   this is tested with.
3. **Label scanning** (the *Label model* field) needs a model that can see
   images; Settings lists only those. A photo or screenshot of a nutrition
   label is downscaled and sent as the only input, and the numbers come back
   into the Manual tab for you to check. Cold, a vision model takes a while
   to load; warm, a label reads in seconds.
4. **Week and month notes** (the *Notes model* field) are two or three
   short paragraphs on a period, written from your own numbers against your
   goals. A small model does this well (`qwen/qwen3.5-9b`, say); leave the
   field blank to use the lookup model.

Every lookup and scan produces candidates for you to confirm; nothing a
model read or saw is logged on its own.

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
