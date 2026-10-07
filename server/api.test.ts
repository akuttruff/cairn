import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApi } from './api.ts'
import type { DayView, Entry } from '../src/types.ts'

let server: Server
let base: string
let dir: string
let upstream: ReturnType<typeof vi.fn>

const DAY = '2026-09-26'
const BANANA = { calories: 89, protein: 1.09, fat: 0.33, carbs: 22.8, fiber: 2.6 }

beforeEach(async () => {
  vi.unstubAllGlobals()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-api-'))
  // The food databases are faked; the API is exercised over real HTTP.
  upstream = vi.fn<(url: string) => Promise<unknown>>(async (url) => ({
    ok: true,
    status: 200,
    json: async () => url.includes('nal.usda.gov/fdc/v1/food/')
      ? { foodPortions: [{ gramWeight: 118, amount: 1, modifier: 'medium' }] }
      : url.includes('nal.usda.gov')
        ? { foods: [{ fdcId: 173944, description: 'Bananas, raw', foodNutrients: [
          { nutrientId: 1008, value: 89 }, { nutrientId: 1003, value: 1.09 }] }] }
        : { hits: [] },
  }))
  const { middleware } = createApi({ dir, fetchImpl: upstream as unknown as typeof fetch })
  server = http.createServer((req, res) => middleware(req, res, () => {
    res.statusCode = 404
    res.end('not api')
  }))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()))
  fs.rmSync(dir, { recursive: true, force: true })
})

const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}

const logBanana = (grams = 118) => call('POST', '/api/entries', {
  date: DAY, meal: 'breakfast', name: 'Bananas, raw', grams, per100g: BANANA, source: 'usda',
})

