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
})
