// Screenshots of the app for the README, taken with headless Chrome over its
// DevTools protocol (a raw WebSocket; no npm dependency). Run the dev server
// on the demo database first:
//
//   npm run seed:demo && npm run dev        (in one terminal)
//   npm run screenshots [scenario]          (in another; writes docs/screenshots/*.png)
//
// Needs Google Chrome at the usual macOS path, or CHROME=/path/to/chrome.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeRecording, glide, startRecording, typeInto, waitUntil } from './recording.mjs'

const URL = process.env.CAIRN_URL ?? 'http://127.0.0.1:8200'
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = 'docs/screenshots'
const PORT = Number(process.env.CHROME_PORT ?? 9334)

const PHONE = { width: 430, height: 932, scale: 2, mobile: true }
const DESKTOP = { width: 1280, height: 840, scale: 2, mobile: false }

/**
 * Each scenario is a list of steps against a fresh browser profile:
 *  click <text>          the innermost element whose text contains it, or its enclosing button
 *  sel <css>             click the first element matching the selector
 *  aria <label>          click the element with that aria-label
 *  wait <ms>             pause (animations, lazy chunks)
 *  scroll <css> <px>     scroll an element, or the window when the selector matches nothing
 *  glide <css> <px> <ms> scroll it smoothly, for a recording
 *  type <css> <text>     type into a field a few characters at a time
 *  until <js> <ms>       wait until the expression is true in the page
 */
/** The Add sheet's search box; a match among your own foods; the sheet gone again once it is logged. */
const SEARCH = '[aria-label="Search foods"]'
const FOUND = `!!document.querySelector('[aria-label="Yours"] .food-row')`
const CLOSED = `!document.querySelector('.drawer-actions')`

const scenarios = [
  { name: 'day-phone', view: PHONE, steps: [] },
  { name: 'meals-phone', view: PHONE, steps: [['scroll', '.scroll', 1400]] },
  { name: 'week-phone', view: PHONE, steps: [['click', 'Week'], ['wait', 800], ['aria', 'Previous week'], ['wait', 1500]] },
  { name: 'month-phone', view: PHONE, steps: [['click', 'Month'], ['wait', 1200]] },
  { name: 'add-phone', view: PHONE, steps: [['aria', 'Add food'], ['wait', 1000]] },
  { name: 'settings-phone', view: PHONE, steps: [['aria', 'Settings'], ['wait', 900]] },
  { name: 'desktop', view: DESKTOP, steps: [['click', 'Week'], ['wait', 800], ['aria', 'Previous week'], ['wait', 1500]] },
  { name: 'desktop-day', view: DESKTOP, steps: [['wait', 800]] },
  // Walkthroughs, recorded (see recording.mjs): the phone's and the desktop's.
  // A food searched for, picked and logged, then the day with it in; then the week and the month.
  { name: 'demo-phone', view: PHONE, record: true, steps: [['wait', 900], ['aria', 'Add food'], ['wait', 900], ['click', 'Search'], ['wait', 600], ['type', SEARCH, 'blueberries'], ['until', FOUND, 10000], ['wait', 900], ['sel', '[aria-label="Yours"] .food-row'], ['wait', 1300], ['sel', '.drawer-actions .primary'], ['until', CLOSED, 5000], ['wait', 700], ['glide', '.scroll', 99999, 1600], ['wait', 1400], ['click', 'Week'], ['wait', 1600], ['click', 'Month'], ['wait', 1800]] },
  { name: 'demo-desktop', view: DESKTOP, record: true, steps: [['wait', 900], ['aria', 'Add food'], ['wait', 900], ['click', 'Search'], ['wait', 600], ['type', SEARCH, 'blueberries'], ['until', FOUND, 10000], ['wait', 900], ['sel', '[aria-label="Yours"] .food-row'], ['wait', 1300], ['sel', '.drawer-actions .primary'], ['until', CLOSED, 5000], ['wait', 700], ['glide', '.scroll', 99999, 1600], ['wait', 1400], ['click', 'Week'], ['wait', 1600], ['click', 'Month'], ['wait', 1800]] },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function withChrome(view, fn) {
  // A fresh profile per scenario, so nothing carries over.
  const profile = mkdtempSync(join(tmpdir(), 'cairn-shots-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', `--window-size=${view.width},${view.height}`, '--hide-scrollbars', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
  const exited = new Promise((r) => chrome.on('exit', r))
  try {
    let targets = []
    for (let i = 0; i < 40 && targets.length === 0; i++) {
      await sleep(250)
      try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json() } catch { /* not up yet */ }
    }
    const page = targets.find((t) => t.type === 'page')
    if (!page) throw new Error('Chrome did not expose a page target')
    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = new Map()
    const listeners = new Map()
    const on = (method, fn) => listeners.set(method, fn)
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } else if (m.method && listeners.has(m.method)) listeners.get(m.method)(m.params) }
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: view.width, height: view.height, deviceScaleFactor: view.scale, mobile: view.mobile })
    await fn({ send, evaluate, on })
    ws.close()
  } finally {
    chrome.kill()
    await exited
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}

