# Cairn

A daily log that runs on your own machine: what you ate, drank and did,
with the numbers worked out for you. It is a web app you add to your
phone's home screen, served from a desktop over your own network and backed
by one SQLite file. No accounts, no cloud.

## What it looks like

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/day-phone.png" alt="The day view" /></td>
    <td width="50%"><img src="docs/screenshots/meals-phone.png" alt="The meals of a day" /></td>
  </tr>
  <tr>
    <td><b>A day.</b> Calories and macros against the day's goals, then water, alcohol, workouts and the rest, each a card.</td>
    <td><b>Meals.</b> Every food logged, with its macros, grouped by meal. Tap one to edit it.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/add-phone.png" alt="The Add sheet" /></td>
    <td><img src="docs/screenshots/week-phone.png" alt="The week view" /></td>
  </tr>
  <tr>
    <td><b>Adding food.</b> Your saved foods for one tap, a search of the USDA and Open Food Facts databases, or type it in.</td>
    <td><b>A week.</b> Each day against its own goal, since training days get more carbs and water, with notes written by a local model.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/month-phone.png" alt="The month view" /></td>
    <td><img src="docs/screenshots/settings-phone.png" alt="Settings" /></td>
  </tr>
  <tr>
    <td><b>A month.</b> The same numbers as a line; tap a day to see it, tap again to open it.</td>
    <td><b>Goals.</b> Protein, fat, carbs and fiber per day, what a training day adds, water, and the weekly alcohol cap.</td>
  </tr>
</table>

<img src="docs/screenshots/desktop.png" alt="The week view on a desktop" />

**On a desktop.** The week view, with room for every chart.

The screenshots use demo data. To regenerate them:

```bash
npm run seed:demo && npm run dev   # one terminal
npm run screenshots                # another; needs Google Chrome
```

## What it tracks

- **Meals and macros.** Calories, protein, carbs, fat and fiber per entry, with daily targets and a day, week and month view.
- **Food lookup**, three ways. Search the USDA FoodData Central and Open Food Facts databases. Scan a nutrition label from a photo, which a local vision model reads. Or ask for an online lookup, where a local model with a web-research tool reads the restaurant's or brand's own page.
- **My foods.** Anything you have typed or confirmed, for one-tap logging. Saved meals log several at once.
- **Water, alcohol, workouts, dog walks and meditation**, each its own tracker.
- **Notes.** Two or three short paragraphs on a week or a month, written from your own numbers against your goals.

Every lookup and scan produces candidates for you to check. Nothing a model
read or saw is logged on its own.

## Before you start

Cairn is a Node server that you run on one computer, the one that keeps the
data, and open from any browser on your network. Logging by hand needs only
the first item below. Each model feature needs a model served on the same
computer; without one, those buttons just report that no model is set.

| You want to | You need |
|---|---|
| Log food, water, workouts and the rest by hand | Node 24 or newer |
| Search the USDA and Open Food Facts databases | Internet access; optionally a free [USDA API key](https://fdc.nal.usda.gov/api-key-signup) (the built-in `DEMO_KEY` is rate limited) |
| Scan a nutrition label from a photo | LM Studio serving a model that can see images (LM Studio marks these with a vision badge) |
| Look a restaurant or brand item up online | LM Studio serving a chat model that calls tools well, plus the `deep-research` MCP server (below) |
| Week and month notes | LM Studio serving any chat model; a small one such as `qwen/qwen3.5-9b` is enough |
| Open it on your phone | The phone on the same Wi-Fi, or [Tailscale](https://tailscale.com) on both devices (see *Keeping it running*) |

**Node.** Cairn stores its data with `node:sqlite`, which arrived in Node
24. Check with `node --version`.

**Serving a model.** Every model feature talks to
[LM Studio](https://lmstudio.ai) on the same computer, through its
`/api/v1/chat` endpoint, which needs LM Studio 0.4 or newer. Nothing leaves
your network.

1. Install LM Studio and download the models you want (the Discover tab).
2. In the **Developer** tab, start the server. Its default address,
   `http://127.0.0.1:1234`, is what Cairn's Settings start with.
3. If **Require Authentication** is on, create a token under **Manage
   Tokens** and paste it into Cairn's Settings. It is kept on the server and
   never sent to the browser. Authentication is required for the online
   lookup, which uses an MCP tool.
4. Load a model, or let LM Studio load it on the first request. In Cairn's
   Settings, pick the model for each feature: *Model* for the online lookup,
   *Label model* for scanning (only models that can see images are listed),
   and *Notes model* for the notes, which falls back to the lookup model
   when blank.

**The online lookup's tool.** Install
[minimal-mcp-deep-research](https://github.com/akuttruff/minimal-mcp-deep-research),
add it to `~/.lmstudio/mcp.json` under the name `deep-research`, and enable
**Allow calling servers from mcp.json** in LM Studio's Developer settings.
Good tool calling matters more than size here. `qwen/qwen3.8-27b` is what
this is tested with.

## Run

```bash
npm install
npm run dev          # http://localhost:8200, scratch database in .data-dev/
npm run check        # typecheck + lint + tests
npm run build
npm run preview      # the persistent instance on :8210, data in .data/
npm run seed:demo    # fill the dev database with two weeks of demo data
npm run screenshots  # regenerate docs/screenshots/ from the dev server
```

On your phone, open the **Network** address that Vite prints (for example
`http://192.168.1.50:8200/`) and add it to the home screen.

### Keeping it running

`npm run deploy` rebuilds and restarts a launchd job named
`com.amie.cairn` that runs `vite preview`. Create that job once with a plist
that runs `npm run preview` from this directory with `KeepAlive` on. To
reach it from anywhere, put :8210 behind Tailscale Serve and open the
`.ts.net` address:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=443 http://127.0.0.1:8210
```

The app is served from the browser's cache on every launch, so it opens at
once on the phone even before the tunnel is up, and says so if the server
cannot be reached.

## Stack and layout

Vite + React 19 + TypeScript, with the API as a Vite plugin so one process
serves both. Data lives in `.data/` as SQLite (`node:sqlite`, Node 24+).
Tests run under vitest; lint is oxlint.

```
server/   api.ts (routes), store.ts (SQLite), foods.ts (USDA + Open Food Facts),
          label.ts (vision model), research.ts (online lookup), notes.ts
src/      App.tsx, components/ (trackers, sheets, the Add flow in add/), lib/
public/   sw.js, the app shell cache
scripts/  deploy.sh, seed-demo.ts, screenshots.mjs
docs/     screenshots/ for this README
```
