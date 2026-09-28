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

  it('reports bad input as a 400 with the reason', async () => {
    const res = await call('POST', '/api/entries', { date: 'yesterday', meal: 'lunch' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/date/)
  })

  it('refuses a date that is really a path', async () => {
    expect((await call('GET', '/api/day/..%2F..%2Fetc')).status).toBe(400)
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

  it('never returns the USDA key', async () => {
    await call('PUT', '/api/settings', { usdaApiKey: 'SECRETKEY', lmStudioToken: 'sk-lm-SECRET' })
    const res = await call('GET', '/api/settings')
    expect(res.body).toMatchObject({ hasUsdaKey: true, hasLmStudioToken: true })
    expect(JSON.stringify(res.body)).not.toMatch(/SECRET/)
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