const clickText = (text, sel = 'button, div, span, h2, h3, h4, b, strong, em, p, li, a, summary') =>
  `(() => { const t = ${JSON.stringify(text)}; const all = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.textContent.includes(t)); const el = all.find((e) => !all.some((o) => o !== e && e.contains(o))); if (!el) return 'missing ' + t; (el.closest('button, a, summary, li') ?? el).click(); return 'clicked' })()`

async function run(scenario) {
  await withChrome(scenario.view, async ({ send, evaluate, on }) => {
    await send('Page.navigate', { url: URL + (scenario.path ?? '') })
    await sleep(2500)
    const recording = scenario.record ? startRecording({ send, on }) : null
    for (const [op, a, b, c] of scenario.steps) {
      let result = ''
      if (op === 'click') result = await evaluate(clickText(a))
      else if (op === 'glide') result = await glide(evaluate, a, b, c)
      else if (op === 'type') result = await typeInto(send, evaluate, a, b, 70)
      else if (op === 'until') { result = await waitUntil(evaluate, a, b); if (result === 'timeout') throw new Error(`${scenario.name}: gave up waiting for ${a}`) }
      else if (op === 'sel') result = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(a)}); if (!el) return 'missing ' + ${JSON.stringify(a)}; el.click(); return 'clicked' })()`)
      else if (op === 'aria') result = await evaluate(`(() => { const el = document.querySelector('[aria-label=' + ${JSON.stringify(JSON.stringify(a))} + ']'); if (!el) return 'missing ' + ${JSON.stringify(a)}; el.click(); return 'clicked' })()`)
      else if (op === 'wait') { await sleep(a); continue }
      else if (op === 'scroll') result = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(a)}); if (el && el.scrollHeight > el.clientHeight) { el.scrollTop = ${b}; return 'scrolled' } window.scrollTo(0, ${b}); return 'scrolled window' })()`)
      if (String(result).startsWith('missing')) throw new Error(`${scenario.name}: ${result}`)
      await sleep(700)
    }
    if (recording) {
      const frames = await recording.stop()
      const made = encodeRecording(frames, { out: OUT, name: scenario.name, wide: !scenario.view.mobile, speed: scenario.speed ?? 1 })
      console.log(`wrote ${made.gif} and ${made.mp4} (${made.seconds} s, ${made.frames} frames)`)
      return
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(`${OUT}/${scenario.name}.png`, Buffer.from(shot.result.data, 'base64'))
    console.log(`wrote ${OUT}/${scenario.name}.png`)
  })
}

mkdirSync(OUT, { recursive: true })
const only = process.argv[2]
for (const s of scenarios) {
  if (only && s.name !== only) continue
  await run(s)
}
