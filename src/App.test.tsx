import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App.tsx'
import { localDate } from './lib/nutrition.ts'
import type { DayView, Entry, Food } from './types.ts'

const TODAY = localDate()
const GOALS = { calories: 2000, protein: 150, fat: 65, carbs: 200, fiber: 30 }

const banana: Food = {
  id: 'usda:173944', name: 'Bananas, raw', source: 'usda', sourceId: '173944',
  per100g: { calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8, fiber: 2.6 },
}

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1', date: TODAY, meal: 'breakfast', name: 'Oats', grams: 50,
  nutrients: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: 5 },
  per100g: { calories: 380, protein: 13, fat: 6.8, carbs: 66, fiber: 10 },
  source: 'usda', createdAt: 1, ...over,
})

const day = (entries: Entry[], over: Partial<DayView> = {}): DayView => ({
  date: TODAY, entries, goals: GOALS,
  totals: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: 5 },
  missing: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
  ...over,
})

interface Call { url: string; method: string; body?: unknown }

/** A fake server; `routes` maps "METHOD /path-prefix" to a response body. */
function stubApi(routes: Record<string, unknown>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url, init) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    const key = Object.keys(routes).find((k) => {
      const [m, prefix] = k.split(' ')
      return m === method && url.startsWith(prefix!)
    })
    const body = key ? routes[key] : {}
    return { ok: true, status: 200, json: async () => (typeof body === 'function' ? body() : body) }
  }))
  return calls
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('App', () => {
  it('shows the day totals against goals, and entries under their meal', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]) })
    render(<App />)
    expect(await screen.findByText('Oats')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Daily totals' })).getByText('190')).toBeInTheDocument()
    expect(screen.getByText('1810 left')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Breakfast' })).getByText('Oats')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Fiber' })).toHaveAttribute('aria-valuenow', '5')
  })

  it('marks a total as partial when an entry lacks that nutrient', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([entry({ nutrients: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: null } })], {
        missing: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 1 },
      }),
    })
    render(<App />)
    expect(await screen.findByTitle('1 item missing this value')).toBeInTheDocument()
  })

  it('says how far over the calorie goal the day is', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { totals: { calories: 2150, protein: 0, fat: 0, carbs: 0, fiber: 0 } }) })
    render(<App />)
    expect(await screen.findByText('150 over')).toBeInTheDocument()
  })

  it('moves between days', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ 'GET /api/day/': day([]) })
    render(<App />)
    await screen.findByText('Today')
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByText('Yesterday')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url !== `/api/day/${TODAY}` && c.url.startsWith('/api/day/'))).toBe(true))
  })

  it('searches, picks a USDA food with a household portion, and logs it by weight', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [banana], off: [], errors: [] },
      'GET /api/portions/173944': [{ label: '1 medium', grams: 118 }],
      'POST /api/entries': entry(),
    })
    render(<App />)
    await screen.findByText('Today')
    await user.click(screen.getByRole('button', { name: 'Add to Lunch' }))
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
    await user.click(await screen.findByText('Bananas, raw', {}, { timeout: 2000 }))

    // The household measure replaces the 100 g default once it arrives.
    await waitFor(() => expect(screen.getByLabelText('Amount (g)')).toHaveValue('118'))
    expect(screen.getByRole('button', { name: '1 medium' })).toBeInTheDocument()
    expect(screen.getByText('105')).toBeInTheDocument() // 89 kcal/100 g × 1.18

    await user.click(screen.getByRole('button', { name: /^Log 118 g/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/entries')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.body).toMatchObject({
      date: TODAY, meal: 'lunch', name: 'Bananas, raw', grams: 118, per100g: banana.per100g, source: 'usda',
    })
  })

  it('shows one database failing without hiding the other', async () => {
    const user = userEvent.setup()
    stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': {
        usda: [], off: [{ ...banana, id: 'off:1', name: 'Banana chips', source: 'off' }],
        errors: [{ source: 'usda', message: 'rate limited; add a free USDA API key in Settings' }],
      },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
    expect(await screen.findByText(/rate limited/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Banana chips')).toBeInTheDocument()
  })

  it('logs a manual entry, leaving blanks unknown and warning about implausible calories', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/entries': entry() })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    await user.type(screen.getByLabelText('Name'), 'Burrito')
    await user.type(screen.getByLabelText('Calories (kcal)'), '6500')
    await user.type(screen.getByLabelText('Protein (g)'), '30')
    await user.type(screen.getByLabelText('Fat (g)'), '25')
    await user.type(screen.getByLabelText('Carbs (g)'), '80')
    expect(screen.getByRole('status')).toHaveTextContent(/about 665 kcal, not 6500/)

    await user.clear(screen.getByLabelText('Calories (kcal)'))
    await user.type(screen.getByLabelText('Calories (kcal)'), '650')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Log' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Burrito', grams: null, source: 'custom',
      nutrients: { calories: 650, protein: 30, fat: 25, carbs: 80, fiber: null },
    })
  })

  it('edits a logged food by weight', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]), 'PATCH /api/entries/e1': entry() })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    const grams = await screen.findByLabelText('Amount (g)')
    await user.clear(grams)
    await user.type(grams, '80')
    expect(screen.getByText('304')).toBeInTheDocument() // 380 × 0.8
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ grams: 80 })
  })

  it('deletes an entry', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]), 'DELETE /api/entries/e1': { ok: true } })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/entries/e1')).toBe(true))
  })

  it('saves goals and never displays the stored USDA key', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/settings': { hasUsdaKey: true },
      'PUT /api/goals': GOALS,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByPlaceholderText('saved — type to replace')).toHaveValue('')
    const protein = screen.getByLabelText('Protein (g)')
    await user.clear(protein)
    await user.type(protein, '160')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ protein: 160, calories: 2000 })
    // No key typed, so the saved one is left alone.
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings')).toBe(false)
  })
})