describe('a day of logging', () => {
  it('logs, totals, edits and deletes', async () => {
    const created = await logBanana()
    expect(created.status).toBe(201)
    const entry = created.body as unknown as Entry

    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.totals.calories).toBe(105)

    await call('PATCH', `/api/entries/${entry.id}`, { grams: 236 })
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.totals.calories).toBe(210)

    await call('DELETE', `/api/entries/${entry.id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.entries).toEqual([])
  })

  it('lets you correct a database food\'s numbers, and keeps the fix when the weight changes', async () => {
    const entry = (await logBanana()).body as unknown as Entry
    const fixed = await call('PATCH', `/api/entries/${entry.id}`, { nutrients: { ...entry.nutrients, fiber: 4 } })
    expect((fixed.body as unknown as Entry).nutrients.fiber).toBe(4)
    const doubled = await call('PATCH', `/api/entries/${entry.id}`, { grams: 236 })
    expect((doubled.body as unknown as Entry).nutrients.fiber).toBe(8)
  })

  it('reports bad input as a 400 with the reason', async () => {
    const res = await call('POST', '/api/entries', { date: 'yesterday', meal: 'lunch' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/date/)
  })

  it('refuses a date that is really a path', async () => {
    expect((await call('GET', '/api/day/..%2F..%2Fetc')).status).toBe(400)
  })
})

describe('a week or month at a glance', () => {
  it('reports one summary per day across the range, and range-wide totals', async () => {
    await logBanana() // logged on DAY = 2026-09-26, 105 kcal
    const res = await call('GET', '/api/range?start=2026-09-25&end=2026-09-27')
    expect(res.status).toBe(200)
    const range = res.body as unknown as import('../src/types.ts').RangeView
    expect(range.days.map((d) => d.date)).toEqual(['2026-09-25', DAY, '2026-09-27'])
    expect(range.days[1]!.totals.calories).toBe(105)
    expect(range.totalDays).toBe(3)
    expect(range.loggedDays).toBe(1)
    expect(range.totals.calories).toBe(105)
  })

  it('rejects a bad or backwards range the same way a bad day does', async () => {
    expect((await call('GET', '/api/range?start=nope&end=2026-09-27')).status).toBe(400)
    expect((await call('GET', '/api/range?start=2026-09-27&end=2026-09-25')).status).toBe(400)
  })
})

describe('search', () => {
  it('proxies the food databases', async () => {
    const res = await call('GET', '/api/search?q=banana')
    expect((res.body.usda as { name: string }[])[0]!.name).toBe('Bananas, raw')
  })

  it('asks for at least two characters', async () => {
    expect((await call('GET', '/api/search?q=b')).status).toBe(400)
  })

  it('caches, sparing the USDA rate limit', async () => {
    await call('GET', '/api/search?q=banana')
    await call('GET', '/api/search?q=banana')
    expect(upstream.mock.calls.filter(([u]) => String(u).includes('nal.usda.gov'))).toHaveLength(1)
  })

  it('looks up USDA portion sizes', async () => {
    const res = await fetch(`${base}/api/portions/173944`)
    expect(await res.json()).toEqual([{ label: '1 medium', grams: 118 }])
  })
})

describe('goals address', () => {
  it('answers at /api/targets, which content blockers leave alone, and still at /api/goals', async () => {
    await call('PUT', '/api/targets', { fiber: 33 })
    expect((await call('GET', '/api/targets')).body.fiber).toBe(33)
    expect((await call('GET', '/api/goals')).body.fiber).toBe(33)
  })
})

describe('body measurements', () => {
  it('takes readings from the phone as { samples }, a bare list, or one sample', async () => {
    const one = { type: 'Weight', value: 150.2, unit: 'lb', date: '2026-09-26T07:10:00-07:00' }
    expect((await call('POST', '/api/body', { samples: [one] })).body).toEqual({ added: 1, skipped: 0 })
    expect((await call('POST', '/api/body', [one])).body).toEqual({ added: 0, skipped: 1 })
    expect((await call('POST', '/api/body', { ...one, date: '2026-09-27T07:10:00-07:00' })).body).toEqual({ added: 1, skipped: 0 })
    const day = (await call('GET', '/api/day/2026-09-27')).body as unknown as DayView
    expect(day.body.weight!.date).toBe('2026-09-27')
    expect((await call('POST', '/api/body', { samples: [{ type: 'Weight', value: 180 }] })).status).toBe(400) // no date
  })
})

describe('app icon', () => {
  it('serves whichever icon Settings picked, as the tab icon and the home-screen PNG', async () => {
    const svg = async (): Promise<string> => (await fetch(`${base}/icon.svg`)).text()
    const ring = fs.readFileSync(path.resolve('public/icons/ring.svg'), 'utf8')
    const dawn = fs.readFileSync(path.resolve('public/icons/dawn.svg'), 'utf8')
    expect(await svg()).toBe(ring)
    await call('PUT', '/api/settings', { appIcon: 'dawn' })
    expect(await svg()).toBe(dawn)
    const png = await fetch(`${base}/icon-180.png`)
    expect(png.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await png.arrayBuffer())).toEqual(fs.readFileSync(path.resolve('public/icons/dawn-180.png')))
    expect((await call('PUT', '/api/settings', { appIcon: 'unicorn' })).status).toBe(400)
  })
})

describe('foods and goals', () => {
  it('returns saved and recent foods', async () => {
    await logBanana(136)
    const res = await call('GET', '/api/foods')
    expect((res.body.recent as { name: string }[])[0]!.name).toBe('Bananas, raw')
  })

  it('updates goals', async () => {
    await call('PUT', '/api/goals', { fiber: 35 })
    expect((await call('GET', '/api/goals')).body.fiber).toBe(35)
  })

  it('treats an unmarked day as a rest day, and marks one as a training day', async () => {
    expect((await call('GET', `/api/day/${DAY}`)).body.dayType).toBe('rest')
    const res = await call('PUT', `/api/day-type/${DAY}`, { type: 'training' })
    expect(res.body).toEqual({ date: DAY, type: 'training' })
    expect((await call('GET', `/api/day/${DAY}`)).body.dayType).toBe('training')
    await call('PUT', `/api/day-type/${DAY}`, { type: 'rest' }) // unticked again
    expect((await call('GET', `/api/day/${DAY}`)).body.dayType).toBe('rest')
  })

  it('never returns the USDA key', async () => {
    await call('PUT', '/api/settings', { usdaApiKey: 'SECRETKEY', lmStudioToken: 'sk-lm-SECRET' })
    const res = await call('GET', '/api/settings')
    expect(res.body).toMatchObject({ hasUsdaKey: true, hasLmStudioToken: true })
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/)
  })
})

describe('online lookup', () => {
  const REPLY = {
    found: true, note: '',
    items: [{
      name: 'Chicken Bowl', brand: null, serving: { label: '1 bowl', grams: null },
      nutrients: { calories: 600, protein: 40, fat: 20, carbs: 60, fiber: null },
      other_servings: [], source_url: 'https://example.com/nutrition',
    }],
  }
  const lmStudio = () => {
    upstream.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [{ type: 'llm', key: 'm', loaded_instances: [{ id: 'm' }] }] }))
      }
      const enc = new TextEncoder()
      return new Response(new ReadableStream({
        start(c) {
          for (const e of [{ type: 'message.delta', content: JSON.stringify(REPLY) }, { type: 'chat.end', result: {} }]) {
            c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
          }
          c.close()
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    return () => upstream.mock.calls.filter(([u]) => String(u).endsWith('/api/v1/chat')).length
  }

  it('answers a repeat from the cache, and looks again only when asked', async () => {
    const chats = lmStudio()
    const first = await call('POST', '/api/research', { q: 'chipotle chicken bowl' })
    expect(first.status).toBe(202)
    await vi.waitFor(async () => {
      expect((await call('GET', `/api/research/${first.body.id}`)).body.status).toBe('done')
    })
    expect(chats()).toBe(1)

    // Reworded, but the same food: served from the cache.
    expect((await call('POST', '/api/research', { q: 'Bowl chicken, chipotle' })).body.status).toBe('done')
    expect(chats()).toBe(1)

    const fresh = await call('POST', '/api/research', { q: 'chipotle chicken bowl', refresh: true })
    expect(fresh.body.status).toBe('running')
    await vi.waitFor(() => expect(chats()).toBe(2))
  })
})

describe('lm models', () => {
  it('lists the LLMs LM Studio has, without the token', async () => {
    upstream.mockImplementation(async () => ({
      ok: true, status: 200,
      json: async () => ({ models: [{ type: 'llm', key: 'qwen/qwen3.8-27b', loaded_instances: [] }] }),
    }))
    await call('PUT', '/api/settings', { lmStudioToken: 'sk-lm-SECRET' })
    const res = await call('GET', '/api/lm-models')
    expect(res.body).toEqual({ models: [{ key: 'qwen/qwen3.8-27b', loaded: false }], error: null })
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/)
  })

  it('reports why the list is empty when LM Studio is unreachable', async () => {
    upstream.mockRejectedValue(new TypeError('ECONNREFUSED'))
    const res = await call('GET', '/api/lm-models')
    expect(res.status).toBe(200)
    expect(res.body.models).toEqual([])
    expect(res.body.error).toMatch(/Couldn't reach LM Studio/)
  })
})

describe('alcohol', () => {
  it('logs and undoes a drink over one round trip', async () => {
    const logged = await call('POST', '/api/alcohol', { date: DAY, kind: 'wine' })
    expect(logged.status).toBe(201)
    const id = (logged.body as unknown as { id: string }).id
    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.alcohol).toEqual({ drinks: 1, byKind: { beer: 0, wine: 1, liquor: 0 }, calories: 125, weekTotal: 1, weekByKind: { beer: 0, wine: 1, liquor: 0 }, weekGoal: 7, lastLogId: id })
    await call('DELETE', `/api/alcohol/${id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.alcohol.drinks).toBe(0)
  })

  it('rejects a kind it does not know', async () => {
    expect((await call('POST', '/api/alcohol', { date: DAY, kind: 'mead' })).status).toBe(400)
  })
})

