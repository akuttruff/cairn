#!/usr/bin/env node
// Withings API access for Cairn: a one-time sign-in, then reading your measurements.
//
//   node scripts/withings.mjs auth    sign in to Withings in the browser, once; saves tokens
//   node scripts/withings.mjs probe   list which measurements your account returns, with recent values
//
// Credentials and tokens live OUTSIDE the repo, in ~/.config/cairn/withings.json (mode 600):
//   { "client_id": "...", "client_secret": "...", "redirect_uri": "http://localhost:8765/callback" }
// The auth step adds access_token, refresh_token, expires_at and userid to the same file.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'

const FILE = path.join(os.homedir(), '.config', 'cairn', 'withings.json')
const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2'
const MEASURE_URL = 'https://wbsapi.withings.net/measure'

// Measurement types, as Withings numbers them (Measure - Getmeas). Anything not listed prints by number.
const MEASTYPES = {
  1: 'Weight (kg)', 4: 'Height (m)', 5: 'Fat-free mass (kg)', 6: 'Fat ratio (%)', 8: 'Fat mass (kg)',
  11: 'Heart rate (bpm)', 76: 'Muscle mass (kg)', 77: 'Hydration (kg)', 88: 'Bone mass (kg)',
  91: 'Pulse wave velocity (m/s)', 155: 'Vascular age', 167: 'Nerve health score', 168: 'Extracellular water (kg)',
  169: 'Intracellular water (kg)', 170: 'Visceral fat (index)', 173: 'Fat-free mass, by segment (kg)',
  174: 'Fat mass, by segment (kg)', 175: 'Muscle mass, by segment (kg)', 196: 'Electrodermal activity (feet)',
  226: 'Basal metabolic rate (kcal)', 227: 'Metabolic age', 229: 'Electrochemical skin conductance',
}

function readConfig() {
  if (!fs.existsSync(FILE)) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 })
    fs.writeFileSync(FILE, JSON.stringify({ client_id: '', client_secret: '', redirect_uri: 'http://localhost:8765/callback' }, null, 2) + '\n', { mode: 0o600 })
    console.log(`Created ${FILE} -- fill in client_id and client_secret from your Withings developer app, then run this again.`)
    process.exit(1)
  }
  const cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (!cfg.client_id || !cfg.client_secret) {
    console.log(`${FILE} still needs client_id and client_secret from your Withings developer app.`)
    process.exit(1)
  }
  return cfg
}

function saveConfig(cfg) {
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(FILE, 0o600)
}

async function tokenRequest(cfg, params) {
  const body = new URLSearchParams({ action: 'requesttoken', client_id: cfg.client_id, client_secret: cfg.client_secret, ...params })
  const res = await fetch(TOKEN_URL, { method: 'POST', body })
  const data = await res.json()
  if (data.status !== 0) throw new Error(`Withings refused the token request (status ${data.status}${data.error ? `: ${data.error}` : ''})`)
  const b = data.body
  Object.assign(cfg, {
    access_token: b.access_token, refresh_token: b.refresh_token, userid: b.userid,
    expires_at: Date.now() + (b.expires_in - 60) * 1000,
  })
  saveConfig(cfg)
  return cfg
}

/** A valid access token, refreshing it when it has expired (they last about 3 hours; the refresh token keeps going). */
async function accessToken(cfg) {
  if (!cfg.refresh_token) throw new Error('Not signed in yet: run `node scripts/withings.mjs auth` first.')
  if (cfg.access_token && Date.now() < cfg.expires_at) return cfg.access_token
  await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: cfg.refresh_token })
  return cfg.access_token
}

async function auth() {
  const cfg = readConfig()
  const redirect = new URL(cfg.redirect_uri)
  const state = crypto.randomBytes(16).toString('hex')
  const url = new URL('https://account.withings.com/oauth2_user/authorize2')
  url.search = new URLSearchParams({
    response_type: 'code', client_id: cfg.client_id, scope: 'user.metrics', redirect_uri: cfg.redirect_uri, state,
  }).toString()

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const got = new URL(req.url, cfg.redirect_uri)
      if (got.pathname !== redirect.pathname) { res.writeHead(404); res.end(); return }
      const ok = got.searchParams.get('state') === state && got.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(ok ? 'Signed in to Withings. You can close this tab and go back to the terminal.' : 'Sign-in failed or was cancelled.')
      server.close()
      if (ok) resolve(got.searchParams.get('code'))
      else reject(new Error(got.searchParams.get('error') || 'no code returned'))
    })
    server.listen(Number(redirect.port || 80), redirect.hostname === 'localhost' ? '127.0.0.1' : redirect.hostname, () => {
      console.log('Opening Withings in your browser to sign in and allow access...')
      console.log(`(If it doesn't open, paste this into a browser:\n${url}\n)`)
      execFile('open', [url.toString()])
    })
    setTimeout(() => { server.close(); reject(new Error('timed out after 5 minutes waiting for the sign-in')) }, 300_000).unref()
  })

  await tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: cfg.redirect_uri })
  console.log(`Signed in (Withings user ${cfg.userid}). Tokens saved to ${FILE}. Next: node scripts/withings.mjs probe`)
}

async function probe() {
  const cfg = readConfig()
  const token = await accessToken(cfg)
  const since = Math.floor(Date.now() / 1000) - 90 * 86400 // the last 90 days
  const res = await fetch(MEASURE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new URLSearchParams({ action: 'getmeas', startdate: String(since), enddate: String(Math.floor(Date.now() / 1000)) }),
  })
  const data = await res.json()
  if (data.status !== 0) throw new Error(`Withings refused the measurement request (status ${data.status}${data.error ? `: ${data.error}` : ''})`)
  const groups = data.body.measuregrps ?? []
  console.log(`${groups.length} weigh-ins/measurements in the last 90 days.\n`)

  // Per type: how often it appears, and its latest value(s).
  const byType = new Map()
  for (const g of groups) {
    for (const m of g.measures) {
      const entry = byType.get(m.type) ?? { count: 0, latest: null, latestAt: 0, segments: new Map() }
      entry.count++
      const value = m.value * 10 ** m.unit
      if (g.date >= entry.latestAt) { entry.latest = value; entry.latestAt = g.date }
      if (m.position != null) entry.segments.set(m.position, value)
      byType.set(m.type, entry)
    }
  }
  if (!byType.size) { console.log('No measurements came back. Weigh in once, let the scale sync, and try again.'); return }
  for (const [type, e] of [...byType].sort((a, b) => a[0] - b[0])) {
    const when = new Date(e.latestAt * 1000).toLocaleDateString()
    const name = MEASTYPES[type] ?? `Type ${type} (unrecognised)`
    const segs = e.segments.size ? `  segments: ${[...e.segments].map(([p, v]) => `#${p}=${Math.round(v * 10) / 10}`).join(', ')}` : ''
    console.log(`${name.padEnd(36)} latest ${String(Math.round(e.latest * 100) / 100).padStart(8)}  (${when}, ${e.count}x)${segs}`)
  }
}

const cmd = process.argv[2]
const run = cmd === 'auth' ? auth : cmd === 'probe' ? probe : null
if (!run) { console.log('Usage: node scripts/withings.mjs auth | probe'); process.exit(1) }
run().catch((err) => { console.error(`Error: ${err.message}`); process.exit(1) })
