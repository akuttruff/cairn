import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import http from 'node:http'
import type { Server } from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import api, { createApi, readBody } from './api.ts'
import type { DayView, Entry, GenerateStatus, SchemaSummary, TrainingDay } from '../src/types.ts'
import { SAMPLE_EQUIPMENT, SAMPLE_SCHEMA } from '../src/lib/training/sample.ts'

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
  await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections() })
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

  it('has no day types any more: the route is gone and a day carries none', async () => {
    expect((await call('GET', `/api/day/${DAY}`)).body).not.toHaveProperty('dayType')
    expect((await call('PUT', `/api/day-type/${DAY}`, { type: 'training' })).status).toBe(404)
  })

  it('never returns the USDA key', async () => {
    await call('PUT', '/api/settings', { usdaApiKey: 'SECRETKEY', lmStudioToken: 'sk-lm-SECRET' })
    const res = await call('GET', '/api/settings')
    expect(res.body).toMatchObject({ hasUsdaKey: true, hasLmStudioToken: true })
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/)
  })

  it('saves and returns the "use when loaded" model', async () => {
    expect((await call('PUT', '/api/settings', { preferredModel: 'big/always' })).body.preferredModel).toBe('big/always')
    expect((await call('GET', '/api/settings')).body.preferredModel).toBe('big/always')
    await call('PUT', '/api/settings', { preferredModel: '' })
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

describe('reading a label', () => {
  const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  const READING = { name: null, brand: 'Kodiak', serving: { label: '1/2 cup (53g)', grams: 53 }, nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: 3 }, note: null }
  const vision = (reply: unknown) => {
    upstream.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [{ type: 'llm', key: 'eyes', loaded_instances: [{ id: 'eyes' }], capabilities: { vision: true } }] }))
      }
      const enc = new TextEncoder()
      return new Response(new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'message.delta', content: JSON.stringify(reply) })}\n\n`))
          c.close()
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
  }

  it('hands the picture to a vision model and returns what it read', async () => {
    vision(READING)
    const res = await call('POST', '/api/label', { image: JPEG })
    expect(res.status).toBe(200)
    expect(res.body.reading).toEqual({ ...READING, note: undefined, model: 'eyes' })
    const chat = upstream.mock.calls.find(([u]) => String(u).endsWith('/api/v1/chat'))!
    expect(JSON.parse(String((chat[1] as RequestInit).body)).input).toEqual([{ type: 'text', content: 'Read this nutrition label.' }, { type: 'image', data_url: JPEG }])
  })

  it('refuses anything but an image, and says when the model could not read one', async () => {
    expect((await call('POST', '/api/label', { image: 'https://example.com/x.jpg' })).status).toBe(400)
    expect((await call('POST', '/api/label', {})).status).toBe(400)
    vision({ nutrients: {}, note: 'a cat' })
    const res = await call('POST', '/api/label', { image: JPEG })
    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/a cat/)
  })

  it('reads one label at a time, and stops the model when the phone gives up', async () => {
    let chatSignal: AbortSignal | undefined
    upstream.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [{ type: 'llm', key: 'eyes', loaded_instances: [{ id: 'eyes' }], capabilities: { vision: true } }] }))
      }
      chatSignal = init?.signal ?? undefined
      return new Promise<Response>((_, reject) => chatSignal?.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    const phone = new AbortController()
    const first = fetch(`${base}/api/label`, { method: 'POST', body: JSON.stringify({ image: JPEG }), signal: phone.signal }).catch(() => null)
    await vi.waitFor(() => expect(chatSignal).toBeDefined())
    expect((await call('POST', '/api/label', { image: JPEG })).status).toBe(409)
    phone.abort()
    await first
    await vi.waitFor(() => expect(chatSignal!.aborted).toBe(true))
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
    expect(res.body).toEqual({ models: [{ key: 'qwen/qwen3.8-27b', loaded: false, vision: false }], error: null })
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
    expect(day.water).toEqual({ ounces: 32, goal: 72, tea: 0, lastLogId: id })

    await call('DELETE', `/api/water/${id}`)
    day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.water).toEqual({ ounces: 0, goal: 72, tea: 0, lastLogId: null })
  })

  it('logs a mug of tea toward the same total', async () => {
    await call('POST', '/api/water', { date: DAY, ounces: 32 })
    expect((await call('POST', '/api/water', { date: DAY, ounces: 8, drink: 'tea' })).status).toBe(201)
    const day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
    expect(day.water).toMatchObject({ ounces: 40, tea: 8 })
    expect((await call('POST', '/api/water', { date: DAY, ounces: 8, drink: 'soda' })).status).toBe(400)
  })

  it('rejects a nonsense amount', async () => {
    const res = await call('POST', '/api/water', { date: DAY, ounces: -5 })
    expect(res.status).toBe(400)
  })
})

describe('training', () => {
  const MON = '2026-11-02'

  it('imports a schema, lays out a day, logs a set and sets a PR', async () => {
    await call('PUT', '/api/settings', { equipment: SAMPLE_EQUIPMENT })
    const imported = await call('POST', '/api/training/schemas', { schema: SAMPLE_SCHEMA })
    expect(imported.status).toBe(201)
    const id = (imported.body as unknown as SchemaSummary).id
    expect((await call('PUT', '/api/training/lifts/squat', { pr: 100 })).body).toMatchObject({ id: 'squat', pr: 100 })

    const day = (await call('GET', `/api/training?date=${MON}`)).body as unknown as TrainingDay
    expect(day).toMatchObject({ week: 1, schema: { id, name: 'Sample block' } })
    expect(day.sessions[0]!.items[0]!.sets![0]!.weight).toBe(70)

    const logged = await call('PUT', '/api/training/sets', { date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70, done: true })
    expect(logged.status).toBe(200)
    expect(((await call('GET', `/api/day/${MON}`)).body as unknown as DayView).workouts.sessions).toHaveLength(1)

    expect((await call('GET', `/api/training/schemas/${id}`)).body).toMatchObject({ lifts: [{ itemId: 'back-squat' }, { itemId: 'strict-press' }] })
    expect((await call('POST', '/api/training/repeat-week', { date: MON })).body).toMatchObject({ week: 1 })
    expect((await call('GET', '/api/training/progress')).body).toMatchObject({ lifts: [{ id: 'squat', points: [{ weight: 70 }] }, { id: 'press' }] })
    expect((await call('DELETE', `/api/training/schemas/${id}`)).status).toBe(400) // the active one
  })

  it('refuses a broken schema, with its problems', async () => {
    const res = await call('POST', '/api/training/schemas', { schema: { schemaVersion: 1, name: 'x' } })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/startDate: must be a Monday/)
  })

  it('talks with the coach, and acts on its proposals', async () => {
    await call('PUT', '/api/settings', { equipment: SAMPLE_EQUIPMENT })
    expect((await call('GET', '/api/training/chat')).body).toEqual({ messages: [], busy: false, status: null })
    await call('POST', '/api/training/schemas', { schema: SAMPLE_SCHEMA })
    expect((await call('POST', '/api/training/chat', { message: '  ' })).status).toBe(400)
    // Answered in the background: the question is there at once, and the page polls for the rest.
    const res = await call('POST', '/api/training/chat', { message: 'How am I doing?', today: '2026-11-02' })
    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ busy: true, messages: [{ role: 'user', text: 'How am I doing?' }] })
    // The fake upstream isn't LM Studio: the coach can't answer, and says why.
    await vi.waitFor(async () => {
      const r = (await call('GET', '/api/training/chat')).body as { busy: boolean; messages: { role: string; text: string; note: string | null }[] }
      expect(r.busy).toBe(false)
      expect(r.messages.map((m) => [m.role, m.text])).toEqual([['user', 'How am I doing?'], ['assistant', 'The coach couldn\'t answer that time.']])
      expect(r.messages[1]!.note).toBeTruthy()
    })
    expect((await call('POST', '/api/training/chat/nope/apply', { today: '2026-11-02' })).status).toBe(400)
    // A screenshot alone is a message too; anything that isn't a picture is refused.
    expect((await call('POST', '/api/training/chat', { image: 'data:text/html;base64,PGh0bWw+' })).status).toBe(400)
    await vi.waitFor(async () => expect(((await call('GET', '/api/training/chat')).body as { busy: boolean }).busy).toBe(false))
    const png = 'iVBORw0KGgo='
    expect((await call('POST', '/api/training/chat', { image: `data:image/png;base64,${png}` })).status).toBe(202)
    const withShot = ((await call('GET', '/api/training/chat')).body as { messages: { id: string; image: boolean; text: string }[] }).messages.find((x) => x.image)!
    expect(withShot.text).toBe('What do you make of this?')
    const pic = await fetch(`${base}/api/training/chat/${withShot.id}/image`)
    expect(pic.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await pic.arrayBuffer()).toString('base64')).toBe(png)
    expect((await fetch(`${base}/api/training/chat/nope/image`)).status).toBe(404)
    await vi.waitFor(async () => expect(((await call('GET', '/api/training/chat')).body as { busy: boolean }).busy).toBe(false))
    expect((await call('DELETE', '/api/training/chat')).body).toEqual({ messages: [] })
    expect((await call('DELETE', '/api/training/overrides/nope')).status).toBe(400)
  })

  it('writes the next schema in the background and reports how it went', async () => {
    expect((await call('POST', '/api/training/generate', {})).status).toBe(400) // nothing to build on
    await call('PUT', '/api/settings', { equipment: SAMPLE_EQUIPMENT })
    await call('POST', '/api/training/schemas', { schema: SAMPLE_SCHEMA })
    const started = await call('POST', '/api/training/generate', { note: 'more pressing' })
    expect(started.status).toBe(202)
    expect(started.body).toMatchObject({ status: 'running' })
    // The fake upstream isn't LM Studio, so this one fails -- and says so.
    await vi.waitFor(async () => {
      const s = (await call('GET', '/api/training/generate')).body as unknown as GenerateStatus
      expect(s.status).toBe('error')
      expect(s.error).toBeTruthy()
    })
  })
})

describe('workouts and meditation', () => {
  it('logs a workout and removes it over one round trip', async () => {
    const logged = await call('POST', '/api/workouts', { date: DAY, kind: 'wod', minutes: 45 })
    expect(logged.status).toBe(201)
    const id = (logged.body as unknown as { id: string }).id
    let day = (await call('GET', `/api/day/${DAY}`)).body as unknown as DayView
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

describe('readBody', () => {
  const request = (chunks: Buffer[]): IncomingMessage => {
    const req = new PassThrough()
    queueMicrotask(() => { for (const c of chunks) req.write(c); req.end() })
    return req as unknown as IncomingMessage
  }

  it('decodes a character split across two chunks', async () => {
    const bytes = Buffer.from(JSON.stringify({ name: 'Crème brûlée 🍮' }))
    const at = bytes.indexOf(Buffer.from('🍮')) + 2 // half-way through the emoji
    expect(await readBody(request([bytes.subarray(0, at), bytes.subarray(at)]))).toEqual({ name: 'Crème brûlée 🍮' })
  })

  it('counts the limit in bytes', async () => {
    const body = Buffer.from(JSON.stringify({ name: 'é'.repeat(6) })) // 23 bytes, 17 characters
    await expect(readBody(request([body]), 20)).rejects.toThrow(/too large/)
    expect(await readBody(request([body]), 23)).toEqual({ name: 'éééééé' })
  })
})

describe('the vite plugin', () => {
  it('opens no database until a server starts, so a build leaves the live one alone', () => {
    const untouched = path.join(dir, 'not-yet')
    const plugin = api({ dir: untouched })
    expect(fs.existsSync(untouched)).toBe(false)
    const use = vi.fn()
    ;(plugin.configurePreviewServer as (s: unknown) => void)({ middlewares: { use } })
    expect(use).toHaveBeenCalledOnce()
    expect(fs.existsSync(path.join(untouched, 'macros.sqlite'))).toBe(true)
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

describe('health', () => {
  it('reports the process, its data file, what is busy and whether the model server answers', async () => {
    const { status, body } = await call('GET', '/api/health')
    expect(status).toBe(200)
    expect(body).toMatchObject({ ok: true, app: 'cairn', busy: { notes: 0, research: 0 }, deps: { model: 'ok' }, errors: [] })
    expect(body.data).toMatchObject({ file: 'macros.sqlite' })
    expect(typeof body.version).toBe('string')
  })
})