describe('water', () => {
  it('logs, totals and undoes over one round trip', async () => {
    const logged = await call('POST', '/api/water', { date: DAY, ounces: 32 })
    expect(logged.status).toBe(201)
    const id = (logged.body as unknown as { id: string }).id

    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.water).toEqual({ ounces: 32, goal: 96, lastLogId: id })

    await call('DELETE', `/api/water/${id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.water).toEqual({ ounces: 0, goal: 96, lastLogId: null })
  })

  it('rejects a nonsense amount', async () => {
    const res = await call('POST', '/api/water', { date: DAY, ounces: -5 })
    expect(res.status).toBe(400)
  })
})

describe('workouts and meditation', () => {
  it('logs a workout, ticks the training day, and removes it over one round trip', async () => {
    const logged = await call('POST', '/api/workouts', { date: DAY, kind: 'wod', minutes: 45 })
    expect(logged.status).toBe(201)
    const id = (logged.body as unknown as { id: string }).id
    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.dayType).toBe('training')
    expect(day.workouts).toMatchObject({ minutes: 45, weekTotal: 1, lastLogId: id })
    await call('DELETE', `/api/workouts/${id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.workouts.sessions).toEqual([])
    expect((await call('POST', '/api/workouts', { date: DAY, kind: 'jousting' })).status).toBe(400)
  })

  it("sets one week's own workout plan, and puts it back on the default", async () => {
    const week = '2026-09-20' // a Sunday
    const set = await call('PUT', `/api/workout-plan/${week}`, { plan: { yoga: 5 } })
    expect(set.status).toBe(200)
    let day = (await call('GET', `/api/day/${week}`)).body as unknown as DayView
    expect(day.workouts).toMatchObject({ planIsCustom: true, weekGoal: 5 })
    await call('DELETE', `/api/workout-plan/${week}`)
    day = (await call('GET', `/api/day/${week}`)).body as unknown as DayView
    expect(day.workouts).toMatchObject({ planIsCustom: false, weekGoal: 9 })
    expect((await call('PUT', `/api/workout-plan/2026-09-22`, { plan: { yoga: 1 } })).status).toBe(400)
  })

  it('logs meditation toward the daily goal, and undoes it', async () => {
    const logged = await call('POST', '/api/meditation', { date: DAY, minutes: 10 })
    expect(logged.status).toBe(201)
    const id = (logged.body as unknown as { id: string }).id
    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.meditation).toMatchObject({ minutes: 10, goal: 50, lastLogId: id })
    await call('DELETE', `/api/meditation/${id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.meditation.minutes).toBe(0)
    expect((await call('POST', '/api/meditation', { date: DAY })).status).toBe(400)
  })
})

describe('meal presets', () => {
  const eggs = { name: 'Eggs', per100g: BANANA, grams: 100, source: 'usda' }

  it('creates, lists, applies and deletes a meal', async () => {
    const created = await call('POST', '/api/meals', { name: 'Breakfast', items: [eggs] })
    expect(created.status).toBe(201)
    const id = created.body.id as string

    expect(((await call('GET', '/api/meals')).body as unknown as { name: string }[])[0]!.name).toBe('Breakfast')

    const applied = await call('POST', `/api/meals/${id}/apply`, { date: DAY, meal: 'breakfast' })
    expect(applied.status).toBe(201)
    expect((applied.body as unknown as Entry[])).toHaveLength(1)
    const day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.entries[0]!.name).toBe('Eggs')

    await call('DELETE', `/api/meals/${id}`)
    expect((await call('GET', '/api/meals')).body as unknown as unknown[]).toEqual([])
  })

  it('reports a meal with no foods as a 400', async () => {
    const res = await call('POST', '/api/meals', { name: 'Empty', items: [] })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/at least one food/)
  })

  it('reports applying a missing meal as a 400', async () => {
    const res = await call('POST', '/api/meals/meal%3Amissing/apply', { date: DAY, meal: 'breakfast' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/no such meal/)
  })
})

describe('cross-origin protection', () => {
  it('refuses a write from another site', async () => {
    const res = await call('POST', '/api/entries', {}, { Origin: 'https://evil.example' })
    expect(res.status).toBe(403)
  })

  it('allows a write from its own page', async () => {
    const host = new URL(base).host
    const res = await call('POST', '/api/entries', {
      date: DAY, meal: 'lunch', name: 'x', grams: null, source: 'custom',
      nutrients: { calories: 100, protein: null, fat: null, carbs: null, fiber: null },
    }, { Origin: `http://${host}` })
    expect(res.status).toBe(201)
  })

  it('allows reads from anywhere', async () => {
    const res = await call('GET', `/api/day/${DAY}`, undefined, { Origin: 'https://evil.example' })
    expect(res.status).toBe(200)
  })
})

describe('routing', () => {
  it('leaves the app itself alone', async () => {
    const res = await fetch(`${base}/index.html`)
    expect(await res.text()).toBe('not api')
  })

  it('404s an unknown endpoint', async () => {
    expect((await call('GET', '/api/nope')).status).toBe(404)
  })
})
