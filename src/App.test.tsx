import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TIMING } from './lib/timing.ts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { dayLabel } from './lib/format.ts'
import App from './App.tsx'
import { chime } from './lib/chime.ts'
import { addDays, localDate, startOfWeek } from './lib/nutrition.ts'
import { DEFAULT_WORKOUT_KINDS } from './types.ts'
import type { DayView, Entry, Food, Goals, RangeView, TrainingDay } from './types.ts'

vi.mock('./lib/chime.ts', () => ({ chime: vi.fn(), listenForChimeUnlock: vi.fn() }))
// jsdom has no canvas: the shrink is faked, and the test checks what is sent and filled in.
vi.mock('./lib/image.ts', () => ({ shrinkImage: vi.fn<() => Promise<string>>(async () => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==') }))

const TODAY = localDate()
const RANGE = (n: number): { min: number; max: number } => ({ min: n, max: n })
const GOALS = {
  calories: { min: 0, max: 2000 }, protein: RANGE(150), fat: RANGE(65),
  fiber: 30, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1,
}
/** Lifting 2, yoga 4, pilates 1, WOD 2 a week -- 9 sessions. */
const PLAN = { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 }
const NO_KINDS = { wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 0, pilates: 0 }
/** A day's workouts: nothing today, nothing yet this week, on the default plan. */
const WORKOUTS_DAY = {
  sessions: [], minutes: 0, weekStart: startOfWeek(TODAY), kinds: DEFAULT_WORKOUT_KINDS, plan: PLAN, planIsCustom: false, weekByKind: NO_KINDS,
  weekTotal: 0, weekGoal: 9, lastLogId: null, planned: [], weekSessions: [],
}
/** What Settings edits and /api/goals returns -- separate shape from GOALS above (a resolved, per-day view). */
const STORED_GOALS: Goals = {
  calories: 1800, minCalories: 0, protein: 130, fat: 60, fiber: 30, water: 72, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1, workoutPlan: PLAN,
}
/** A range day's workout and meditation fields, with nothing logged. */
const DAY_ACTIVITY = { workouts: 0, workoutMinutes: 0, meditationMinutes: 0, dogWalks: 0, dogMiles: 0 }

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
  water: { ounces: 0, goal: 72, tea: 0, lastLogId: null },
  alcohol: { drinks: 0, byKind: { beer: 0, wine: 0, liquor: 0 }, weekTotal: 0, weekByKind: { beer: 0, wine: 0, liquor: 0 }, weekGoal: 7, calories: 0, lastLogId: null },
  workouts: WORKOUTS_DAY,
  meditation: { sessions: [], minutes: 0, goal: 10, lastLogId: null },
  dog: { walks: [], miles: 0, goal: 2, walkMiles: 1, lastLogId: null },
  body: { weight: null, bodyFat: null, leanMass: null, bmi: null },
  ...over,
})

const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }

/** A week starting `start` (default: the Monday on or before today), mostly untouched. */
const NO_SCORE = { calories: { met: 0, of: 0 }, protein: { met: 0, of: 0 }, fat: { met: 0, of: 0 }, fiber: { met: 0, of: 0 } }

const range = (over: Partial<RangeView> = {}, start = startOfWeek(TODAY)): RangeView => ({
  start, end: addDays(start, 6), goals: GOALS, scorecard: NO_SCORE, charts: ['calories', 'protein', 'fiber', 'water'], totalDays: 7, loggedDays: 0, averagedDays: 7,
  totals: ZERO, averages: ZERO,
  water: { total: 0, average: 0, met: 0, of: 0 }, alcohol: { total: 0, average: 0, calories: 0, byKind: { beer: 0, wine: 0, liquor: 0 } },
  workouts: { sessions: 0, days: 0, minutes: 0, kinds: DEFAULT_WORKOUT_KINDS, byKind: NO_KINDS, goalByKind: PLAN, goal: 9 },
  meditation: { total: 0, average: 0, days: 0, met: 0, of: 0, streak: 0 },
  dog: { walks: 0, miles: 0, days: 0, met: 0, of: 0, streak: 0 },
  body: { weight: null, bodyFat: null, leanMass: null, bmi: null },
  days: Array.from({ length: 7 }, (_, i) => ({
    date: addDays(start, i), entryCount: 0, water: 0, alcohol: 0, ...DAY_ACTIVITY, goals: GOALS, totals: ZERO, missing: ZERO,
  })),
  ...over,
})

interface Call { url: string; method: string; body?: unknown }

/** A fake server; `routes` maps "METHOD /path-prefix" to a response body. */
/** The add sheet opens on My foods; switch to Search and hand back its box. */
async function searchBox(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('tab', { name: 'Search' }))
  return screen.findByLabelText('Search foods')
}

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

/** Go to a section from the bottom bar, and optionally one of its views. */
async function goTo(section: 'Nutrition' | 'Train', view?: string): Promise<void> {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: section }))
  if (view) await user.click(await screen.findByRole('tab', { name: view }))
}

beforeEach(() => { vi.unstubAllGlobals(); vi.mocked(chime).mockClear() })

