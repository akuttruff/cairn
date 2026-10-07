import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { dayLabel } from './lib/format.ts'
import App from './App.tsx'
import { addDays, localDate, startOfWeek } from './lib/nutrition.ts'
import type { DayView, Entry, Food, Goals, RangeView } from './types.ts'

const TODAY = localDate()
const RANGE = (n: number): { min: number; max: number } => ({ min: n, max: n })
const GOALS = {
  calories: RANGE(2000), protein: RANGE(150), fat: RANGE(65), carbs: RANGE(200),
  fiber: 30, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1,
}
/** Lifting 2, yoga 4, pilates 1, WOD 2 a week -- 9 sessions. */
const PLAN = { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 }
const NO_KINDS = { wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 0, pilates: 0 }
/** A day's workouts: nothing today, nothing yet this week, on the default plan. */
const WORKOUTS_DAY = {
  sessions: [], minutes: 0, weekStart: startOfWeek(TODAY), plan: PLAN, planIsCustom: false, weekByKind: NO_KINDS,
  weekTotal: 0, weekGoal: 9, lastLogId: null, weekSessions: [],
}
/** What Settings edits and /api/goals returns -- separate shape from GOALS above (a resolved, per-day view). */
const STORED_GOALS: Goals = {
  protein: 130, fat: 60, carbs: 160, trainingCarbs: 35, trainingWater: 32, calorieBuffer: 100, fiber: 30, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1, workoutPlan: PLAN,
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
  date: TODAY, entries, goals: GOALS, dayType: 'training',
  totals: { calories: 190, protein: 6.5, fat: 3.4, carbs: 33, fiber: 5 },
  missing: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
  water: { ounces: 0, goal: 96, lastLogId: null },
  alcohol: { drinks: 0, byKind: { beer: 0, wine: 0, liquor: 0 }, weekTotal: 0, weekGoal: 7, calories: 0, lastLogId: null },
  workouts: WORKOUTS_DAY,
  meditation: { sessions: [], minutes: 0, goal: 10, lastLogId: null },
  dog: { walks: [], miles: 0, goal: 2, walkMiles: 1, lastLogId: null },
  body: { weight: null, bodyFat: null, leanMass: null, bmi: null },
  ...over,
})

const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }

/** A week starting `start` (default: the Monday on or before today), mostly untouched. */
const NO_SCORE = { calories: { met: 0, of: 0 }, protein: { met: 0, of: 0 }, fat: { met: 0, of: 0 }, carbs: { met: 0, of: 0 }, fiber: { met: 0, of: 0 } }