describe('App', () => {
  it('shows the day totals against goals, and entries under their meal', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]) })
    render(<App />)
    expect(await screen.findByText('Oats')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Daily totals' })).getByText('190')).toBeInTheDocument()
    expect(screen.getByText('1810 left')).toBeInTheDocument() // calories are a max: so much left, not "to go"
    expect(within(screen.getByRole('region', { name: 'Breakfast' })).getByText('Oats')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Fiber' })).toHaveAttribute('aria-valuenow', '5')
  })

  it('totals each meal\u2019s macros beside its calories, not just the calories', async () => {
    const two = [entry(), entry({ id: 'e2', name: 'Banana', nutrients: { calories: 105, protein: 1.3, fat: 0.4, carbs: 27, fiber: 3.1 } })]
    stubApi({ [`GET /api/day/${TODAY}`]: day(two) })
    render(<App />)
    expect(await screen.findByLabelText('Breakfast calories')).toHaveTextContent('295 kcal')
    expect(screen.getByLabelText('Breakfast macros')).toHaveTextContent('P 8 · F 4 · C 60 · Fib 9')
  })

  it('lists the goals to reach (protein, fat, fiber) before the one to stay under (carbs)', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]) })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Daily totals' })
    const names = [...card.querySelectorAll('.macro-grid .macro-name')].map((el) => el.textContent)
    expect(names).toEqual(['Protein', 'Fat', 'Fiber', 'Carbs'])
  })

  it("shows the scale's latest readings in lb, with the change since the last one", async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        body: {
          weight: { value: 68.04, measuredAt: 1, date: TODAY, change: -0.45 },
          bodyFat: { value: 25, measuredAt: 1, date: TODAY, change: null },
          leanMass: null, bmi: null,
        },
      }),
    })
    render(<App />)
    await goTo('Train', 'Block')
    const card = await screen.findByRole('region', { name: 'Body' })
    expect(within(card).getByText('150.0')).toBeInTheDocument() // 68.04 kg
    expect(within(card).getByText('−1.0 · today')).toBeInTheDocument() // -0.45 kg is about 1 lb
    expect(within(card).getByText('25.0')).toBeInTheDocument()
    expect(within(card).queryByText('Lean mass')).not.toBeInTheDocument() // only kinds that have a reading
  })

  it('has no Body card until the first reading arrives', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([]) })
    render(<App />)
    await screen.findByRole('region', { name: 'Water' })
    expect(screen.queryByRole('region', { name: 'Body' })).not.toBeInTheDocument()
  })

  it('says which request could not reach the server, instead of a bare network error', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET /api/day/${TODAY}`]: day([]) })
    const ok = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) =>
      (url.startsWith('/api/targets') ? Promise.reject(new TypeError('NetworkError when attempting to fetch resource.')) : (ok as typeof fetch)(url, init))))
    render(<App />) // App has its own toaster
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    // Only after its retries have run out.
    expect(await screen.findByText(/Couldn.t reach Cairn \(GET \/api\/targets\)/, {}, { timeout: 4000 })).toBeInTheDocument()
  })

  it('tries a read again when it gets no reply, so one dropped request is never seen', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/targets': STORED_GOALS })
    const ok = globalThis.fetch
    let dropped = 0
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/targets') && dropped < 2) { dropped++; return Promise.reject(new TypeError('NetworkError when attempting to fetch resource.')) }
      return (ok as typeof fetch)(url, init)
    }))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByLabelText('Protein (g, min)', {}, { timeout: 4000 })).toHaveValue('130')
    expect(dropped).toBe(2) // two tries got no reply; the third loaded the goals above
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

  it('flags going over only on calories, the max; protein, fat and fiber are mins, and carbs have no goal', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { totals: { calories: 2100, protein: 200, fat: 100, carbs: 250, fiber: 45 } }) })
    render(<App />)
    await screen.findByText('Today')
    expect(screen.getByRole('progressbar', { name: 'Calories' })).toHaveClass('over')
    expect(screen.queryByRole('progressbar', { name: 'Carbs' })).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Fat' })).not.toHaveClass('over')
    expect(screen.getByRole('progressbar', { name: 'Protein' })).not.toHaveClass('over')
    expect(screen.getByRole('progressbar', { name: 'Fiber' })).not.toHaveClass('over')
    // Each goal says which way it points, and the line under it says where the day stands.
    expect(screen.getByText('100 over')).toBeInTheDocument() // calories 2100 against 2000
    expect(screen.getByText('No goal')).toBeInTheDocument() // carbs
    expect(screen.getByText('/ min 65g')).toBeInTheDocument()
    expect(screen.getByText('/ min 150g')).toBeInTheDocument()
    expect(screen.getAllByText('Goal met')).toHaveLength(3) // protein 200 >= 150, fat 100 >= 65, fiber 45 >= 30
  })

  it('counts down to a min that has not been reached yet', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { totals: { calories: 500, protein: 90, fat: 20, carbs: 50, fiber: 12 } }) })
    render(<App />)
    expect(await screen.findByText('60 g to go')).toBeInTheDocument() // protein 90 of 150
    expect(screen.getByText('18 g to go')).toBeInTheDocument() // fiber 12 of 30
    expect(screen.getByText('45 g to go')).toBeInTheDocument() // fat 20 of a 65 min
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

  it('offers a Today button once you have moved off today, and it brings you back', async () => {
    const user = userEvent.setup()
    stubApi({ 'GET /api/day/': day([]) })
    render(<App />)
    await screen.findByText('Today')
    expect(screen.queryByRole('button', { name: 'Jump to the current day' })).not.toBeInTheDocument() // already there
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    const jump = screen.getByRole('button', { name: 'Jump to the current day' })
    expect(jump).toHaveTextContent('Today')
    await user.click(jump)
    expect(screen.getByRole('button', { name: 'Today' })).toHaveClass('date-label')
    expect(screen.queryByRole('button', { name: 'Jump to the current day' })).not.toBeInTheDocument()
  })

  it('opens the food search empty every time, with nothing for the browser to fill in', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [banana], off: [], errors: [] } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    const box = await searchBox(user)
    expect(box).toHaveAttribute('autocomplete', 'off')
    await user.type(box, 'banana')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(await searchBox(user)).toHaveValue('')
  })

  it('clears the search box with its button, and puts the cursor back', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [banana], off: [], errors: [] } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    const box = await searchBox(user)
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
    await user.type(box, 'banana')
    expect(await screen.findByText('Bananas, raw')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
    expect(screen.queryByText('Bananas, raw')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('does not bring back a finished online lookup, or its words, on the next opening', async () => {
    // What the sheet remembers across openings is only a lookup still in
    // flight. One that has answered used to refill the box every time.
    const user = userEvent.setup()
    localStorage.setItem('macros.research', 'j1')
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'GET /api/research/j1': {
        id: 'j1', query: 'pad thai', status: 'done', step: 'done', startedAt: Date.now() - 60_000,
        result: { query: 'pad thai', foods: [], model: 'qwen/qwen3.8-27b', seconds: 74 },
      },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    const box = await searchBox(user)
    await waitFor(() => expect(calls.some((c) => c.url === '/api/research/j1')).toBe(true))
    expect(box).toHaveValue('')
    expect(screen.queryByRole('region', { name: 'Online' })).not.toBeInTheDocument()
    await waitFor(() => expect(localStorage.getItem('macros.research')).toBeNull())
  })

  it('picks a still-running online lookup back up, with the words it was for', async () => {
    const user = userEvent.setup()
    localStorage.setItem('macros.research', 'j1')
    stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'GET /api/research/j1': { id: 'j1', query: 'pad thai', status: 'running', step: 'reading', startedAt: Date.now() - 20_000 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    expect(await searchBox(user)).toHaveValue('pad thai')
    expect(await screen.findByText(/Looking it up/)).toBeInTheDocument()
  })

  describe('polling a running lookup', () => {
    const running = { id: 'j1', query: 'pad thai', status: 'running', step: 'reading', startedAt: Date.now() - 20_000 }
    /** The resumed lookup j1, with its polls answered by `poll` (n counts from 1). */
    const resume = (poll: (n: number) => Promise<Response>) => {
      localStorage.setItem('macros.research', 'j1')
      const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [], off: [], errors: [] } })
      const rest = vi.mocked(fetch).getMockImplementation()!
      let n = 0
      vi.mocked(fetch).mockImplementation(async (url, init) => (url === '/api/research/j1' ? poll(++n) : rest(url, init)))
      return { calls, polls: () => n }
    }
    const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response

    it('keeps asking through a failed poll', async () => {
      const user = userEvent.setup()
      resume(async (n) => (n === 1 ? reply(200, running) : n === 2 ? Promise.reject(new TypeError('Failed to fetch')) : n === 3
        ? reply(502, { error: 'bad gateway' })
        : reply(200, { ...running, status: 'done', step: 'done', result: { query: 'pad thai', foods: [], note: '', model: 'm', seconds: 70 } })))
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await searchBox(user)
      expect(await screen.findByText(/Nothing reliable found/, {}, { timeout: 3000 })).toBeInTheDocument()
    })

    it('forgets the lookup once the server no longer has it', async () => {
      const user = userEvent.setup()
      resume(async (n) => (n === 1 ? reply(200, running) : reply(404, { error: 'no such lookup' })))
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await searchBox(user)
      await waitFor(() => expect(localStorage.getItem('macros.research')).toBeNull())
      expect(screen.queryByText(/Looking it up/)).not.toBeInTheDocument()
    })

    it('asks again only once the last ask has answered', async () => {
      const user = userEvent.setup()
      const r = resume(async (n) => (n === 1 ? reply(200, running) : new Promise<Response>(() => {}))) // the second never answers
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await searchBox(user)
      expect(await screen.findByText(/Looking it up/)).toBeInTheDocument()
      await waitFor(() => expect(r.polls()).toBe(2))
      await new Promise((done) => setTimeout(done, TIMING.pollMs * 6))
      expect(r.polls()).toBe(2)
    })
  })

  it('adds a picked food, at the amount shown, to a saved meal from the pick screen', async () => {
    const user = userEvent.setup()
    const breakfast = { id: 'meal:m1', name: 'Breakfast', createdAt: 0, items: [{ name: 'Eggs', grams: 100, per100g: { calories: 155, protein: 13, fat: 11, carbs: 1.1, fiber: 0 }, source: 'usda' }] }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [banana], off: [], errors: [] },
      'GET /api/portions/173944': [],
      'GET /api/meals': [breakfast],
      'POST /api/meals': { ...breakfast, items: [...breakfast.items, {}] },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'banana')
    await user.click(await screen.findByText('Bananas, raw', {}, { timeout: 2000 }))
    await user.clear(await screen.findByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '150')
    await user.click(screen.getByRole('button', { name: 'Add to a meal' }))
    await user.click(await screen.findByRole('button', { name: /^Breakfast/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meals')).toBe(true))
    const body = calls.find((c) => c.method === 'POST' && c.url === '/api/meals')!.body as { id: string; items: { name: string; grams: number }[] }
    expect(body.id).toBe('meal:m1')
    expect(body.items.map((i) => [i.name, i.grams])).toEqual([['Eggs', 100], ['Bananas, raw', 150]])
    // Nothing was logged: the pick screen is still here, meal added.
    expect(calls.some((c) => c.url === '/api/entries')).toBe(false)
    expect(screen.getByLabelText('Amount')).toBeInTheDocument()
  })

  it('starts a new meal from a logged entry, with the entry as its first food', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([entry()]),
      'GET /api/meals': [],
      'POST /api/meals': { id: 'meal:new', name: 'Lunch box', createdAt: 0, items: [{}] },
    })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Add to a meal' }))
    await user.type(await screen.findByLabelText('New meal name'), 'Lunch box')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meals')).toBe(true))
    const body = calls.find((c) => c.method === 'POST' && c.url === '/api/meals')!.body as { id?: string; name: string; items: Record<string, unknown>[] }
    expect(body.id).toBeUndefined()
    expect(body.name).toBe('Lunch box')
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ name: 'Oats', grams: 50, source: 'usda' })
    expect(body.items[0]).not.toHaveProperty('date')
    expect(body.items[0]).not.toHaveProperty('id')
  })

  it('searches, picks a USDA food, and logs it in its household portion', async () => {
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
    await user.type(await searchBox(user), 'banana')
    await user.click(await screen.findByText('Bananas, raw', {}, { timeout: 2000 }))

    // The household measure replaces the 100 g default once it arrives.
    await waitFor(() => expect(screen.getByLabelText('Unit')).toHaveDisplayValue('1 medium (118 g)'))
    expect(screen.getByLabelText('Amount')).toHaveValue('1')
    expect(screen.getByRole('button', { name: '1 medium' })).toBeInTheDocument()
    expect(screen.getByText('105')).toBeInTheDocument() // 89 kcal/100 g × 1.18

    // Two of them, then log -- recorded as measured, with the weight worked out.
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '2')
    expect(screen.getByText('= 236 g')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Log 2 medium/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/entries')).toBe(true))
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/entries')!
    expect(post.body).toMatchObject({
      date: TODAY, meal: 'lunch', name: 'Bananas, raw', grams: 236, per100g: banana.per100g, source: 'usda',
      amount: { quantity: 2, unit: '1 medium', unitGrams: 118 },
    })
  })

  it('still logs by weight in grams or ounces', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [banana], off: [], errors: [] },
      'GET /api/portions/173944': [],
      'POST /api/entries': entry(),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'banana')
    await user.click(await screen.findByText('Bananas, raw', {}, { timeout: 2000 }))
    await user.selectOptions(screen.getByLabelText('Unit'), 'oz')
    await user.click(screen.getByRole('button', { name: /^Log 1 oz/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/entries')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/entries')!.body).toMatchObject({
      grams: 28.3, amount: { quantity: 1, unit: 'oz' },
    })
  })

  it('saves a search result to My foods directly, without opening or logging it', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [banana], off: [], errors: [] },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'banana')
    await screen.findByText('Bananas, raw', {}, { timeout: 2000 })

    await user.click(screen.getByRole('button', { name: 'Save Bananas, raw to My foods' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject(banana)
    // It's kept, not logged: no amount to pick, nothing posted to /api/entries.
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/entries')).toBe(false)

    // The star now offers to undo it.
    const unsave = await screen.findByRole('button', { name: 'Remove Bananas, raw from My foods' })
    await user.click(unsave)
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.startsWith('/api/foods/'))).toBe(true))
    expect(calls.find((c) => c.method === 'DELETE')!.url).toBe(`/api/foods/${encodeURIComponent(banana.id)}`)
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
    await user.type(await searchBox(user), 'banana')
    expect(await screen.findByText(/rate limited/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(screen.getByText('Banana chips')).toBeInTheDocument()
  })

  it('shows a store-brand search as that brand, with your own matches first', async () => {
    const user = userEvent.setup()
    const tjs: Food = { ...banana, id: 'off:1', name: 'Mandarin Orange Chicken', brand: "Trader Joe's", source: 'off', sourceId: '1' }
    stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/foods': { saved: [{ ...tjs, id: 'off:9', name: 'Hummus' }], recent: [] },
      'GET /api/search': { usda: [], off: [tjs], errors: [], brand: "Trader Joe's" },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'tjs hummus')
    expect(await screen.findByRole('region', { name: 'Yours' })).toHaveTextContent('Hummus')
    const group = await screen.findByRole('region', { name: "Trader Joe's" }, { timeout: 2000 })
    expect(within(group).getByText('Mandarin Orange Chicken')).toBeInTheDocument()
    // No empty "Whole foods" section for a brand search.
    expect(screen.queryByRole('region', { name: 'Whole foods' })).not.toBeInTheDocument()
  })

  it('flags a search result whose calories contradict its macros', async () => {
    const user = userEvent.setup()
    const typo: Food = { ...banana, id: 'off:2', name: 'Granola', source: 'off',
      per100g: { calories: 45, protein: 10, fat: 20, carbs: 60, fiber: 6 } }
    stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [], off: [typo], errors: [] } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'granola')
    expect(await screen.findByLabelText("Numbers don't add up", {}, { timeout: 2000 })).toBeInTheDocument()
    await user.click(screen.getByText('Granola'))
    expect(screen.getByRole('status')).toHaveTextContent(/may have a typo/)
  })

  it('fills the Manual tab in from a photographed label, ticked for My foods, and leaves the name to type', async () => {
    const user = userEvent.setup()
    const reading = {
      name: null, brand: 'Kodiak', serving: { label: '1/2 cup (53g)', grams: 53 },
      nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: 3 }, note: 'Serving is as mixed.', model: 'eyes',
    }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]), 'POST /api/label': { reading },
      'POST /api/foods': { id: 'custom:1', name: 'Pancake mix', source: 'custom' }, 'POST /api/entries': entry(),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    await user.click(screen.getByRole('button', { name: 'Scan a nutrition label' }))
    await user.upload(screen.getByLabelText('Label picture'), new File(['x'], 'label.jpg', { type: 'image/jpeg' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Filled in from the label by eyes.*Serving is as mixed.*gave no name/)
    expect(calls.find((c) => c.url === '/api/label')!.body).toEqual({ image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByLabelText('Brand (optional)')).toHaveValue('Kodiak')
    expect(screen.getByLabelText('Serving')).toHaveValue('1/2 cup (53g)')
    expect(screen.getByLabelText('Weighs (g, optional)')).toHaveValue('53')
    expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('190') // the label's figure, not one from the macros
    expect(screen.getByLabelText('Fiber (g)')).toHaveValue('3')
    expect(screen.getByRole('checkbox', { name: 'Save to My foods' })).toBeChecked()
    expect(chime).toHaveBeenCalledWith('done')

    await user.type(screen.getByLabelText('Name'), 'Pancake mix')
    await user.click(screen.getByRole('button', { name: 'Log 1/2 cup (53g)' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/entries' && c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.url === '/api/foods' && c.method === 'POST')!.body).toMatchObject({
      name: 'Pancake mix', brand: 'Kodiak', source: 'custom',
      perServing: { label: '1/2 cup (53g)', grams: 53, nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: 3 } },
      servings: [{ label: '1/2 cup (53g)', grams: 53 }],
    })
    expect(calls.find((c) => c.url === '/api/entries')!.body).toMatchObject({ name: 'Pancake mix', grams: 53, foodId: 'custom:1', source: 'custom' })
  })

  it('says why a label could not be read, and leaves the form as it was', async () => {
    const user = userEvent.setup()
    stubApi({ [`GET /api/day/${TODAY}`]: day([]) })
    const rest = vi.mocked(fetch).getMockImplementation()!
    vi.mocked(fetch).mockImplementation(async (url, init) => (url === '/api/label'
      ? { ok: false, status: 502, json: async () => ({ error: "Couldn't read a nutrition label there: a cat" }) } as Response
      : rest(url, init)))
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    await user.type(screen.getByLabelText('Name'), 'Oats')
    await user.upload(screen.getByLabelText('Label picture'), new File(['x'], 'cat.jpg', { type: 'image/jpeg' }))
    expect(await screen.findByText(/a cat/)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Oats')
    expect(screen.getByRole('checkbox', { name: 'Save to My foods' })).not.toBeChecked()
    expect(chime).toHaveBeenCalledWith('failed')
    expect(screen.getByRole('button', { name: 'Scan a nutrition label' })).toBeInTheDocument()
  })

  it('scans a screenshot pasted anywhere on the page, and leaves a text paste alone', async () => {
    const user = userEvent.setup()
    const reading = {
      name: 'Oat bar', brand: null, serving: { label: '1 bar (40g)', grams: 40 },
      nutrients: { calories: 180, protein: 5, fat: 7, carbs: 26, fiber: 3 }, note: undefined, model: 'eyes',
    }
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/label': { reading } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    expect(screen.getByText('Or paste a screenshot, or drop a picture here.')).toBeInTheDocument()
    // Pasting words into a field is still just typing.
    fireEvent.paste(screen.getByLabelText('Name'), { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } })
    expect(calls.some((c) => c.url === '/api/label')).toBe(false)
    // A screenshot on the clipboard, pasted with nothing focused, scans.
    const shot = new File(['x'], 'shot.png', { type: 'image/png' })
    fireEvent.paste(document.body, { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => shot }], files: [shot] } })
    expect(await screen.findByText(/Filled in from the label by eyes/)).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/label')!.body).toEqual({ image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' })
    expect(screen.getByLabelText('Name')).toHaveValue('Oat bar')
    expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('180')
    expect(screen.queryByText('Or paste a screenshot, or drop a picture here.')).not.toBeInTheDocument()
  })

  it('scans a picture dropped anywhere on the page, lighting the button up while it is dragged over', async () => {
    const user = userEvent.setup()
    const reading = {
      name: 'Oat bar', brand: null, serving: { label: '1 bar', grams: null },
      nutrients: { calories: 180, protein: 5, fat: 7, carbs: 26, fiber: null }, note: undefined, model: 'eyes',
    }
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/label': { reading } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    const shot = new File(['x'], 'shot.png', { type: 'image/png' })
    const carrying = { items: [{ kind: 'file', type: 'image/png', getAsFile: () => shot }], files: [shot], dropEffect: 'none' }
    // A text drag is not a picture: nothing lights up.
    fireEvent.dragOver(document.body, { dataTransfer: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] } })
    expect(screen.getByRole('button', { name: 'Scan a nutrition label' })).not.toHaveClass('dragging')
    fireEvent.dragOver(document.body, { dataTransfer: carrying })
    expect(screen.getByRole('button', { name: 'Drop the picture to scan it' })).toHaveClass('dragging')
    fireEvent.dragLeave(document.body, { relatedTarget: null })
    expect(screen.getByRole('button', { name: 'Scan a nutrition label' })).not.toHaveClass('dragging')
    fireEvent.dragOver(document.body, { dataTransfer: carrying })
    fireEvent.drop(document.body, { dataTransfer: carrying })
    expect(await screen.findByText(/Filled in from the label by eyes/)).toBeInTheDocument()
    expect(calls.filter((c) => c.url === '/api/label')).toHaveLength(1)
    expect(screen.getByLabelText('Name')).toHaveValue('Oat bar')
    expect(screen.getByRole('button', { name: 'Scan another label' })).not.toHaveClass('dragging')
  })

  it('saves a typed food to My foods without logging it, and shows it there', async () => {
    const user = userEvent.setup()
    const saved = {
      id: 'custom:7', name: 'Oat bar', brand: 'Bobo', source: 'custom',
      perServing: { label: '1 bar', grams: 40, nutrients: { calories: 180, protein: 5, fat: 7, carbs: 26, fiber: null } },
      per100g: { calories: 450, protein: 12.5, fat: 17.5, carbs: 65, fiber: null }, servings: [{ label: '1 bar', grams: 40 }],
    }
    let foods: unknown[] = []
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]), 'POST /api/foods': saved, 'GET /api/foods': () => ({ saved: foods, recent: [] }),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    expect(screen.getByRole('button', { name: 'Save without logging' })).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'Oat bar')
    await user.type(screen.getByLabelText('Brand (optional)'), 'Bobo')
    await user.type(screen.getByLabelText('Serving'), '1 bar')
    await user.type(screen.getByLabelText('Weighs (g, optional)'), '40')
    await user.type(screen.getByLabelText(/^Calories \(kcal\)/), '180')
    await user.type(screen.getByLabelText('Protein (g)'), '5')
    foods = [saved]
    await user.click(screen.getByRole('button', { name: 'Save without logging' }))
    expect(await screen.findByText('Saved Oat bar to My foods')).toBeInTheDocument()
    expect(calls.find((c) => c.url === '/api/foods' && c.method === 'POST')!.body).toMatchObject({
      name: 'Oat bar', brand: 'Bobo', source: 'custom',
      perServing: { label: '1 bar', grams: 40, nutrients: { calories: 180, protein: 5 } },
      per100g: { calories: 450, protein: 12.5 }, servings: [{ label: '1 bar', grams: 40 }],
    })
    expect(calls.some((c) => c.url === '/api/entries')).toBe(false)
    // The sheet stays open on My foods, where it now is.
    expect(screen.getByRole('tab', { name: 'My foods' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Oat bar')).toBeInTheDocument()
  })

  it('computes calories live from protein, fat and carbs as they are typed', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/entries': entry() })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    await user.type(screen.getByLabelText('Name'), 'Burrito')
    await user.type(screen.getByLabelText('Protein (g)'), '30')
    expect(screen.getByLabelText(/^Calories \(kcal\)/)).toHaveValue('120') // 30 * 4, no Calories typed at all
    await user.type(screen.getByLabelText('Fat (g)'), '25')
    await user.type(screen.getByLabelText('Carbs (g)'), '80')
    expect(screen.getByLabelText(/^Calories \(kcal\)/)).toHaveValue('665') // 30*4 + 80*4 + 25*9
    expect(screen.getByText('· from macros')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument() // it can't disagree with itself

    await user.type(screen.getByLabelText('Serving'), '1 burrito')
    await user.click(screen.getByRole('button', { name: 'Log 1 burrito' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Burrito', grams: null, source: 'custom',
      perUnit: { calories: 665, protein: 30, fat: 25, carbs: 80, fiber: null },
    })
  })

  it('lets a typed calories value override the macros, still warning when it disagrees', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/entries': entry() })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'Manual' }))
    await user.type(screen.getByLabelText('Name'), 'Burrito')
    await user.type(screen.getByLabelText('Brand (optional)'), "Trader Joe's")
    // Before anything is typed, Calories tracks the (still-blank) macros --
    // getByLabelText needs the loose match while that "from macros" note is showing.
    await user.type(screen.getByLabelText(/^Calories \(kcal\)/), '6500')
    expect(screen.queryByText('· from macros')).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Protein (g)'), '30')
    await user.type(screen.getByLabelText('Fat (g)'), '25')
    await user.type(screen.getByLabelText('Carbs (g)'), '80')
    expect(screen.getByLabelText('Calories (kcal)')).toHaveValue('6500') // never overwritten by the macros
    expect(screen.getByRole('status')).toHaveTextContent(/about 665 kcal, not 6500/)

    // Clearing it hands control back to the macros -- but only once you edit
    // one again, not by refilling itself out from under a fresh keystroke.
    // (Cleared and back in auto mode, the "from macros" note is showing
    // again, so the loose match is needed here too.)
    await user.clear(screen.getByLabelText('Calories (kcal)'))
    await user.type(screen.getByLabelText(/^Calories \(kcal\)/), '650')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Serving'), '1 burrito')
    await user.click(screen.getByRole('button', { name: 'Log 1 burrito' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      name: 'Burrito', brand: "Trader Joe's", grams: null, source: 'custom',
      perUnit: { calories: 650, protein: 30, fat: 25, carbs: 80, fiber: null },
      amount: { quantity: 1, unit: '1 burrito', unitGrams: null },
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

  it('fills in a missing nutrient on a logged entry, sending only corrected numbers', async () => {
    const user = userEvent.setup()
    const noFiber = entry({ nutrients: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: null } })
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([noFiber]), 'PATCH /api/entries/e1': noFiber })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Edit nutrition numbers' }))
    expect(screen.getByLabelText('Fiber (g)')).toHaveValue('')
    await user.type(screen.getByLabelText('Fiber (g)'), '4.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      nutrients: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: 4.5 },
    })
  })

  it('does not send numbers that were opened but left alone', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]), 'PATCH /api/entries/e1': entry() })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Edit nutrition numbers' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({})
  })

  it('edits the numbers of a saved food in My foods', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/foods': { saved: [{ ...banana, per100g: { ...banana.per100g!, fiber: null } }], recent: [] },
      'POST /api/foods': banana,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.click(await screen.findByRole('tab', { name: 'My foods' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Bananas, raw' }))
    expect(screen.getByLabelText('Fiber (g)')).toHaveValue('')
    await user.type(screen.getByLabelText('Fiber (g)'), '2.6')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject({
      id: banana.id, per100g: { calories: 89, protein: 1.1, fat: 0.3, carbs: 22.8, fiber: 2.6 },
    })
  })

  it('stars a logged food into My foods from its entry, and unstars one already there', async () => {
    const user = userEvent.setup()
    const logged = entry({ foodId: banana.id, per100g: banana.per100g, grams: 120 })
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([logged]),
      'GET /api/foods': { saved: [], recent: [] },
      'POST /api/foods': banana,
      'DELETE /api/foods/usda:173944': { ok: true },
    })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    const star = await screen.findByRole('button', { name: 'Save Oats to My foods' })
    expect(star).toHaveAttribute('aria-pressed', 'false')
    await user.click(star)
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject({ id: banana.id, name: 'Oats', source: 'usda', per100g: banana.per100g })
    const on = await screen.findByRole('button', { name: 'Remove Oats from My foods' })
    expect(on).toHaveAttribute('aria-pressed', 'true')
    await user.click(on)
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/foods/usda%3A173944')).toBe(true))
    expect(await screen.findByRole('button', { name: 'Save Oats to My foods' })).toBeInTheDocument()
  })

  it('shows the star already on for a logged food that is in My foods', async () => {
    const user = userEvent.setup()
    stubApi({
      [`GET /api/day/${TODAY}`]: day([entry({ foodId: banana.id, per100g: banana.per100g })]),
      'GET /api/foods': { saved: [banana], recent: [] },
    })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    expect(await screen.findByRole('button', { name: 'Remove Oats from My foods' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects several logged foods and deletes them together, with Undo logging them again', async () => {
    const user = userEvent.setup()
    const entries = [entry(), entry({ id: 'e2', name: 'Banana', meal: 'lunch' }), entry({ id: 'e3', name: 'Yogurt', meal: 'dinner' })]
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day(entries),
      'DELETE /api/entries/e1': { ok: true }, 'DELETE /api/entries/e2': { ok: true },
      'POST /api/entries': entry(),
    })
    render(<App />)
    await screen.findByText('Oats')
    await user.click(screen.getByRole('button', { name: 'Select' }))
    // Tapping ticks rather than opens.
    await user.click(screen.getByText('Oats'))
    await user.click(screen.getByText('Banana'))
    expect(screen.queryByLabelText('Amount (g)')).not.toBeInTheDocument()
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete 2' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url).sort()).toEqual(['/api/entries/e1', '/api/entries/e2']))
    expect(calls.some((c) => c.url === '/api/entries/e3')).toBe(false)

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST' && c.url === '/api/entries')).toHaveLength(2))
    const names = calls.filter((c) => c.method === 'POST' && c.url === '/api/entries').map((c) => (c.body as { name: string; id?: string }))
    expect(names.map((b) => b.name).sort()).toEqual(['Banana', 'Oats'])
    expect(names.every((b) => b.id === undefined)).toBe(true)
  })

  it('corrects a search result\u2019s numbers from its row, and shows the corrected copy', async () => {
    const user = userEvent.setup()
    const fixedBanana = { ...banana, per100g: { ...banana.per100g!, fiber: 9 } }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [banana], off: [], errors: [] },
      'POST /api/foods': fixedBanana,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'banana')
    await user.click(await screen.findByRole('button', { name: 'Edit Bananas, raw' }))
    await user.clear(screen.getByLabelText('Fiber (g)'))
    await user.type(screen.getByLabelText('Fiber (g)'), '9')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject({ id: banana.id, per100g: { fiber: 9 } })
    // Back on the results: the corrected numbers in the row, the star on, and the food now under Yours too.
    const usda = await screen.findByRole('region', { name: 'Whole foods' })
    expect(await within(usda).findByText(/Fib 9/)).toBeInTheDocument()
    expect(within(usda).getByRole('button', { name: 'Remove Bananas, raw from My foods' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Yours' })).getByText(/Fib 9/)).toBeInTheDocument()
  })

  it('deletes an entry', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]), 'DELETE /api/entries/e1': { ok: true } })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/entries/e1')).toBe(true))
  })

  it('shows water logged against the goal, in ounces, bottles and mugs of tea', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 40, goal: 72, tea: 8, lastLogId: 'w2' } }) })
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Water' })).toBeInTheDocument()
    expect(screen.getByText('1 bottle + 1 mug of tea · 32 oz to go')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Water' })).toHaveAttribute('aria-valuenow', '40')
  })

  it('says when the water goal is met', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 80, goal: 72, tea: 16, lastLogId: 'w4' } }) })
    render(<App />)
    expect(await screen.findByText('2 bottles + 2 mugs of tea · goal met')).toBeInTheDocument()
  })

  it('logs a bottle of water with one tap', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/water': { id: 'w1', date: TODAY, ounces: 32, createdAt: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Bottle \(32oz\)/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/water')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/water')!.body).toEqual({ date: TODAY, ounces: 32, drink: 'water' })
  })

  it('logs a mug of tea with one tap', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/water': { id: 'w1', date: TODAY, ounces: 8, drink: 'tea', createdAt: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Tea \(8oz\)/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/water')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/water')!.body).toEqual({ date: TODAY, ounces: 8, drink: 'tea' })
  })

  it('undoes the most recent water log, only once one exists', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 0, goal: 72, tea: 0, lastLogId: null } }) })
    render(<App />)
    await screen.findByRole('region', { name: 'Water' })
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it("shows the week's sessions as filled dots on each activity's row, each telling its day, and logs one with its +", async () => {
    const user = userEvent.setup()
    const twoAgo = addDays(TODAY, -2)
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        workouts: {
          ...WORKOUTS_DAY, sessions: [{ id: 'w1', date: TODAY, kind: 'run', minutes: 30, createdAt: 1 }], minutes: 30,
          weekByKind: { ...NO_KINDS, run: 1, weightlifting: 1 }, weekTotal: 2, lastLogId: 'w1',
          planned: [], weekSessions: [
            { id: 'w1', date: TODAY, kind: 'run', minutes: 30, createdAt: 3 },
            { id: 'w0', date: twoAgo, kind: 'weightlifting', minutes: null, createdAt: 1 },
          ],
        },
      }),
      'POST /api/workouts': { id: 'w2', date: TODAY, kind: 'wod', minutes: null, createdAt: 2 },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Workouts' })
    expect(within(card).getByRole('progressbar', { name: 'Workouts this week' })).toHaveAttribute('aria-valuenow', '2')
    expect(within(card).getByText('/ 9')).toBeInTheDocument()
    // Each session is a filled dot on its activity's row, named for the day it counts for -- today's marked.
    await user.click(within(card).getByRole('button', { name: `Lifting, ${dayLabel(twoAgo)}` }))
    expect(within(card).getByRole('group', { name: 'Remove Lifting?' })).toHaveTextContent(`Lifting, ${dayLabel(twoAgo)}`)
    expect(within(card).getByRole('button', { name: 'Run, Today' })).toHaveClass('today')
    expect(within(card).queryByLabelText(/minutes/i)).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Log WOD' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/workouts')).toBe(true))
    expect(calls.find((c) => c.url === '/api/workouts')!.body).toEqual({ date: TODAY, kind: 'wod', minutes: null })
  })

  it("shows this week's plan activity by activity, and adjusts it for this week only", async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], { workouts: { ...WORKOUTS_DAY, weekByKind: { ...NO_KINDS, yoga: 2, wod: 2, run: 1 }, weekTotal: 5 } }),
      'PUT /api/workout-plan/': { weekStart: startOfWeek(TODAY), plan: { ...PLAN, yoga: 3, cycling: 1 }, custom: true },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Workouts' })
    const rows = within(within(card).getByRole('list', { name: 'This week by activity' })).getAllByRole('listitem')
    // Every activity has a row, to log from: planned ones count against the plan, the rest just count.
    expect(rows.map((r) => r.textContent)).toEqual(['WOD2 / 2', 'Lifting0 / 2', 'Run1', 'Cycling', 'Yoga2 / 4', 'Pilates0 / 1'])
    expect(rows[0]).toHaveClass('met')
    expect(rows[3]).toHaveClass('unplanned')
    await user.click(within(card).getByRole('button', { name: 'Adjust this week' }))
    await user.click(within(card).getByRole('button', { name: 'Fewer Yoga' }))
    await user.click(within(card).getByRole('button', { name: 'More Cycling' }))
    expect(within(card).getByLabelText('Yoga this week')).toHaveTextContent('3')
    await user.click(within(card).getByRole('button', { name: 'Save for this week' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.startsWith('/api/workout-plan/'))).toBe(true))
    const put = calls.find((c) => c.method === 'PUT' && c.url.startsWith('/api/workout-plan/'))!
    expect(put.url).toBe(`/api/workout-plan/${startOfWeek(TODAY)}`)
    expect(put.body).toEqual({ plan: { ...PLAN, yoga: 3, cycling: 1 } })
  })

  it('puts a week with its own plan back on the default', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], { workouts: { ...WORKOUTS_DAY, plan: { ...PLAN, yoga: 2 }, planIsCustom: true, weekGoal: 7 } }),
      'DELETE /api/workout-plan/': { weekStart: startOfWeek(TODAY), plan: PLAN, custom: false },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Workouts' })
    expect(within(card).getByText('own plan')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Adjust this week' }))
    await user.click(within(card).getByRole('button', { name: 'Use the default' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === `/api/workout-plan/${startOfWeek(TODAY)}`)).toBe(true))
  })

  it('logs a workout from its row, and removes one after asking', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        workouts: {
          ...WORKOUTS_DAY, sessions: [{ id: 'w1', date: TODAY, kind: 'yoga', minutes: null, createdAt: 1 }], weekByKind: { ...NO_KINDS, yoga: 1 }, weekTotal: 1, lastLogId: 'w1',
          planned: [], weekSessions: [{ id: 'w1', date: TODAY, kind: 'yoga', minutes: null, createdAt: 1 }],
        },
      }),
      'POST /api/workouts': { id: 'w2', date: TODAY, kind: 'cycling', minutes: null, createdAt: 2 },
      'DELETE /api/workouts/w1': { ok: true },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Workouts' })
    await user.click(within(card).getByRole('button', { name: 'Log Cycling' }))
    await waitFor(() => expect(calls.some((c) => c.url === '/api/workouts')).toBe(true))
    expect(calls.find((c) => c.url === '/api/workouts')!.body).toEqual({ date: TODAY, kind: 'cycling', minutes: null })
    // Tapping a dot asks first, naming the day; Keep closes it, Remove removes it.
    await user.click(within(card).getByRole('button', { name: 'Yoga, Today' }))
    const confirm = within(card).getByRole('group', { name: 'Remove Yoga?' })
    await user.click(within(confirm).getByRole('button', { name: 'Keep' }))
    expect(within(card).queryByRole('group', { name: 'Remove Yoga?' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(card).getByRole('button', { name: 'Yoga, Today' }))
    await user.click(within(card).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/workouts/w1')).toBe(true))
  })

  it('logs meditation a sit at a time against the daily goal, and undoes the last', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        meditation: { sessions: [{ id: 'm1', date: TODAY, minutes: 25, createdAt: 1 }], minutes: 25, goal: 50, lastLogId: 'm1' },
      }),
      'POST /api/meditation': { id: 'm2', date: TODAY, minutes: 25, createdAt: 2 },
      'DELETE /api/meditation/m1': { ok: true },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Meditation' })
    expect(within(card).getByRole('progressbar', { name: 'Meditation' })).toHaveAttribute('aria-valuenow', '25')
    expect(within(card).getByText('/ 2 sits')).toBeInTheDocument() // two 25-minute sits make the 50-minute goal
    expect(within(card).getByText('25 of 50 min')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /\+ 25-min sit/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meditation')).toBe(true))
    expect(calls.find((c) => c.url === '/api/meditation')!.body).toEqual({ date: TODAY, minutes: 25 })
    await user.click(within(card).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/meditation/m1')).toBe(true))
  })

  it("logs the dog's walks a tap at a time against two a day, and undoes the last", async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        dog: { walks: [{ id: 'd1', date: TODAY, miles: 1, createdAt: 1 }], miles: 1, goal: 2, walkMiles: 1, lastLogId: 'd1' },
      }),
      'POST /api/dog-walks': { id: 'd2', date: TODAY, miles: 1, createdAt: 2 },
      'DELETE /api/dog-walks/d1': { ok: true },
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Dog walks' })
    expect(within(card).getByRole('progressbar', { name: 'Dog walks' })).toHaveAttribute('aria-valuenow', '1')
    expect(within(card).getByText('/ 2 walks')).toBeInTheDocument()
    expect(within(card).getByText('1 mile today')).toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: /\+ 1-mile walk/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/dog-walks')).toBe(true))
    expect(calls.find((c) => c.url === '/api/dog-walks')!.body).toEqual({ date: TODAY })
    await user.click(within(card).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/dog-walks/d1')).toBe(true))
  })

  it('names the walk by its length from Settings', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { dog: { walks: [], miles: 0, goal: 2, walkMiles: 1.5, lastLogId: null } }) })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Dog walks' })
    expect(within(card).getByRole('button', { name: /\+ 1\.5-mile walk/ })).toBeInTheDocument()
    expect(within(card).getByText('No walks yet today')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('keeps the equipment on hand in Settings, for the WOD bank', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: false, workoutKinds: DEFAULT_WORKOUT_KINDS, equipment: { gear: ['dumbbells', 'bike'], dumbbells: [15, 20], kettlebells: [] } },
      'PUT /api/settings': {},
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const gear = await screen.findByRole('group', { name: 'Equipment' })
    await waitFor(() => expect(within(gear).getByLabelText('Dumbbells')).toBeChecked())
    await user.click(within(gear).getByLabelText('Jump rope'))
    const bells = screen.getByLabelText('Dumbbell weights (lb each)')
    expect(bells).toHaveValue('15, 20')
    await user.type(bells, ', x')
    expect(screen.getByText('List weights separated by commas, e.g. 15, 20, 25.')).toBeInTheDocument()
    await user.clear(bells)
    await user.type(bells, '15, 20, 25')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/settings')?.body).toMatchObject({
      equipment: { gear: ['dumbbells', 'jump-rope', 'bike'], dumbbells: [15, 20, 25], kettlebells: [] },
    }))
  })

  it('splits the equipment between places in Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: false, workoutKinds: DEFAULT_WORKOUT_KINDS, equipment: { gear: ['bike', 'dumbbells'], dumbbells: [20], kettlebells: [] } },
      'PUT /api/settings': {},
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.click(await screen.findByRole('button', { name: /add a place/ }))
    await user.type(screen.getByLabelText('Name of place 1'), 'Living room')
    await user.type(screen.getByLabelText('Name of place 2'), 'Garage')
    await user.click(within(screen.getByRole('group', { name: 'Garage' })).getByLabelText('Barbell'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/settings')?.body).toMatchObject({
      equipment: { places: [{ name: 'Living room', gear: ['bike', 'dumbbells'], dumbbells: [20] }, { name: 'Garage', gear: ['barbell'], dumbbells: [] }] },
    }))
  })

  it('edits the dog walks per day and their length in Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, dogWalks: 3, walkMiles: 1.5 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const walks = await screen.findByLabelText('Dog walks (per day)')
    expect(walks).toHaveValue('2')
    expect(screen.getByLabelText('Dog walk length (miles)')).toHaveValue('1')
    await user.clear(walks)
    await user.type(walks, '2.5')
    expect(screen.getByText('A whole number, 0 to 20.')).toBeInTheDocument()
    await user.clear(walks)
    await user.type(walks, '3')
    const miles = screen.getByLabelText('Dog walk length (miles)')
    await user.clear(miles)
    await user.type(miles, '1.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ dogWalks: 3, walkMiles: 1.5 })
  })


  it('edits the fiber goal in Settings, alongside the macros', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, fiber: 35 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const field = await screen.findByLabelText('Fiber (g, min)')
    expect(field).toHaveValue('30')
    expect(field.closest('.nutrient-fields')).not.toBeNull() // in the macro grid, not further down
    await user.clear(field)
    await user.type(field, '35')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ fiber: 35 })
  })

  it('edits the calorie cap in Settings, with no buffer or training-day carbs to set', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, calories: 1950 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const field = await screen.findByLabelText('Calories (kcal, max)')
    expect(field).toHaveValue('1800')
    expect(screen.queryByLabelText(/Calorie buffer|Carbs \(g|Extra carbs/)).not.toBeInTheDocument()
    await user.clear(field)
    await user.type(field, '1950')
    const min = screen.getByLabelText('Calories (kcal, min)')
    expect(min).toHaveValue('0')
    // A bottom above the top can't be saved.
    await user.clear(min)
    await user.type(min, '2000')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.clear(min)
    await user.type(min, '1600')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ calories: 1950, minCalories: 1600, protein: 130, fat: 60, fiber: 30 })
  })

  it('shows calories against a range: so much to go below it, and the range beside the total', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { goals: { ...GOALS, calories: { min: 1600, max: 1900 } } }) })
    render(<App />)
    expect(await screen.findByText(/1600–1900 kcal/)).toBeInTheDocument()
    expect(screen.getByText('1410 to go')).toBeInTheDocument()
  })

  it('sets up the workout activities in Settings: rename one, add one, remove one', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: false, appIcon: 'ring', charts: ['calories'], workoutKinds: DEFAULT_WORKOUT_KINDS },
      'PUT /api/settings': { hasUsdaKey: false },
      'PUT /api/targets': STORED_GOALS,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const list = await screen.findByRole('list', { name: 'Workout activities' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    const wodName = within(list).getByRole('textbox', { name: 'Name of activity 1' })
    expect(wodName).toHaveValue('WOD')
    await user.clear(wodName)
    await user.type(wodName, 'CrossFit')
    await user.click(within(list).getByRole('button', { name: 'Remove Run' }))
    await user.click(screen.getByRole('button', { name: 'Add activity' }))
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    const added = rows[5]!
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled() // no name yet
    await user.type(within(added).getByRole('textbox', { name: 'Name of activity 6' }), 'Rock climbing')
    await user.selectOptions(within(added).getByRole('combobox', { name: 'Icon for Rock climbing' }), 'mountain')
    const count = within(added).getByRole('textbox', { name: 'Rock climbing (per week)' })
    await user.clear(count)
    await user.type(count, '2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    const settingsPut = calls.findIndex((c) => c.method === 'PUT' && c.url === '/api/settings')
    const targetsPut = calls.findIndex((c) => c.method === 'PUT' && c.url === '/api/targets')
    expect(settingsPut).toBeGreaterThan(-1)
    expect(settingsPut).toBeLessThan(targetsPut) // the activities first, so the plan is checked against them
    const kinds = (calls[settingsPut]!.body as { workoutKinds: { id: string; label: string; icon: string }[] }).workoutKinds
    expect(kinds.map((k) => k.id)).toEqual(['wod', 'weightlifting', 'cycling', 'yoga', 'pilates', 'rock-climbing'])
    expect(kinds[0]).toEqual({ id: 'wod', label: 'CrossFit', icon: 'flame' })
    expect(kinds[5]).toEqual({ id: 'rock-climbing', label: 'Rock climbing', icon: 'mountain' })
    expect((calls[targetsPut]!.body as Goals).workoutPlan).toEqual({ wod: 2, weightlifting: 2, cycling: 0, yoga: 4, pilates: 1, 'rock-climbing': 2 })
  })

  it('still shows a session logged under an activity since removed from Settings, with nothing to log', async () => {
    const kinds = DEFAULT_WORKOUT_KINDS.filter((k) => k.id !== 'run')
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        workouts: {
          ...WORKOUTS_DAY, kinds, plan: { ...PLAN }, weekByKind: { wod: 0, weightlifting: 0, cycling: 0, yoga: 0, pilates: 0 },
          sessions: [{ id: 'w1', date: TODAY, kind: 'run', minutes: null, createdAt: 1 }],
          planned: [], weekSessions: [{ id: 'w1', date: TODAY, kind: 'run', minutes: null, createdAt: 1 }], weekTotal: 1,
        },
      }),
    })
    render(<App />)
    await goTo('Train')
    const card = await screen.findByRole('region', { name: 'Workouts' })
    const rows = within(within(card).getByRole('list', { name: 'This week by activity' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['WOD0 / 2', 'Lifting0 / 2', 'Cycling', 'Yoga0 / 4', 'Pilates0 / 1', 'run1'])
    expect(rows[5]).toHaveClass('unplanned')
    expect(within(card).queryByRole('button', { name: 'Log run' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'run, Today' })).toBeInTheDocument()
  })

  it('edits the default weekly plan, activity by activity, and the meditation goal from Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, meditationMinutes: 15 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const yoga = await screen.findByLabelText('Yoga (per week)')
    expect(yoga).toHaveValue('4')
    expect(screen.getByLabelText('Lifting (per week)')).toHaveValue('2')
    await user.clear(yoga)
    await user.type(yoga, '3.5')
    expect(screen.getByText('A whole number, 0 to 14.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.clear(yoga)
    await user.type(yoga, '3')
    const meditation = screen.getByLabelText('Meditation (minutes per day)')
    await user.clear(meditation)
    await user.type(meditation, '15')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({
      meditationMinutes: 15, workoutPlan: { ...PLAN, yoga: 3 },
    })
  })

  it('undoes the most recent water log', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 32, goal: 72, tea: 0, lastLogId: 'w1' } }),
      'DELETE /api/water/w1': { ok: true },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/water/w1')).toBe(true))
  })

  it('picks the lookup model from the ones LM Studio has, loaded or not', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: false, researchModel: '' },
      'GET /api/lm-models': { models: [{ key: 'qwen/qwen3.8-27b', loaded: false }], error: null },
      'PUT /api/targets': STORED_GOALS,
      'PUT /api/settings': {},
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    await user.selectOptions(await screen.findByLabelText('Model'), 'qwen/qwen3.8-27b')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/settings')!.body).toEqual({ researchModel: 'qwen/qwen3.8-27b' })
  })

  it('shows how much of the logged calories came from alcohol, as part of the calorie bar', async () => {
    const wine = entry({ id: 'w1', meal: 'dinner', name: 'Alcoholic beverage, wine, table, white', nutrients: { calories: 241, protein: 0.2, fat: 0, carbs: 7.6, fiber: 0 } })
    stubApi({
      [`GET /api/day/${TODAY}`]: day([entry(), wine], { totals: { calories: 1200, protein: 0, fat: 0, carbs: 0, fiber: 0 } }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Daily totals' })
    expect(within(card).getByText('1200')).toBeInTheDocument() // the total is what was logged, nothing added
    expect(within(card).getByText('800 left')).toBeInTheDocument()
    expect(within(card).getByText('210 kcal from alcohol')).toBeInTheDocument() // 241 less the wine's carbs and protein
    const bar = within(card).getByRole('progressbar', { name: 'Calories' })
    expect(bar).toHaveAttribute('aria-valuenow', '1200')
    expect(bar).toHaveAttribute('aria-valuetext', '1200, 210 of it from alcohol')
    // 1200 of 2000 fills 60%. The alcohol is the last 210 of that: from 990 (50%) to the end of the fill.
    expect(within(bar).getByTestId('bar-part')).toHaveStyle({ left: '50%', width: '10%' })
  })

  it('takes nothing from the Alcohol card: drinks ticked there add no calories anywhere', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([entry()], {
        alcohol: { drinks: 2, byKind: { beer: 1, wine: 1, liquor: 0 }, calories: 275, weekByKind: { beer: 1, wine: 1, liquor: 0 }, weekTotal: 2, weekGoal: 7, lastLogId: 'a2' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Daily totals' })
    expect(within(card).getByText('190')).toBeInTheDocument()
    expect(within(card).getByText('1810 left')).toBeInTheDocument()
    expect(within(card).queryByText(/from (alcohol|drinks)/)).not.toBeInTheDocument()
    expect(within(card).queryByTestId('bar-part')).not.toBeInTheDocument()
  })

  it('shows the drinks logged today by kind, with no daily goal', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        // weekTotal deliberately differs from drinks, so the two counts can't be confused for each other.
        alcohol: { drinks: 3, byKind: { beer: 1, wine: 2, liquor: 0 }, weekByKind: { beer: 1, wine: 2, liquor: 3 }, weekTotal: 6, weekGoal: 7, calories: 0, lastLogId: 'a3' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    expect(within(card).getByText('3')).toBeInTheDocument()
    expect(within(card).getByText('1 beer · 2 wine')).toBeInTheDocument()
  })

  it('holds the running week total to its own goal, separate from any one day', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        alcohol: { drinks: 1, byKind: { beer: 0, wine: 1, liquor: 0 }, weekByKind: { beer: 0, wine: 1, liquor: 0 }, weekTotal: 5, weekGoal: 7, calories: 0, lastLogId: 'a1' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    const bar = within(card).getByRole('progressbar', { name: 'Drinks this week' })
    expect(bar).toHaveAttribute('aria-valuenow', '5')
    expect(bar).toHaveAttribute('aria-valuemax', '7')
    expect(within(card).getByText('2 left this week')).toBeInTheDocument()
  })

  it("lists the week's drinks by kind, so Sunday's wine still shows on Tuesday", async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        alcohol: { drinks: 1, byKind: { beer: 0, wine: 0, liquor: 1 }, weekTotal: 3, weekByKind: { beer: 0, wine: 2, liquor: 1 }, weekGoal: 7, calories: 100, lastLogId: 'a1' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    expect(within(card).getByText('1 liquor')).toBeInTheDocument() // today
    expect(within(card).getByTestId('week-kinds')).toHaveTextContent('2 wine · 1 liquor') // the week
  })

  it('says how far over the weekly cap it is, once past it', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        alcohol: { drinks: 2, byKind: { beer: 0, wine: 0, liquor: 2 }, weekByKind: { beer: 0, wine: 0, liquor: 2 }, weekTotal: 9, weekGoal: 7, calories: 0, lastLogId: 'a9' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    expect(within(card).getByText('2 over this week')).toBeInTheDocument()
  })

  it('logs a drink of the kind tapped', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/alcohol': { id: 'a1', date: TODAY, kind: 'wine', createdAt: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /\+ Wine/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/alcohol')).toBe(true))
    expect(calls.find((c) => c.url === '/api/alcohol')!.body).toEqual({ date: TODAY, kind: 'wine' })
  })

  it('undoes the last drink', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        alcohol: { drinks: 1, byKind: { beer: 1, wine: 0, liquor: 0 }, weekByKind: { beer: 1, wine: 0, liquor: 0 }, weekTotal: 1, weekGoal: 7, calories: 0, lastLogId: 'a1' },
      }),
      'DELETE /api/alcohol/a1': { ok: true },
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    await user.click(within(card).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/alcohol/a1')).toBe(true))
  })

  it('chooses which charts Week and Month draw, in Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: true, appIcon: 'ring', charts: ['calories', 'protein', 'fiber', 'water'] },
      'PUT /api/targets': STORED_GOALS,
      'PUT /api/settings': { hasUsdaKey: true },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const group = await screen.findByRole('group', { name: 'Charts' })
    await waitFor(() => expect(within(group).getByRole('checkbox', { name: 'Fiber' })).toBeChecked())
    expect(within(group).getByRole('checkbox', { name: 'Carbs' })).not.toBeChecked()
    await user.click(within(group).getByRole('checkbox', { name: 'Carbs' }))
    await user.click(within(group).getByRole('checkbox', { name: 'Fiber' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/settings')!.body).toEqual({ charts: ['calories', 'protein', 'carbs', 'water'] })
  })

  it('picks the app icon in Settings and saves it with the rest', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: true, appIcon: 'ring' },
      'PUT /api/targets': STORED_GOALS,
      'PUT /api/settings': { hasUsdaKey: true, appIcon: 'pillars' },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByRole('radio', { name: 'Ring' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('radio', { name: 'Four pillars' }))
    expect(screen.getByRole('radio', { name: 'Four pillars' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/settings')!.body).toEqual({ appIcon: 'pillars' })
  })

  it('saves goals and never displays the stored USDA key', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'GET /api/settings': { hasUsdaKey: true },
      'PUT /api/targets': STORED_GOALS,
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByPlaceholderText('saved — type to replace')).toHaveValue('')
    const protein = screen.getByLabelText('Protein (g, min)')
    await user.clear(protein)
    await user.type(protein, '128')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ protein: 128, calories: 1800 })
    // No key typed, so the saved one is left alone.
    expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/settings')).toBe(false)
  })

  it('edits the weekly alcohol goal from Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, alcoholWeekly: 4 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const field = await screen.findByLabelText('Alcohol (drinks per week)')
    expect(field).toHaveValue('7')
    await user.clear(field)
    await user.type(field, '4')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ alcoholWeekly: 4 })
  })

  it('judges the day against a calorie cap and floors, with carbs counted but no goal or day type', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]) })
    render(<App />)
    const totals = await screen.findByRole('region', { name: 'Daily totals' })
    expect(within(totals).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(totals).getByText('/ max 2000 kcal', { exact: false })).toBeInTheDocument()
    const carbs = totals.querySelector('.macro.carbs') as HTMLElement
    expect(within(carbs).getByText('No goal')).toBeInTheDocument()
    expect(within(carbs).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(totals.querySelector('.macro.fat') as HTMLElement).getByText(/min 65g/)).toBeInTheDocument()
  })

  it('looks a food up online, then logs it by the serving the source gave', async () => {
    const user = userEvent.setup()
    const bowl: Food = {
      id: 'web:chipotle-bowl', name: 'Chicken Burrito Bowl', brand: 'Chipotle', source: 'web',
      perServing: { label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } },
      sources: [{ title: 'chipotle.com', url: 'https://www.chipotle.com/nutrition-calculator' }],
      note: 'Sum of published per-ingredient values.',
    }
    let polls = 0
    const job = { id: 'j1', query: 'chipotle chicken bowl', startedAt: Date.now() }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'POST /api/research': { ...job, status: 'running', step: 'starting' },
      'GET /api/research/j1': () => (++polls < 2
        ? { ...job, status: 'running', step: 'reading chipotle.com' }
        : { ...job, status: 'done', step: 'done', result: { query: job.query, foods: [bowl], model: 'qwen/qwen3.8-27b', seconds: 74 } }),
      'POST /api/entries': entry(),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'chipotle chicken bowl')
    // No button to catch: it starts by itself once typing pauses.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true), { timeout: 4000 })
    expect(calls.find((c) => c.url === '/api/research')!.body).toEqual({ q: 'chipotle chicken bowl' })

    expect(await screen.findByText(/reading chipotle\.com/, {}, { timeout: 5000 })).toBeInTheDocument()
    expect(chime).not.toHaveBeenCalled()
    await user.click(await screen.findByText('Chicken Burrito Bowl', {}, { timeout: 5000 }))
    // A sound once the write-up is ready, since it takes a while.
    expect(chime).toHaveBeenCalledExactlyOnceWith('done')

    // Per serving, with where the numbers came from.
    expect(screen.getByLabelText('Unit')).toHaveDisplayValue('1 bowl')
    expect(screen.getByRole('link', { name: 'chipotle.com' })).toHaveAttribute('href', 'https://www.chipotle.com/nutrition-calculator')
    await user.clear(screen.getByLabelText('Amount'))
    await user.type(screen.getByLabelText('Amount'), '0.5')
    expect(screen.getByText('330')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Log 0.5 bowl/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/entries')).toBe(true))
    expect(calls.find((c) => c.url === '/api/entries')!.body).toMatchObject({
      name: 'Chicken Burrito Bowl', grams: null, source: 'web',
      perUnit: bowl.perServing!.nutrients, amount: { quantity: 0.5, unit: '1 bowl', unitGrams: null },
    })
  }, 15_000)

  it('corrects a looked-up food\u2019s numbers before logging it, keeping the corrected copy', async () => {
    // The lookup missed the fiber. Fix it right there on the pick screen: the
    // fix is saved (which also corrects the cached lookup) and the entry is
    // logged with the corrected numbers.
    const user = userEvent.setup()
    const bowl: Food = {
      id: 'web:chipotle-bowl', name: 'Chicken Burrito Bowl', brand: 'Chipotle', source: 'web',
      perServing: { label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } },
      sources: [{ title: 'chipotle.com', url: 'https://www.chipotle.com/nutrition-calculator' }],
    }
    const fixed: Food = { ...bowl, perServing: { ...bowl.perServing!, nutrients: { ...bowl.perServing!.nutrients, fiber: 8 } } }
    const job = { id: 'j1', query: 'chipotle chicken bowl', startedAt: Date.now() }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'POST /api/research': { ...job, status: 'running', step: 'starting' },
      'GET /api/research/j1': { ...job, status: 'done', step: 'done', result: { query: job.query, foods: [bowl], model: 'qwen/qwen3.8-27b', seconds: 74 } },
      'POST /api/foods': fixed,
      'POST /api/entries': entry(),
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'chipotle chicken bowl')
    await user.click(await screen.findByText('Chicken Burrito Bowl', {}, { timeout: 5000 }))

    await user.click(screen.getByRole('button', { name: 'Edit nutrition numbers' }))
    expect(screen.getByLabelText('Fiber (g)')).toHaveValue('')
    await user.type(screen.getByLabelText('Fiber (g)'), '8')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject({
      id: 'web:chipotle-bowl', perServing: { label: '1 bowl', nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: 8 } },
    })

    // Back on the pick screen, with the corrected food and the star on.
    expect(await screen.findByLabelText('Unit')).toHaveDisplayValue('1 bowl')
    expect(screen.getByRole('button', { name: 'Save to My foods' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^Log 1 bowl/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/entries')).toBe(true))
    expect(calls.find((c) => c.url === '/api/entries')!.body).toMatchObject({
      name: 'Chicken Burrito Bowl', source: 'web', perUnit: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: 8 },
    })
  }, 15_000)

  it('saves an online lookup result to My foods directly, without logging it', async () => {
    // The whole point: a repeat lookup can cost a minute or two, so a food
    // found online should be keepable without going through Amount/Log.
    const user = userEvent.setup()
    const bowl: Food = {
      id: 'web:chipotle-bowl', name: 'Chicken Burrito Bowl', brand: 'Chipotle', source: 'web',
      perServing: { label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } },
      sources: [{ title: 'chipotle.com', url: 'https://www.chipotle.com/nutrition-calculator' }],
      note: 'Sum of published per-ingredient values.',
    }
    const job = { id: 'j1', query: 'chipotle chicken bowl', startedAt: Date.now() }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'POST /api/research': { ...job, status: 'running', step: 'starting' },
      'GET /api/research/j1': { ...job, status: 'done', step: 'done', result: { query: job.query, foods: [bowl], model: 'qwen/qwen3.8-27b', seconds: 74 } },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'chipotle chicken bowl')
    await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true), { timeout: 4000 })
    await screen.findByText('Chicken Burrito Bowl', {}, { timeout: 5000 })

    await user.click(screen.getByRole('button', { name: 'Save Chicken Burrito Bowl to My foods' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/foods')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/foods')!.body).toMatchObject(bowl)
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument()
    expect(calls.some((c) => c.url === '/api/entries')).toBe(false)
  }, 15_000)

  it('looks an online result up again on request, bypassing the cached answer', async () => {
    const user = userEvent.setup()
    const bowl: Food = {
      id: 'web:chipotle-bowl', name: 'Chicken Burrito Bowl', brand: 'Chipotle', source: 'web',
      perServing: { label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } },
    }
    const job = { id: 'j1', query: 'chipotle chicken bowl', startedAt: Date.now() }
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/search': { usda: [], off: [], errors: [] },
      'POST /api/research': { ...job, status: 'running', step: 'starting' },
      'GET /api/research/j1': { ...job, status: 'done', step: 'done', result: { query: job.query, foods: [bowl], model: 'qwen/qwen3.8-27b', seconds: 74 } },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'chipotle chicken bowl')
    await screen.findByText('Chicken Burrito Bowl', {}, { timeout: 5000 })

    await user.click(screen.getByRole('button', { name: 'Look up again' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/research' && c.method === 'POST')).toHaveLength(2))
    const posts = calls.filter((c) => c.url === '/api/research' && c.method === 'POST')
    expect(posts[0]!.body).toEqual({ q: 'chipotle chicken bowl' })
    expect(posts[1]!.body).toEqual({ q: 'chipotle chicken bowl', refresh: true })
  }, 15_000)

  it('shows a search result as already saved when it matches something already in My foods', async () => {
    const user = userEvent.setup()
    stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/foods': { saved: [banana], recent: [] },
      'GET /api/search': { usda: [banana], off: [], errors: [] },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Add food' }))
    await user.type(await searchBox(user), 'banana')
    // It matches both "Yours" (already saved) and the USDA results for the
    // same query; the USDA copy should read as saved too, by id.
    const usda = await screen.findByRole('region', { name: 'Whole foods' }, { timeout: 2000 })
    expect(within(usda).getByRole('button', { name: 'Remove Bananas, raw from My foods' })).toBeInTheDocument()
  })

  describe('meal presets', () => {
    const eggs: Food = {
      id: 'usda:1', name: 'Eggs', source: 'usda',
      per100g: { calories: 155, protein: 13, fat: 11, carbs: 1.1, fiber: 0 },
    }
    const toastFood: Food = {
      id: 'off:1', name: 'Toast', source: 'off',
      per100g: { calories: 265, protein: 9, fat: 3.2, carbs: 49, fiber: 2.7 },
    }
    const openMineTab = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await user.click(await screen.findByRole('tab', { name: 'My foods' }))
    }

    it('builds a meal from saved foods and saves it', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [eggs, toastFood], recent: [] },
        'GET /api/meals': [],
        'POST /api/meals': { id: 'meal:m1', name: 'Breakfast', items: [{}, {}], createdAt: 0 },
      })
      render(<App />)
      await openMineTab(user)
      await user.click(await screen.findByRole('button', { name: '+ Create meal' }))

      // Picking, not opening either food's own amount screen.
      await user.click(await screen.findByText('Eggs'))
      await user.click(screen.getByText('Toast'))
      expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Next (2)' }))

      // Each food gets its own amount; defaults are enough to save right away.
      expect(screen.getByLabelText('Amount of Eggs')).toHaveValue('100')
      await user.type(screen.getByLabelText('Meal name'), 'Breakfast')
      await user.click(screen.getByRole('button', { name: 'Save meal' }))

      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meals')).toBe(true))
      const body = calls.find((c) => c.method === 'POST' && c.url === '/api/meals')!.body as { name: string; items: { name: string }[] }
      expect(body.name).toBe('Breakfast')
      expect(body.items.map((i) => i.name)).toEqual(['Eggs', 'Toast'])

      // Back on My foods, ready to log without re-fetching.
      expect(await screen.findByText('2 foods')).toBeInTheDocument()
    })

    it('edits a saved meal: rename it, change an amount, drop a food, and save it under the same id', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [eggs, toastFood], recent: [] },
        'GET /api/meals': [{
          id: 'meal:m1', name: 'Breakfast', createdAt: 0,
          items: [
            { name: 'Eggs', foodId: eggs.id, grams: 100, per100g: eggs.per100g, source: 'usda' },
            { name: 'Toast', foodId: toastFood.id, grams: 50, per100g: toastFood.per100g, source: 'off' },
          ],
        }],
        'POST /api/meals': { id: 'meal:m1', name: 'Big breakfast', items: [{}], createdAt: 0 },
      })
      render(<App />)
      await openMineTab(user)
      await user.click(await screen.findByRole('button', { name: 'Edit Breakfast' }))

      // Prefilled with the meal as it was saved.
      expect(screen.getByLabelText('Meal name')).toHaveValue('Breakfast')
      expect(screen.getByLabelText('Amount of Eggs')).toHaveValue('100')
      expect(screen.getByLabelText('Amount of Toast')).toHaveValue('50')

      await user.clear(screen.getByLabelText('Amount of Eggs'))
      await user.type(screen.getByLabelText('Amount of Eggs'), '120')
      await user.click(screen.getByRole('button', { name: 'Remove Toast from this meal' }))
      await user.clear(screen.getByLabelText('Meal name'))
      await user.type(screen.getByLabelText('Meal name'), 'Big breakfast')
      await user.click(screen.getByRole('button', { name: 'Save meal' }))

      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meals')).toBe(true))
      const body = calls.find((c) => c.method === 'POST' && c.url === '/api/meals')!.body as { id?: string; name: string; items: { name: string; grams: number | null }[] }
      expect(body.id).toBe('meal:m1')
      expect(body.name).toBe('Big breakfast')
      expect(body.items).toHaveLength(1)
      expect(body.items[0]).toMatchObject({ name: 'Eggs', grams: 120 })
      expect(await screen.findByText('Big breakfast')).toBeInTheDocument()
    })

    it('adds a food to a saved meal, keeping the name and amounts already entered', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [eggs, toastFood], recent: [] },
        'GET /api/meals': [{
          id: 'meal:m1', name: 'Breakfast', createdAt: 0,
          items: [{ name: 'Eggs', foodId: eggs.id, grams: 100, per100g: eggs.per100g, source: 'usda' }],
        }],
        'POST /api/meals': { id: 'meal:m1', name: 'Breakfast', items: [{}, {}], createdAt: 0 },
      })
      render(<App />)
      await openMineTab(user)
      await user.click(await screen.findByRole('button', { name: 'Edit Breakfast' }))
      await user.clear(screen.getByLabelText('Amount of Eggs'))
      await user.type(screen.getByLabelText('Amount of Eggs'), '120')
      await user.click(screen.getByRole('button', { name: '+ Add foods' }))

      // Picking, with the meal's own food already ticked; add Toast.
      await user.click(screen.getByText('Toast'))
      await user.click(screen.getByRole('button', { name: 'Next (2)' }))
      expect(screen.getByLabelText('Meal name')).toHaveValue('Breakfast')
      expect(screen.getByLabelText('Amount of Eggs')).toHaveValue('120')
      expect(screen.getByLabelText('Amount of Toast')).toHaveValue('100')
      await user.click(screen.getByRole('button', { name: 'Save meal' }))

      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/meals')).toBe(true))
      const body = calls.find((c) => c.method === 'POST' && c.url === '/api/meals')!.body as { id?: string; items: { name: string; grams: number | null }[] }
      expect(body.id).toBe('meal:m1')
      expect(body.items.map((i) => [i.name, i.grams])).toEqual([['Eggs', 120], ['Toast', 100]])
    })

    it('logs every food in a saved meal with one tap', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [], recent: [] },
        'GET /api/meals': [{
          id: 'meal:m1', name: 'Breakfast', createdAt: 0,
          items: [
            { name: 'Eggs', grams: 100, per100g: eggs.per100g, source: 'usda' },
            { name: 'Toast', grams: 50, per100g: toastFood.per100g, source: 'off' },
          ],
        }],
        'POST /api/meals/meal%3Am1/apply': [entry({ name: 'Eggs' }), entry({ name: 'Toast' })],
      })
      render(<App />)
      await openMineTab(user)
      await user.selectOptions(screen.getByLabelText('Meal'), 'lunch')
      await user.click(await screen.findByRole('button', { name: /^Breakfast/ }))

      await waitFor(() => expect(calls.some((c) => c.url === '/api/meals/meal%3Am1/apply')).toBe(true))
      const call = calls.find((c) => c.url === '/api/meals/meal%3Am1/apply')!
      expect(call.body).toEqual({ date: TODAY, meal: 'lunch' })
    })

    it('deletes a saved meal', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [], recent: [] },
        'GET /api/meals': [{ id: 'meal:m1', name: 'Breakfast', createdAt: 0, items: [{ name: 'Eggs', grams: 100, per100g: eggs.per100g, source: 'usda' }] }],
        'DELETE /api/meals/meal%3Am1': { ok: true },
      })
      render(<App />)
      await openMineTab(user)
      await user.click(await screen.findByRole('button', { name: 'Delete Breakfast' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/meals/meal%3Am1')).toBe(true))
      expect(screen.queryByRole('button', { name: /^Breakfast/ })).not.toBeInTheDocument()
    })

    it('cancels picking without creating anything', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/foods': { saved: [eggs], recent: [] },
        'GET /api/meals': [],
      })
      render(<App />)
      await openMineTab(user)
      await user.click(await screen.findByRole('button', { name: '+ Create meal' }))
      await user.click(screen.getByText('Eggs'))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
      // Picking mode is over: the row is back to its normal Saved-list self.
      expect(screen.getByRole('button', { name: 'Remove Eggs from My foods' })).toBeInTheDocument()
      expect(calls.some((c) => c.method === 'POST')).toBe(false)
    })
  })

  it('shows a logged serving the way it was measured, and edits it in that unit', async () => {
    const user = userEvent.setup()
    const served = entry({
      name: 'Orange chicken', grams: 244.5, amount: { quantity: 1.5, unit: '1 cup', unitGrams: 163 },
      per100g: { calories: 196.3, protein: 13.5, fat: 6.1, carbs: 21.5, fiber: null },
    })
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([served]), 'PATCH /api/entries/e1': served })
    render(<App />)
    expect(await screen.findByText('1.5 cup')).toBeInTheDocument()
    await user.click(screen.getByText('Orange chicken'))
    const qty = await screen.findByLabelText('Amount (1 cup)')
    expect(qty).toHaveValue('1.5')
    await user.clear(qty)
    await user.type(qty, '1')
    expect(screen.getByText('320')).toBeInTheDocument() // 196.3 kcal/100 g × 163 g
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ quantity: 1 })
  })

  describe('automatic online lookup', () => {
    const running = (id: string, query: string) => ({ id, query, status: 'running', step: 'starting', startedAt: Date.now() })

    it('starts at once on the keyboard Search key', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/search': { usda: [banana], off: [], errors: [] },
        'POST /api/research': running('j1', 'pad thai'),
      })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await user.type(await searchBox(user), 'pad thai{Enter}')
      await waitFor(() => expect(calls.filter((c) => c.url === '/api/research')).toHaveLength(1), { timeout: 500 })
      expect(await screen.findByText(/Looking it up/)).toBeInTheDocument()
      // Placed above the database results, so they can't push it away.
      const online = screen.getByRole('region', { name: 'Online' })
      const usda = await screen.findByRole('region', { name: 'Whole foods' }, { timeout: 2000 })
      expect(online.compareDocumentPosition(usda) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('cancels a lookup for words you have since changed', async () => {
      const user = userEvent.setup()
      let n = 0
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/search': { usda: [], off: [], errors: [] },
        'POST /api/research': () => (++n === 1 ? running('j1', 'pad') : running('j2', 'pad thai')),
        'DELETE /api/research/j1': { cancelled: true },
      })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      const box = await searchBox(user)
      await user.type(box, 'pad{Enter}')
      await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true))
      await user.type(box, ' thai{Enter}')
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/research/j1')).toBe(true))
      expect(calls.filter((c) => c.url === '/api/research').map((c) => c.body)).toEqual([{ q: 'pad' }, { q: 'pad thai' }])
    })

    it('waits for a button when turned off in Settings', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/settings': { hasUsdaKey: false, hasLmStudioToken: true, lmStudioUrl: '', researchModel: '', autoLookup: false },
        'GET /api/search': { usda: [], off: [], errors: [] },
        'POST /api/research': running('j1', 'pad thai'),
      })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await user.type(await searchBox(user), 'pad thai')
      const button = await screen.findByRole('button', { name: /Look up “pad thai” online/ })
      await new Promise((r) => setTimeout(r, TIMING.autoLookupMs * 4))
      expect(calls.some((c) => c.url === '/api/research')).toBe(false)
      await user.click(button)
      await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true))
    }, 10_000)

    it('never researches a barcode', async () => {
      const user = userEvent.setup()
      const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [], off: [], errors: [], barcode: true } })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await user.type(await searchBox(user), '012345678905{Enter}')
      expect(screen.queryByRole('region', { name: 'Online' })).not.toBeInTheDocument()
      expect(calls.some((c) => c.url === '/api/research')).toBe(false)
    })
  })

  describe('week and month', () => {
    it('switches to Week, fetches the range and shows its label and coverage', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({ loggedDays: 3 }),
      })
      render(<App />)
      await screen.findByText('Today')
      await user.click(screen.getByRole('tab', { name: 'Week' }))
      await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/range'))).toBe(true))
      expect(await screen.findByText(/^Logged 3 of 7 days/)).toBeInTheDocument()
      // The day nav now steps by week: gone is the day-mode "Previous day" button.
      expect(screen.queryByRole('button', { name: 'Previous day' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Previous week' })).toBeInTheDocument()
    })

    it('scores each goal by how many logged days met it, with the mix of day types', async () => {
      const user = userEvent.setup()
      stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({
          loggedDays: 6,
          averages: { calories: 1850, protein: 120, fat: 60, carbs: 180, fiber: 22 },
          scorecard: {
            calories: { met: 4, of: 6 }, protein: { met: 6, of: 6 }, fat: { met: 3, of: 6 }, fiber: { met: 2, of: 6 },
          },
        }),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      const card = await screen.findByRole('region', { name: 'Goals met' })
      expect(within(card).getByText('4 of 6 days')).toBeInTheDocument()
      expect(within(card).getByText('6 of 6 days')).toBeInTheDocument()
      expect(within(card).getByText('2 of 6 days')).toBeInTheDocument()
      expect(within(card).getByRole('progressbar', { name: 'Fat goal met' })).toHaveAttribute('aria-valuenow', '3')
      expect(within(card).getByText(/avg 1850 kcal/)).toBeInTheDocument()
      expect(screen.getByText('Logged 6 of 7 days')).toBeInTheDocument()
      expect(within(card).queryByText(/Carbs/)).not.toBeInTheDocument()
    })

    it('says a calorie range is to be landed in, on the scorecard and the chart', async () => {
      const user = userEvent.setup()
      stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({ goals: { ...GOALS, calories: { min: 1700, max: 2000 } } }),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      const card = await screen.findByRole('region', { name: 'Goals met' })
      expect(within(card).getByText('in range')).toBeInTheDocument()
      expect(screen.queryByText('stay under')).not.toBeInTheDocument()
    })

    it('charts calories, protein and fiber per day -- not whether a day was logged', async () => {
      const user = userEvent.setup()
      const start = startOfWeek(addDays(TODAY, -7)) // last week: every day in it is finished
      stubApi({
        'GET /api/day/': day([]), // any day: the tap at the end opens last week's
        'GET /api/range': range({
          days: [
            {
              date: start, entryCount: 1, water: 0, alcohol: 0, ...DAY_ACTIVITY, goals: GOALS, missing: ZERO,
              totals: { ...ZERO, calories: 2100, protein: 140, fiber: 28 },
            },
            ...Array.from({ length: 6 }, (_, i) => ({
              date: addDays(start, i + 1), entryCount: 0, water: 0, alcohol: 0, ...DAY_ACTIVITY, goals: GOALS, totals: ZERO, missing: ZERO,
            })),
          ],
        }, start),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      // Each bar says whether that day met its own goal: 2100 kcal is over the 2000 cap,
      // 140 g falls short of 150 g, 28 g of 30 g; the unlogged days are marked as such.
      const kcal = await screen.findByRole('button', { name: `${start}: 2100 kcal, goal missed` })
      expect(kcal).toHaveClass('missed')
      expect(within(kcal).getByText('2100')).toBeInTheDocument() // a week prints each value on its bar
      expect(screen.getByRole('button', { name: `${start}: 140 g, goal missed` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${start}: 28 g, goal missed` })).toBeInTheDocument()
      // No bar for a day with nothing logged, rather than one at zero.
      const empty = screen.getByRole('button', { name: `${addDays(start, 1)}: 0 kcal, nothing logged` })
      expect(empty.querySelector('.range-bar')).toBeNull()
      // Only calories, protein, fiber and water are charted; meditation has its day boxes instead.
      expect(document.querySelectorAll('.range-chart-wrap')).toHaveLength(4)
      // In a week a tap goes straight to that day.
      await user.click(kcal)
      expect(await screen.findByRole('tab', { name: 'Day', selected: true })).toBeInTheDocument()
    })

    it("leaves today open rather than calling it a miss, and draws nothing for the days ahead", async () => {
      const user = userEvent.setup()
      const start = startOfWeek(TODAY)
      const base = range()
      stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({
          // Today so far: 90 g protein of a 150 g minimum, 2100 kcal against a 2000 maximum.
          days: base.days.map((d) => (d.date === TODAY ? { ...d, entryCount: 2, totals: { ...ZERO, calories: 2100, protein: 90 } } : d)),
        }),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      expect(await screen.findByRole('button', { name: `${TODAY}: 90 g, in progress` })).toHaveClass('pending')
      expect(screen.getByRole('button', { name: `${TODAY}: 2100 kcal, goal missed` })).toBeInTheDocument() // a max can't be un-passed
      // Tomorrow, when it is in this week, is "still ahead" on all four charts (on a Saturday the week has no tomorrow).
      const tomorrowInWeek = TODAY !== addDays(start, 6)
      // Counted on the charts' own columns: the workout and meditation boxes label their future days the same way.
      const ahead = document.querySelectorAll(`.range-col.future[aria-label="${addDays(TODAY, 1)}: still ahead"]`)
      expect(ahead).toHaveLength(tomorrowInWeek ? 4 : 0)
    })

    it('in a month, a tap shows that day in the chart headers and a second tap opens it', async () => {
      const user = userEvent.setup()
      const monthStart = `${addDays(TODAY, -40).slice(0, 8)}01` // a month that is over
      const days = Array.from({ length: 28 }, (_, i) => ({
        date: addDays(monthStart, i), entryCount: i === 2 ? 1 : 0, water: 0, alcohol: 0, ...DAY_ACTIVITY,
        goals: GOALS, missing: ZERO, totals: i === 2 ? { ...ZERO, calories: 1900, protein: 160 } : ZERO,
      }))
      const calls = stubApi({
        'GET /api/day/': day([]),
        'GET /api/range': { ...range({ days, totalDays: 28, averagedDays: 28, averages: { ...ZERO, calories: 1900 } }), start: monthStart, end: addDays(monthStart, 27) },
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Month' }))
      const third = addDays(monthStart, 2)
      const point = await screen.findByRole('button', { name: `${third}: 1900 kcal, goal met` })
      expect(point.querySelector('.range-dot')).not.toBeNull() // a month is points on a line, not bars
      expect(screen.getByText('avg 1900 kcal')).toBeInTheDocument()
      await user.click(point)
      // Every chart's header now reads that day; nothing has navigated yet.
      expect(screen.getByText(/· 1900 kcal · goal met$/)).toBeInTheDocument()
      expect(screen.getByText(/· 160 g · goal met$/)).toBeInTheDocument()
      expect(calls.some((c) => c.url === `/api/day/${third}`)).toBe(false)
      await user.click(point)
      await waitFor(() => expect(calls.some((c) => c.url === `/api/day/${third}`)).toBe(true))
    })

    it('scores water by the days it was logged on, and charts it per day', async () => {
      const user = userEvent.setup()
      const start = startOfWeek(addDays(TODAY, -7)) // last week: every day in it is finished
      const base = range({}, start)
      stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({
          water: { total: 224, average: 32, met: 2, of: 3 },
          days: base.days.map((d, i) => ({ ...d, water: [96, 96, 32, 0, 0, 0, 0][i]! })),
        }, start),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      const card = await screen.findByRole('region', { name: 'Water' })
      expect(within(card).getByText('2 of 3 days')).toBeInTheDocument()
      expect(within(card).getByRole('progressbar', { name: 'Water goal met' })).toHaveAttribute('aria-valuenow', '2')
      expect(within(card).getByText(/224 oz total · 32 oz avg\/day · 4 days with none logged/)).toBeInTheDocument()
      // The water chart judges each day on its own, like the nutrients.
      expect(screen.getByRole('button', { name: `${start}: 96 oz, goal met` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${addDays(start, 2)}: 32 oz, goal missed` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${addDays(start, 3)}: 0 oz, nothing logged` })).toBeInTheDocument()
    })

    it('shows a box per day: filled for a workout or both sits, half for one sit, empty for none', async () => {
      const user = userEvent.setup()
      // Last week, so no day in it is still ahead, whatever today is.
      const start = startOfWeek(addDays(TODAY, -7))
      const base = range({}, start)
      const goals = { ...GOALS, meditationMinutes: 50 }
      const calls = stubApi({
        'GET /api/day/': day([]),
        'GET /api/range': range({
          goals,
          workouts: { sessions: 3, days: 2, minutes: 85, kinds: DEFAULT_WORKOUT_KINDS, byKind: { ...NO_KINDS, wod: 2, run: 1 }, goalByKind: PLAN, goal: 9 },
          meditation: { total: 75, average: 10.7, days: 2, met: 1, of: 2, streak: 0 },
          days: base.days.map((d, i) => ({
            ...d, goals, workouts: [2, 0, 1, 0, 0, 0, 0][i]!, meditationMinutes: [0, 50, 25, 0, 0, 0, 0][i]!,
          })),
        }, start),
      })
      render(<App />)
      await goTo('Train', 'Week')
      const workouts = await screen.findByRole('region', { name: 'Workouts' })
      expect(within(workouts).queryByRole('progressbar')).not.toBeInTheDocument()
      expect(within(workouts).getByRole('button', { name: `${start}: 2 workouts` })).toHaveClass('full')
      expect(within(workouts).getByRole('button', { name: `${addDays(start, 1)}: no workout` })).toHaveClass('empty')
      expect(within(workouts).getByText('Worked out 2 of 7 days so far')).toBeInTheDocument()
      // Each activity against its goal for the week, planned or not.
      expect(within(workouts).getByText('3 of 9')).toBeInTheDocument()
      const byActivity = within(workouts).getByRole('list', { name: 'Workouts by activity' })
      expect(within(byActivity).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'WOD2 of 2', 'Lifting0 of 2', 'Run1 of 0', 'Yoga0 of 4', 'Pilates0 of 1',
      ])
      expect(within(workouts).getByText('85 min logged')).toBeInTheDocument()
      const meditation = screen.getByRole('region', { name: 'Meditation' })
      expect(within(meditation).queryByRole('progressbar')).not.toBeInTheDocument()
      expect(within(meditation).getByRole('button', { name: `${addDays(start, 1)}: 2 sits, 50 min` })).toHaveClass('full')
      expect(within(meditation).getByRole('button', { name: `${addDays(start, 2)}: 1 sit, 25 min` })).toHaveClass('half')
      expect(within(meditation).getByRole('button', { name: `${start}: no meditation` })).toHaveClass('empty')
      // Tapping a box opens that day.
      await user.click(within(meditation).getByRole('button', { name: `${addDays(start, 2)}: 1 sit, 25 min` }))
      await waitFor(() => expect(calls.some((c) => c.url === `/api/day/${addDays(start, 2)}`)).toBe(true))
    })

    it("shows the dog's walks as day boxes: full for every walk, half for some, with the miles", async () => {
      const start = startOfWeek(addDays(TODAY, -7))
      const base = range({}, start)
      stubApi({
        'GET /api/day/': day([]),
        'GET /api/range': range({
          dog: { walks: 3, miles: 3, days: 2, met: 1, of: 2, streak: 0 },
          days: base.days.map((d, i) => ({ ...d, dogWalks: [2, 1, 0, 0, 0, 0, 0][i]!, dogMiles: [2, 1, 0, 0, 0, 0, 0][i]! })),
        }, start),
      })
      render(<App />)
      await goTo('Train', 'Week')
      const dog = await screen.findByRole('region', { name: 'Dog walks' })
      expect(within(dog).getByText('1 of 2 days')).toBeInTheDocument()
      expect(within(dog).getByRole('button', { name: `${start}: 2 walks, 2 miles` })).toHaveClass('full')
      expect(within(dog).getByRole('button', { name: `${addDays(start, 1)}: 1 walk, 1 mile` })).toHaveClass('half')
      expect(within(dog).getByRole('button', { name: `${addDays(start, 2)}: no walks` })).toHaveClass('empty')
      expect(within(dog).getByText('3 walks · 3 miles')).toBeInTheDocument()
    })

    it('draws the days still ahead faintly, never as misses', async () => {
      const start = startOfWeek(addDays(TODAY, 7)) // next week: every day is ahead
      stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/range': range({}, start) })
      render(<App />)
      await goTo('Train', 'Week')
      const workouts = await screen.findByRole('region', { name: 'Workouts' })
      expect(within(workouts).getByRole('button', { name: `${start}: still ahead` })).toHaveClass('future')
    })

    it('draws only the charts chosen in Settings, in the usual order', async () => {
      const user = userEvent.setup()
      stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/range': range({ charts: ['fat', 'carbs', 'water'] }) })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      await screen.findByText(/^Logged 0 of 7 days/)
      expect([...document.querySelectorAll('.range-chart-label')].map((el) => el.textContent)).toEqual(['Fat', 'Carbs', 'Water'])
    })

    it('says when averages cover only the finished days of a range', async () => {
      const user = userEvent.setup()
      stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/range': range({ loggedDays: 3, averagedDays: 3 }) })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      expect(await screen.findByText(/averages over 3 finished days/)).toBeInTheDocument()
    })

    it('says nothing about alcohol when none was logged in the range', async () => {
      const user = userEvent.setup()
      stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/range': range() })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      await screen.findByText(/^Logged 0 of 7 days/)
      expect(screen.queryByRole('region', { name: 'Alcohol' })).not.toBeInTheDocument()
    })

    it('shows the drink count and kind breakdown when something was logged', async () => {
      const user = userEvent.setup()
      stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range({ alcohol: { total: 3, average: 0.4, calories: 400, byKind: { beer: 1, wine: 2, liquor: 0 } } }),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      const alcohol = await screen.findByRole('region', { name: 'Alcohol' })
      expect(within(alcohol).getByText('3 drinks')).toBeInTheDocument()
      expect(within(alcohol).getByText(/0.4 avg\/day · 400 kcal/)).toBeInTheDocument()
      expect(within(alcohol).getByText('1 beer, 2 wine')).toBeInTheDocument()
    })

    it('jumps to Day view on the date a bar is tapped', async () => {
      const user = userEvent.setup()
      // The week's first day -- always in range, unlike "yesterday", which
      // would fall in the *previous* week on a Monday.
      const target = startOfWeek(TODAY)
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        [`GET /api/day/${target}`]: day([], { date: target }),
        'GET /api/range': range(),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      await screen.findByText(/^Logged 0 of 7 days/)
      // One bar per chart (calories, protein, fiber) shares this date; any of them jumps to it.
      const [bar] = screen.getAllByRole('button', { name: new RegExp(`^${target}`) })
      await user.click(bar!)
      await waitFor(() => expect(calls.some((c) => c.url === `/api/day/${target}`)).toBe(true))
      expect(await screen.findByRole('tab', { name: 'Day', selected: true })).toBeInTheDocument()
    })

    it('switches to Month and fetches a month-shaped range', async () => {
      const user = userEvent.setup()
      const calls = stubApi({
        [`GET /api/day/${TODAY}`]: day([]),
        'GET /api/range': range(),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Month' }))
      await waitFor(() => expect(calls.some((c) => c.url.startsWith('/api/range'))).toBe(true))
      expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    })
  })

  describe('train', () => {
    const wodView = (id: string, name: string) => ({ id, name, minutes: 12, heading: '5 rounds for time', lines: ['10 push-ups', '12 cal bike'], swaps: [], focus: ['upper' as const, 'bike' as const] })
    const training = (over: Partial<TrainingDay> = {}): TrainingDay => ({
      date: TODAY,
      schema: { id: 's1', name: 'Sample block', status: 'active', startDate: '2026-11-02', endDate: '2026-11-29', weeks: 4, firstWeek: 1, basedOn: null, createdAt: 1, rewriteFrom: null },
      draft: null, week: 2, deload: false, test: false, repeat: false, adjustments: [],
      sessions: [
        {
          id: 'legs', title: 'Legs', kind: 'weightlifting', done: false, items: [
            {
              id: 'back-squat', name: 'Back squat', lift: 'squat', type: 'sets', done: false, notes: 'Pins just below the bottom.',
              sets: [0, 1].map((index) => ({ index, reps: 5, seconds: null, weight: 75, log: null })),
            },
            { id: 'mobility', name: 'Hip mobility', type: 'check', done: false },
          ],
        },
        { id: 'wod-wed', title: 'WOD', kind: 'wod', done: false, items: [{ id: 'wod-slot', name: 'Short WOD', type: 'wod', done: false, wod: { slot: { maxMinutes: 15 }, chosen: null, picks: [wodView('core-spin', 'Core Spin'), wodView('renegade', 'Renegade')] } }] },
      ],
      strip: Array.from({ length: 7 }, (_, i) => ({ date: addDays(TODAY, i - 2), sessions: i === 2 ? [{ id: 'legs', title: 'Legs', kind: 'weightlifting', done: false, started: false }] : [] })),
      lifts: [{ id: 'squat', name: 'Back squat', increment: 5, pr: 100, prDate: '2026-10-01' }],
      ...over,
    })
    const openTrain = async (routes: Record<string, unknown>, view?: 'Week' | 'Block' | 'Library') => {
      const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/training/generate': { status: 'idle', startedAt: null, draftId: null, error: null }, ...routes })
      const user = userEvent.setup()
      render(<App />)
      await goTo('Train', view)
      return { calls, user }
    }

    it('lists the WODs by place in the Library, and opens a movement from one', async () => {
      const { user } = await openTrain({
        'GET /api/training/schemas/s1': { summary: {}, schema: { wods: [{ id: 'cindy', name: 'Cindy', format: 'amrap', minutes: 20, parts: [{ move: 'pull-up', amount: 5 }, { move: 'push-up', amount: 10 }, { move: 'air-squat', amount: 15 }] }], hiddenWods: [] }, lifts: [] },
        'GET /api/training': training(),
        'GET /api/settings': { hasUsdaKey: false, workoutKinds: DEFAULT_WORKOUT_KINDS, equipment: { gear: [], dumbbells: [], kettlebells: [], places: [
          { name: 'Living room', gear: ['bike', 'dumbbells', 'ab-mat'], dumbbells: [15, 20, 25, 30], kettlebells: [] },
          { name: 'Garage', gear: ['barbell', 'plates', 'rack', 'pullup-bar', 'rings', 'bands', 'jump-rope'], dumbbells: [], kettlebells: [] },
        ] } },
      }, 'Library')
      expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
      const cindy = (await screen.findAllByText(/^Cindy/))[0]!.closest('.wod') as HTMLElement
      expect(within(cindy).getByText('Yours')).toBeInTheDocument()
      expect(within(cindy).getByText('· Garage')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Garage' }))
      expect(screen.queryAllByText(/^Renegade/)).toEqual([])
      expect(screen.getAllByText(/^Partner-free Fran-ish/).length).toBeGreaterThan(0)
      await user.click(within(cindy).getByRole('button', { name: '5 pull-ups' }))
      expect(await screen.findByRole('button', { name: /Pull-ups/, expanded: true })).toBeInTheDocument()
      expect(screen.getByText(/Hang from the bar with straight arms/)).toBeInTheDocument()
    })

    it('keeps the day on screen, faded and untappable, while the next one loads', async () => {
      let release!: () => void
      const next = new Promise<TrainingDay>((r) => { release = () => r(training({ date: addDays(TODAY, 1) })) })
      const { user } = await openTrain({ [`GET /api/day/${addDays(TODAY, 1)}`]: { ...day([]), date: addDays(TODAY, 1) }, [`GET /api/training?date=${addDays(TODAY, 1)}`]: () => next, 'GET /api/training': training() })
      const legs = await screen.findByRole('region', { name: 'Legs' })
      await user.click(screen.getByRole('button', { name: 'Next day' }))
      // Still there, not blanked: the trackers below don't jump up into its place.
      expect(screen.getByRole('region', { name: 'Legs' })).toBe(legs)
      expect(legs.closest('.settling')).toHaveAttribute('aria-busy', 'true')
      release()
      await waitFor(() => expect(screen.getByRole('region', { name: 'Legs' }).closest('.settling')).toHaveAttribute('aria-busy', 'false'))
    })

    it("shows the day's sessions set by set, and ticks a set with the planned numbers", async () => {
      const { calls, user } = await openTrain({ 'GET /api/training': training(), 'PUT /api/training/sets': { day: training(), newPr: null } })
      const legs = await screen.findByRole('region', { name: 'Legs' })
      expect(screen.getByText('Week 2 of 4')).toBeInTheDocument()
      await user.click(within(legs).getByRole('button', { name: 'Set 1: 5 × 75 lb' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/training/sets')).toBe(true))
      expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/training/sets')!.body).toEqual({ date: TODAY, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 75, seconds: null, done: true })
    })

    it('takes what was actually lifted, and offers a beaten PR', async () => {
      const { calls, user } = await openTrain({ 'GET /api/training': training(), 'PUT /api/training/sets': { day: training(), newPr: { lift: 'squat', name: 'Back squat', weight: 105 } } })
      const legs = await screen.findByRole('region', { name: 'Legs' })
      await user.click(within(legs).getByRole('button', { name: 'Change what you did in set 2' }))
      const weight = within(legs).getByLabelText('Weight (lb)')
      await user.clear(weight)
      await user.type(weight, '105')
      await user.clear(within(legs).getByLabelText('Reps'))
      await user.type(within(legs).getByLabelText('Reps'), '1')
      await user.click(within(legs).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/training/sets')?.body).toEqual({ date: TODAY, itemId: 'back-squat', setIndex: 1, reps: 1, weight: 105, seconds: null, done: true }))
      expect(await screen.findByText('105 lb beats your Back squat PR')).toBeInTheDocument()
    })

    it('picks a WOD from the ones that fit', async () => {
      const { calls, user } = await openTrain({ 'GET /api/training': training(), 'PUT /api/training/wod': training() })
      const wod = await screen.findByRole('region', { name: 'WOD' })
      expect(within(wod).getByText('Core Spin')).toBeInTheDocument()
      await user.click(within(wod).getByRole('button', { name: 'Do Renegade' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/training/wod')?.body).toEqual({ date: TODAY, itemId: 'wod-slot', wodId: 'renegade' }))
    })

    it('sets a new PR and says what it did to today\'s weights', async () => {
      const after = training()
      after.sessions[0]!.items[0]!.sets = after.sessions[0]!.items[0]!.sets!.map((x) => ({ ...x, weight: 80 }))
      let fetched = 0
      const { calls, user } = await openTrain({
        'GET /api/training': () => (fetched++ === 0 ? training() : after),
        'PUT /api/training/lifts': { id: 'squat', name: 'Back squat', increment: 5, pr: 110, prDate: TODAY },
      }, 'Block')
      const prs = await screen.findByRole('region', { name: 'PRs' })
      await user.click(within(prs).getByRole('button', { name: 'Change Back squat PR' }))
      const input = within(prs).getByLabelText('Back squat PR (lb)')
      await user.clear(input)
      await user.type(input, '110')
      await user.click(within(prs).getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/training/lifts/squat')?.body).toEqual({ pr: 110, date: TODAY }))
      expect(await screen.findByText("Back squat PR 110 lb: today's back squat 75 → 80 lb")).toBeInTheDocument()
    })

    it('follows a reviewed draft', async () => {
      const draft = { id: 'd1', name: 'Block 2', status: 'draft' as const, startDate: '2026-11-30', endDate: '2026-12-27', weeks: 4, firstWeek: 1 as const, basedOn: 's1', createdAt: 2, rewriteFrom: null }
      const overview = (name: string, top: number) => ({
        summary: draft, schema: { name, goals: 'Squat up: every week was done.', days: [{ weekday: 1, sessions: [{ title: 'Legs' }] }] },
        lifts: [{ itemId: 'back-squat', name: 'Back squat', lift: 'squat', weeks: [{ week: 1, text: '5×5 @ 70', top: 70 }, { week: 2, text: '5×5 @ 75', top }] }],
      })
      const { calls, user } = await openTrain({
        'GET /api/training/schemas/d1': overview('Block 2', 85),
        'GET /api/training/schemas/s1': overview('Sample block', 75),
        'GET /api/training': training({ draft }),
        'POST /api/training/schemas/d1/activate': draft,
      }, 'Block')
      const card = await screen.findByRole('region', { name: 'Training plan' })
      await user.click(within(card).getByRole('button', { name: 'Review it' }))
      expect(await within(card).findByText('70 → 85 lb')).toBeInTheDocument()
      expect(within(card).getByText('70 → 75 lb')).toBeInTheDocument()
      await user.click(within(card).getByRole('button', { name: 'Follow it' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/training/schemas/d1/activate')).toBe(true))
    })

    it("opens on Nutrition, with no training on its day; Train has the day's sessions and workouts", async () => {
      const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([], { workouts: { ...WORKOUTS_DAY, planned: ['Legs', 'Yoga'] } }), 'GET /api/training': training() })
      render(<App />)
      expect(await screen.findByRole('button', { name: 'Nutrition' })).toHaveAttribute('aria-current', 'page')
      await screen.findByRole('region', { name: 'Water' })
      expect(screen.queryByRole('region', { name: 'Workouts' })).not.toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Meditation' })).not.toBeInTheDocument()
      expect(screen.queryByText(/Legs \+ Yoga/)).not.toBeInTheDocument()
      await goTo('Train')
      expect(await screen.findByRole('region', { name: 'Legs' })).toBeInTheDocument()
      expect(calls.some((c) => c.url === `/api/training?date=${TODAY}`)).toBe(true)
      expect(screen.getByRole('region', { name: 'Workouts' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Train' })).toHaveAttribute('aria-current', 'page')
    })

    it('talks with the coach: a starter asks, a proposal shows what it would do, and Apply applies it', async () => {
      const proposal = { edits: [{ op: 'move', sessionId: 'legs', from: TODAY, to: addDays(TODAY, 2) }], preview: ['Mon → Wed: Legs'] }
      const asked = [
        { id: 'u1', role: 'user', text: 'How is my training going?', proposal: null, status: null, note: null, createdAt: 1 },
        { id: 'a1', role: 'assistant', text: 'Steady so far. Want to move legs to Wednesday?', proposal, status: 'proposed', note: null, createdAt: 2 },
      ]
      const applied = asked.map((m) => (m.id === 'a1' ? { ...m, status: 'applied' } : m))
      const { calls, user } = await openTrain({
        'GET /api/training/chat': { messages: [], busy: false },
        'POST /api/training/chat/a1/apply': { messages: applied, day: training() },
        'POST /api/training/chat/a1/undo': { messages: asked.map((m) => (m.id === 'a1' ? { ...m, status: 'undone' } : m)), day: training() },
        'POST /api/training/chat': { messages: asked },
        'GET /api/training': training(),
      })
      await user.click(await screen.findByRole('button', { name: 'Coach' }))
      const log = await screen.findByRole('log', { name: 'Conversation with the coach' })
      await user.click(within(log).getByRole('button', { name: 'How is my training going?' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/training/chat')?.body).toEqual({ message: 'How is my training going?', today: TODAY }))
      expect(await within(log).findByText('Steady so far. Want to move legs to Wednesday?')).toBeInTheDocument()
      const card = within(log).getByLabelText('Proposed change')
      expect(within(card).getByText('Mon → Wed: Legs')).toBeInTheDocument()
      await user.click(within(card).getByRole('button', { name: 'Apply' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/training/chat/a1/apply')).toBe(true))
      expect(await within(card).findByText('Applied')).toBeInTheDocument()
      await user.click(within(card).getByRole('button', { name: 'Undo' }))
      expect(await within(card).findByText('Undone')).toBeInTheDocument()
    })

    it("asks the coach from Block's box, which opens the coach with the question", async () => {
      const { calls, user } = await openTrain({
        'GET /api/training/chat': { messages: [], busy: false },
        'POST /api/training/chat': { messages: [{ id: 'a1', role: 'assistant', text: 'Here is how I would do it.', proposal: null, status: null, note: null, createdAt: 1 }] },
        'GET /api/training': training(),
      }, 'Block')
      expect(await screen.findByRole('button', { name: 'Write the next block' })).toBeInTheDocument()
      await user.type(await screen.findByRole('textbox', { name: 'Ask the coach' }), 'Make yoga optional')
      await user.click(screen.getByRole('button', { name: 'Ask' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/training/chat')?.body).toEqual({ message: 'Make yoga optional', today: TODAY }))
      expect(await screen.findByText('Here is how I would do it.')).toBeInTheDocument()
    })

    it('clears the conversation for a fresh start, after asking', async () => {
      const said = [{ id: 'u1', role: 'user', text: 'Old question', proposal: null, status: null, note: null, stats: null, image: false, createdAt: 1 }]
      const { calls, user } = await openTrain({ 'GET /api/training/chat': { messages: said, busy: false }, 'DELETE /api/training/chat': { messages: [] }, 'GET /api/training': training() })
      vi.spyOn(window, 'confirm').mockReturnValue(true)
      await user.click(await screen.findByRole('button', { name: 'Coach' }))
      expect(await screen.findByText('Old question')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Clear chat' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/training/chat')).toBe(true))
      expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/starts fresh/))
      await waitFor(() => expect(screen.queryByText('Old question')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'How is my training going?' })).toBeInTheDocument()
    })

    it('attaches a screenshot to a message for the coach', async () => {
      const { calls, user } = await openTrain({
        'GET /api/training/chat': { messages: [], busy: false },
        'POST /api/training/chat': { messages: [{ id: 'a1', role: 'assistant', text: 'I see Thursday.', proposal: null, status: null, note: null, stats: null, image: false, createdAt: 1 }] },
        'GET /api/training': training(),
      })
      await user.click(await screen.findByRole('button', { name: 'Coach' }))
      const file = new File(['png'], 'shot.png', { type: 'image/png' })
      await user.upload(await screen.findByLabelText('Screenshot file'), file)
      expect(await screen.findByAltText('Screenshot to send')).toBeInTheDocument()
      await user.type(screen.getByLabelText('Message the coach'), 'this day')
      await user.click(screen.getByRole('button', { name: 'Send' }))
      await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url === '/api/training/chat')?.body).toEqual({ message: 'this day', today: TODAY, image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }))
      expect(await screen.findByText('I see Thursday.')).toBeInTheDocument()
    })

    it("sends a typed message, and shows the coach's one-off changes on the day with an undo", async () => {
      const { calls, user } = await openTrain({
        'GET /api/training/chat': { messages: [], busy: false },
        'POST /api/training/chat': { messages: [{ id: 'a1', role: 'assistant', text: 'Rest well.', proposal: null, status: null, note: null, createdAt: 1 }] },
        'DELETE /api/training/overrides/o1': { ok: true },
        'GET /api/training': training({ adjustments: [{ id: 'o1', text: 'Legs moved here from Mon, Nov 2' }] }),
      })
      expect(await screen.findByText('Legs moved here from Mon, Nov 2')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Undo: Legs moved here from Mon, Nov 2' }))
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/training/overrides/o1')).toBe(true))
      await user.click(screen.getByRole('button', { name: 'Coach' }))
      await user.type(await screen.findByLabelText('Message the coach'), 'I slept badly')
      await user.click(screen.getByRole('button', { name: 'Send' }))
      expect(await screen.findByText('Rest well.')).toBeInTheDocument()
      expect(calls.find((c) => c.method === 'POST' && c.url === '/api/training/chat')?.body).toEqual({ message: 'I slept badly', today: TODAY })
    })

    it("lays out the week's plan day by day, with the week's workouts, and opens a day from it", async () => {
      const { calls, user } = await openTrain({ 'GET /api/training': training(), 'GET /api/range': range() }, 'Week')
      const plan = await screen.findByRole('region', { name: "The week's plan" })
      expect(within(plan).getAllByRole('button')).toHaveLength(7)
      expect(await screen.findByRole('region', { name: 'Workouts' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Goals met' })).not.toBeInTheDocument() // Nutrition's
      expect(calls.some((c) => c.url.startsWith('/api/range?start='))).toBe(true)
      await user.click(within(plan).getByRole('button', { name: 'Open Today' }))
      expect(await screen.findByRole('region', { name: 'Legs' })).toBeInTheDocument()
    })

    it('explains how to start when there is no schema', async () => {
      await openTrain({ 'GET /api/training': training({ schema: null, week: null, sessions: [], strip: [], lifts: [] }) })
      expect(await screen.findByText(/No training plan yet/)).toBeInTheDocument()
    })
  })
})