const range = (over: Partial<RangeView> = {}, start = startOfWeek(TODAY)): RangeView => ({
  start, end: addDays(start, 6), goals: GOALS, dayTypes: { training: 7, rest: 0 }, scorecard: NO_SCORE, charts: ['calories', 'protein', 'fiber', 'water'], totalDays: 7, loggedDays: 0, averagedDays: 7,
  totals: ZERO, averages: ZERO,
  water: { total: 0, average: 0, met: 0, of: 0 }, alcohol: { total: 0, average: 0, calories: 0, byKind: { beer: 0, wine: 0, liquor: 0 } },
  workouts: { sessions: 0, days: 0, minutes: 0, byKind: NO_KINDS, goalByKind: PLAN, goal: 9 },
  meditation: { total: 0, average: 0, days: 0, met: 0, of: 0, streak: 0 },
  dog: { walks: 0, miles: 0, days: 0, met: 0, of: 0, streak: 0 },
  body: { weight: null, bodyFat: null, leanMass: null, bmi: null },
  days: Array.from({ length: 7 }, (_, i) => ({
    date: addDays(start, i), entryCount: 0, water: 0, alcohol: 0, ...DAY_ACTIVITY, dayType: 'training' as const, goals: GOALS, totals: ZERO, missing: ZERO,
  })),
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
    expect(screen.getByText('1810 left')).toBeInTheDocument() // calories are a max: so much left, not "to go"
    expect(within(screen.getByRole('region', { name: 'Breakfast' })).getByText('Oats')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Fiber' })).toHaveAttribute('aria-valuenow', '5')
  })

  it('lists the goals to reach (protein, fiber) above the ones to stay under (carbs, fat)', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]) })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Daily totals' })
    const names = [...card.querySelectorAll('.macro-grid .macro-name')].map((el) => el.textContent)
    expect(names).toEqual(['Protein', 'Fiber', 'Carbs', 'Fat'])
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

  it('flags going over on carbs and fat, which are maxes, but not on protein or fiber, which are mins', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { totals: { calories: 1000, protein: 200, fat: 100, carbs: 250, fiber: 45 } }) })
    render(<App />)
    await screen.findByText('Today')
    expect(screen.getByRole('progressbar', { name: 'Carbs' })).toHaveClass('over')
    expect(screen.getByRole('progressbar', { name: 'Fat' })).toHaveClass('over')
    expect(screen.getByRole('progressbar', { name: 'Protein' })).not.toHaveClass('over')
    expect(screen.getByRole('progressbar', { name: 'Fiber' })).not.toHaveClass('over')
    // Each goal says which way it points, and the line under it says where the day stands.
    expect(screen.getByText('/ max 65g')).toBeInTheDocument()
    expect(screen.getByText('35 g over')).toBeInTheDocument() // fat 100 against 65
    expect(screen.getByText('/ min 150g')).toBeInTheDocument()
    expect(screen.getAllByText('Goal met')).toHaveLength(2) // protein 200 >= 150, fiber 45 >= 30
  })

  it('counts down to a min that has not been reached yet', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { totals: { calories: 500, protein: 90, fat: 20, carbs: 50, fiber: 12 } }) })
    render(<App />)
    expect(await screen.findByText('60 g to go')).toBeInTheDocument() // protein 90 of 150
    expect(screen.getByText('18 g to go')).toBeInTheDocument() // fiber 12 of 30
    expect(screen.getByText('45 g left')).toBeInTheDocument() // fat 20 of a 65 max
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
    const box = await screen.findByLabelText('Search foods')
    expect(box).toHaveAttribute('autocomplete', 'off')
    await user.type(box, 'banana')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByLabelText('Search foods')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Add food' }))
    expect(await screen.findByLabelText('Search foods')).toHaveValue('')
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
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
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
    const post = calls.find((c) => c.method === 'POST')!
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
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
    await user.click(await screen.findByText('Bananas, raw', {}, { timeout: 2000 }))
    await user.selectOptions(screen.getByLabelText('Unit'), 'oz')
    await user.click(screen.getByRole('button', { name: /^Log 1 oz/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
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
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
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
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
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
    await user.type(await screen.findByLabelText('Search foods'), 'tjs hummus')
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
    await user.type(await screen.findByLabelText('Search foods'), 'granola')
    expect(await screen.findByLabelText("Numbers don't add up", {}, { timeout: 2000 })).toBeInTheDocument()
    await user.click(screen.getByText('Granola'))
    expect(screen.getByRole('status')).toHaveTextContent(/may have a typo/)
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

  it('deletes an entry', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([entry()]), 'DELETE /api/entries/e1': { ok: true } })
    render(<App />)
    await user.click(await screen.findByText('Oats'))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/entries/e1')).toBe(true))
  })

  it('shows water logged against the goal, in ounces and bottles', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 64, goal: 96, lastLogId: 'w2' } }) })
    render(<App />)
    expect(await screen.findByRole('region', { name: 'Water' })).toBeInTheDocument()
    expect(screen.getByText('2 of 3 bottles (32oz each)')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Water' })).toHaveAttribute('aria-valuenow', '64')
  })

  it('logs a bottle of water with one tap', async () => {
    const user = userEvent.setup()
    const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'POST /api/water': { id: 'w1', date: TODAY, ounces: 32, createdAt: 1 } })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /Bottle \(32oz\)/ }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/water')).toBe(true))
    expect(calls.find((c) => c.method === 'POST' && c.url === '/api/water')!.body).toEqual({ date: TODAY, ounces: 32 })
  })

  it('undoes the most recent water log, only once one exists', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 0, goal: 96, lastLogId: null } }) })
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
          weekSessions: [
            { id: 'w1', date: TODAY, kind: 'run', minutes: 30, createdAt: 3 },
            { id: 'w0', date: twoAgo, kind: 'weightlifting', minutes: null, createdAt: 1 },
          ],
        },
      }),
      'POST /api/workouts': { id: 'w2', date: TODAY, kind: 'wod', minutes: null, createdAt: 2 },
    })
    render(<App />)
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
          weekSessions: [{ id: 'w1', date: TODAY, kind: 'yoga', minutes: null, createdAt: 1 }],
        },
      }),
      'POST /api/workouts': { id: 'w2', date: TODAY, kind: 'cycling', minutes: null, createdAt: 2 },
      'DELETE /api/workouts/w1': { ok: true },
    })
    render(<App />)
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
    const card = await screen.findByRole('region', { name: 'Dog walks' })
    expect(within(card).getByRole('button', { name: /\+ 1\.5-mile walk/ })).toBeInTheDocument()
    expect(within(card).getByText('No walks yet today')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
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

  it('edits the extra water a training day asks for, in Settings', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, trainingWater: 24 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const field = await screen.findByLabelText('Extra water on training days (oz)')
    expect(field).toHaveValue('32')
    await user.clear(field)
    await user.type(field, '24')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ trainingWater: 24 })
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

  it('edits the calorie buffer in Settings, with the goal it makes shown as you type', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([]),
      'GET /api/targets': STORED_GOALS,
      'PUT /api/targets': { ...STORED_GOALS, calorieBuffer: 150 },
    })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    const field = await screen.findByLabelText('Calorie buffer (kcal)')
    expect(field).toHaveValue('100')
    expect(screen.getByText(/Every day: 1800 kcal/)).toHaveTextContent('(1700 from the macros + 100 buffer)')
    await user.clear(field)
    await user.type(field, '150')
    expect(screen.getByText(/Every day: 1850 kcal/)).toHaveTextContent('Training days: 1990 kcal')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === '/api/targets')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT' && c.url === '/api/targets')!.body).toMatchObject({ calorieBuffer: 150 })
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
      [`GET /api/day/${TODAY}`]: day([], { water: { ounces: 32, goal: 96, lastLogId: 'w1' } }),
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
        alcohol: { drinks: 2, byKind: { beer: 1, wine: 1, liquor: 0 }, calories: 275, weekTotal: 2, weekGoal: 7, lastLogId: 'a2' },
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
        alcohol: { drinks: 3, byKind: { beer: 1, wine: 2, liquor: 0 }, weekTotal: 6, weekGoal: 7, calories: 0, lastLogId: 'a3' },
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
        alcohol: { drinks: 1, byKind: { beer: 0, wine: 1, liquor: 0 }, weekTotal: 5, weekGoal: 7, calories: 0, lastLogId: 'a1' },
      }),
    })
    render(<App />)
    const card = await screen.findByRole('region', { name: 'Alcohol' })
    const bar = within(card).getByRole('progressbar', { name: 'Drinks this week' })
    expect(bar).toHaveAttribute('aria-valuenow', '5')
    expect(bar).toHaveAttribute('aria-valuemax', '7')
    expect(within(card).getByText('2 left this week')).toBeInTheDocument()
  })

  it('says how far over the weekly cap it is, once past it', async () => {
    stubApi({
      [`GET /api/day/${TODAY}`]: day([], {
        alcohol: { drinks: 2, byKind: { beer: 0, wine: 0, liquor: 2 }, weekTotal: 9, weekGoal: 7, calories: 0, lastLogId: 'a9' },
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
        alcohol: { drinks: 1, byKind: { beer: 1, wine: 0, liquor: 0 }, weekTotal: 1, weekGoal: 7, calories: 0, lastLogId: 'a1' },
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
    // The calorie math follows along as you type: 128*4 + 60*9 + 160*4, and +35 g carbs on training days.
    expect(screen.getByText(/Every day: 1792 kcal \(1692 from the macros \+ 100 buffer\)\. Training days: 1932 kcal with 195 g carbs\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true))
    expect(calls.find((c) => c.method === 'PUT')!.body).toMatchObject({ protein: 128, trainingCarbs: 35 })
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

  it('ticks a day as a training day, and unticks it back to a rest day', async () => {
    const user = userEvent.setup()
    const calls = stubApi({
      [`GET /api/day/${TODAY}`]: day([], { dayType: 'rest' }),
      [`PUT /api/day-type/${TODAY}`]: { date: TODAY, type: 'training' },
    })
    render(<App />)
    const box = await screen.findByRole('checkbox', { name: /WOD \/ weightlifting day/ })
    expect(box).not.toBeChecked()
    expect(screen.getByText(/rest-day goals · 2000 kcal/)).toBeInTheDocument()
    await user.click(box)
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url === `/api/day-type/${TODAY}`)).toBe(true))
    expect(calls.find((c) => c.url === `/api/day-type/${TODAY}`)!.body).toEqual({ type: 'training' })
  })

  it('shows a marked training day as ticked, with its goals named', async () => {
    stubApi({ [`GET /api/day/${TODAY}`]: day([], { dayType: 'training' }) })
    render(<App />)
    expect(await screen.findByRole('checkbox', { name: /WOD \/ weightlifting day/ })).toBeChecked()
    expect(screen.getByText(/training goals · 2000 kcal/)).toBeInTheDocument()
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
    await user.type(await screen.findByLabelText('Search foods'), 'chipotle chicken bowl')
    // No button to catch: it starts by itself once typing pauses.
    await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true), { timeout: 4000 })
    expect(calls.find((c) => c.url === '/api/research')!.body).toEqual({ q: 'chipotle chicken bowl' })

    expect(await screen.findByText(/reading chipotle\.com/, {}, { timeout: 5000 })).toBeInTheDocument()
    await user.click(await screen.findByText('Chicken Burrito Bowl', {}, { timeout: 5000 }))

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
    await user.type(await screen.findByLabelText('Search foods'), 'chipotle chicken bowl')
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
    await user.type(await screen.findByLabelText('Search foods'), 'chipotle chicken bowl')
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
    await user.type(await screen.findByLabelText('Search foods'), 'banana')
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
      await user.type(await screen.findByLabelText('Search foods'), 'pad thai{Enter}')
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
      const box = await screen.findByLabelText('Search foods')
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
      await user.type(await screen.findByLabelText('Search foods'), 'pad thai')
      const button = await screen.findByRole('button', { name: /Look up “pad thai” online/ })
      await new Promise((r) => setTimeout(r, 2300))
      expect(calls.some((c) => c.url === '/api/research')).toBe(false)
      await user.click(button)
      await waitFor(() => expect(calls.some((c) => c.url === '/api/research')).toBe(true))
    }, 10_000)

    it('never researches a barcode', async () => {
      const user = userEvent.setup()
      const calls = stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/search': { usda: [], off: [], errors: [], barcode: true } })
      render(<App />)
      await user.click(await screen.findByRole('button', { name: 'Add food' }))
      await user.type(await screen.findByLabelText('Search foods'), '012345678905{Enter}')
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
          loggedDays: 6, dayTypes: { training: 3, rest: 4 },
          averages: { calories: 1850, protein: 120, fat: 60, carbs: 180, fiber: 22 },
          scorecard: {
            calories: { met: 4, of: 6 }, protein: { met: 6, of: 6 }, fat: { met: 3, of: 6 }, carbs: { met: 5, of: 6 }, fiber: { met: 2, of: 6 },
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
      expect(screen.getByText('Logged 6 of 7 days · 3 training, 4 rest')).toBeInTheDocument()
    })

    it('charts calories, protein and fiber per day -- not whether a day was logged', async () => {
      const user = userEvent.setup()
      const start = startOfWeek(addDays(TODAY, -7)) // last week: every day in it is finished
      stubApi({
        'GET /api/day/': day([]), // any day: the tap at the end opens last week's
        'GET /api/range': range({
          days: [
            {
              date: start, entryCount: 1, water: 0, alcohol: 0, ...DAY_ACTIVITY, dayType: 'training' as const, goals: GOALS, missing: ZERO,
              totals: { ...ZERO, calories: 2100, protein: 140, fiber: 28 },
            },
            ...Array.from({ length: 6 }, (_, i) => ({
              date: addDays(start, i + 1), entryCount: 0, water: 0, alcohol: 0, ...DAY_ACTIVITY, dayType: 'training' as const, goals: GOALS, totals: ZERO, missing: ZERO,
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
        date: addDays(monthStart, i), entryCount: i === 2 ? 1 : 0, water: 0, alcohol: 0, ...DAY_ACTIVITY, dayType: 'rest' as const,
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
          workouts: { sessions: 3, days: 2, minutes: 85, byKind: { ...NO_KINDS, wod: 2, run: 1 }, goalByKind: PLAN, goal: 9 },
          meditation: { total: 75, average: 10.7, days: 2, met: 1, of: 2, streak: 0 },
          days: base.days.map((d, i) => ({
            ...d, goals, workouts: [2, 0, 1, 0, 0, 0, 0][i]!, meditationMinutes: [0, 50, 25, 0, 0, 0, 0][i]!,
          })),
        }, start),
      })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
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
      const user = userEvent.setup()
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
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
      const dog = await screen.findByRole('region', { name: 'Dog walks' })
      expect(within(dog).getByText('1 of 2 days')).toBeInTheDocument()
      expect(within(dog).getByRole('button', { name: `${start}: 2 walks, 2 miles` })).toHaveClass('full')
      expect(within(dog).getByRole('button', { name: `${addDays(start, 1)}: 1 walk, 1 mile` })).toHaveClass('half')
      expect(within(dog).getByRole('button', { name: `${addDays(start, 2)}: no walks` })).toHaveClass('empty')
      expect(within(dog).getByText('3 walks · 3 miles')).toBeInTheDocument()
    })

    it('draws the days still ahead faintly, never as misses', async () => {
      const user = userEvent.setup()
      const start = startOfWeek(addDays(TODAY, 7)) // next week: every day is ahead
      stubApi({ [`GET /api/day/${TODAY}`]: day([]), 'GET /api/range': range({}, start) })
      render(<App />)
      await user.click(await screen.findByRole('tab', { name: 'Week' }))
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
})
