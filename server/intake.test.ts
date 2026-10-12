import { describe, it, expect, vi } from 'vitest'
import { IntakeJobs, LABEL_PROMPT, PARSE_PROMPT, parseDescription, readLabel, toItems } from './intake.ts'
import type { ResearchJobs, ResearchResult } from './research.ts'
import type { Food, Settings } from '../src/types.ts'

const SETTINGS = { lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: 't', researchModel: '', notesModel: '' } as Settings
const MODELS = (vision = true) => ({ models: [
  { type: 'llm', key: 'qwen/qwen3.8-27b', loaded_instances: [{ id: 'qwen/qwen3.8-27b' }], capabilities: { vision, reasoning: { allowed_options: ['off', 'low', 'on'] } } },
] })

const sse = (events: object[]): Response => {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      c.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** LM Studio stand-in: the models list, then a chat that streams `reply`. */
function lmStudio(reply: string, vision = true) {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify(MODELS(vision)), { status: 200 })
    return sse([{ type: 'message.delta', content: reply }, { type: 'chat.end', result: {} }])
  }) as unknown as typeof fetch
  return { fetchImpl, calls, chat: () => calls.find((c) => c.url.endsWith('/api/v1/chat'))!.body! }
}

const PHOTO = { dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }
const LABEL_REPLY = JSON.stringify({
  found: true,
  items: [{ name: 'Crunchy Peanut Butter', brand: 'Kirkland', serving: { label: '2 Tbsp', grams: 32 },
    nutrients: { calories: 190, protein: 8, fat: 16, carbs: 7, fiber: 3 },
    other_servings: [{ label: '1 container', grams: 1130 }], source_url: null }],
  note: 'The sodium line was blurry.',
})

describe('readLabel', () => {
  it('shows the model the photo, and makes the label a food of your own with its servings', async () => {
    const lm = lmStudio(LABEL_REPLY)
    const out = await readLabel(PHOTO, 'Kirkland peanut butter', SETTINGS, lm.fetchImpl)
    const body = lm.chat()
    expect(body.system_prompt).toBe(LABEL_PROMPT)
    expect(body.reasoning).toBe('off')
    expect(body.integrations).toBeUndefined()
    expect(body.input).toEqual([
      { type: 'text', content: 'Read this nutrition label. The product is: Kirkland peanut butter' },
      { type: 'image', data_url: PHOTO.dataUrl },
    ])
    expect(out.model).toBe('qwen/qwen3.8-27b')
    expect(out.note).toBe('The sodium line was blurry.')
    const food = out.foods[0]!
    expect(food).toMatchObject({ name: 'Crunchy Peanut Butter', brand: 'Kirkland', source: 'custom', sources: undefined })
    expect(food.id).toMatch(/^label:/)
    expect(food.perServing).toEqual({ label: '2 Tbsp', grams: 32, nutrients: { calories: 190, protein: 8, fat: 16, carbs: 7, fiber: 3 } })
    expect(food.servings).toEqual([{ label: '2 Tbsp', grams: 32 }, { label: '1 container', grams: 1130 }])
    expect(food.per100g?.calories).toBe(593.75)
  })

  it('says when there is no label in the picture', async () => {
    const lm = lmStudio(JSON.stringify({ found: false, items: [], note: 'A photo of a dog.' }))
    const out = await readLabel(PHOTO, '', SETTINGS, lm.fetchImpl)
    expect(out.foods).toEqual([])
    expect(out.note).toBe('A photo of a dog.')
    expect((lm.chat().input as { content?: string }[])[0]!.content).toBe('Read this nutrition label.')
  })

  it('refuses up front when the chosen model cannot see', async () => {
    const lm = lmStudio(LABEL_REPLY, false)
    await expect(readLabel(PHOTO, '', SETTINGS, lm.fetchImpl)).rejects.toThrow(/can't look at pictures/)
    expect(lm.calls.some((c) => c.url.endsWith('/api/v1/chat'))).toBe(false)
  })

  it('fails clearly when the answer is not JSON', async () => {
    const lm = lmStudio('I see a jar of peanut butter.')
    await expect(readLabel(PHOTO, '', SETTINGS, lm.fetchImpl)).rejects.toThrow(/expected format/)
  })
})

describe('toItems', () => {
  it('keeps what can be looked up and fills in a quantity of one', () => {
    expect(toItems({ items: [
      { text: '2 eggs', food: 'large egg', brand: null, quantity: 2, unit: null, grams: null },
      { text: 'a cup of rice', food: 'cooked white rice', quantity: 1, unit: 'cup' },
      { text: 'TJ orange chicken', food: 'Mandarin Orange Chicken', brand: "Trader Joe's", quantity: 150, unit: 'g', grams: 150 },
      { text: 'something', food: '' },
      null,
      { text: 'no quantity', food: 'banana', quantity: -2 },
    ] })).toEqual([
      { text: '2 eggs', food: 'large egg', brand: undefined, quantity: 2, unit: null, grams: null },
      { text: 'a cup of rice', food: 'cooked white rice', brand: undefined, quantity: 1, unit: 'cup', grams: null },
      { text: 'TJ orange chicken', food: 'Mandarin Orange Chicken', brand: "Trader Joe's", quantity: 150, unit: 'g', grams: 150 },
      { text: 'no quantity', food: 'banana', brand: undefined, quantity: 1, unit: null, grams: null },
    ])
  })

  it('gives nothing for an answer with no items', () => {
    expect(toItems({ found: true })).toEqual([])
    expect(toItems(null)).toEqual([])
  })
})

describe('parseDescription', () => {
  it('asks the model to split the words, with no research tool and reasoning off', async () => {
    const lm = lmStudio(JSON.stringify({ items: [{ text: '2 eggs', food: 'large egg', quantity: 2, unit: null, grams: null }] }))
    const out = await parseDescription('  2 eggs ', SETTINGS, lm.fetchImpl)
    const body = lm.chat()
    expect(body.system_prompt).toBe(PARSE_PROMPT)
    expect(body.input).toBe('Eaten: 2 eggs')
    expect(body.integrations).toBeUndefined()
    expect(body.reasoning).toBe('off')
    expect(out.items).toHaveLength(1)
    expect(out.model).toBe('qwen/qwen3.8-27b')
  })
})

const egg: Food = { id: 'web:egg', name: 'Egg, large', source: 'web', per100g: { calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7, fiber: 0 }, servings: [{ label: '1 large', grams: 50 }] }
const result = (query: string, foods: Food[], note?: string): ResearchResult => ({ query, foods, note, model: 'm', seconds: 1 })

/** The research jobs as the intake sees them: one awaitable lookup per food. */
function fakeResearch(answers: Record<string, ResearchResult | Error>, delayMs = 0) {
  const lookups: string[] = []
  const research = {
    lookup: vi.fn(async (query: string, options: { signal?: AbortSignal; onStep?: (s: string) => void } = {}) => {
      lookups.push(query)
      options.onStep?.('searching the web')
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      if (options.signal?.aborted) throw options.signal.reason
      const a = answers[query]
      if (a instanceof Error) throw a
      if (!a) throw new Error(`unexpected lookup ${query}`)
      return a
    }),
  } as unknown as ResearchJobs
  return { research, lookups }
}

const settle = async (jobs: IntakeJobs, id: string, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    const j = jobs.get(id)!
    if (j.status !== 'running') return j
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('still running')
}

describe('IntakeJobs', () => {
  it('splits the words, looks each food up in turn, and keeps every answer', async () => {
    const lm = lmStudio(JSON.stringify({ items: [
      { text: '2 eggs', food: 'large egg', quantity: 2, unit: null },
      { text: 'orange chicken', food: 'Mandarin Orange Chicken', brand: "Trader Joe's", quantity: 1, unit: 'cup' },
      { text: 'a mystery', food: 'mystery dish', quantity: 1 },
    ] }))
    const { research, lookups } = fakeResearch({
      'large egg': result('large egg', [egg]),
      "Trader Joe's Mandarin Orange Chicken": result('tj', [], 'Nothing reliable.'),
      'mystery dish': new Error('The lookup took too long and was stopped.'),
    })
    const jobs = new IntakeJobs(research, () => SETTINGS, lm.fetchImpl)
    const started = jobs.start('2 eggs, orange chicken and a mystery')
    expect(started.status).toBe('running')
    expect(started.step).toBe('reading your description')
    const job = await settle(jobs, started.id)
    expect(job.status).toBe('done')
    expect(job.model).toBe('qwen/qwen3.8-27b')
    // The brand goes into the lookup when the food name does not already carry it.
    expect(lookups).toEqual(['large egg', "Trader Joe's Mandarin Orange Chicken", 'mystery dish'])
    expect(job.items.map((i) => [i.text, i.status])).toEqual([['2 eggs', 'done'], ['orange chicken', 'done'], ['a mystery', 'error']])
    expect(job.items[0]).toMatchObject({ quantity: 2, unit: null, foods: [egg] })
    expect(job.items[1]).toMatchObject({ foods: [], note: 'Nothing reliable.' })
    expect(job.items[2]!.error).toMatch(/too long/)
  })

  it('says so when the words hold no food', async () => {
    const lm = lmStudio(JSON.stringify({ items: [] }))
    const jobs = new IntakeJobs(fakeResearch({}).research, () => SETTINGS, lm.fetchImpl)
    const job = await settle(jobs, jobs.start('hello there').id)
    expect(job.status).toBe('error')
    expect(job.error).toMatch(/Couldn't find any foods/)
  })

  it('cancels, and stops looking things up', async () => {
    const lm = lmStudio(JSON.stringify({ items: [
      { text: 'eggs', food: 'large egg', quantity: 2 }, { text: 'toast', food: 'sourdough bread', quantity: 1 },
    ] }))
    const { research, lookups } = fakeResearch({ 'large egg': result('large egg', [egg]), 'sourdough bread': result('b', []) }, 40)
    const jobs = new IntakeJobs(research, () => SETTINGS, lm.fetchImpl)
    const started = jobs.start('eggs and toast')
    // Let the split finish and the first lookup begin.
    for (let i = 0; i < 50 && jobs.get(started.id)!.items.length === 0; i++) await new Promise((r) => setTimeout(r, 5))
    expect(jobs.cancel(started.id)).toBe(true)
    const job = await settle(jobs, started.id)
    expect(job).toMatchObject({ status: 'error', error: 'Cancelled.' })
    await new Promise((r) => setTimeout(r, 100))
    expect(lookups).toEqual(['large egg'])
    expect(jobs.cancel(started.id)).toBe(false)
  })

  it('works out one description at a time', async () => {
    const lm = lmStudio(JSON.stringify({ items: [{ text: 'eggs', food: 'large egg', quantity: 2 }] }))
    const { research } = fakeResearch({ 'large egg': result('large egg', [egg]) }, 100)
    const jobs = new IntakeJobs(research, () => SETTINGS, lm.fetchImpl)
    const first = jobs.start('eggs')
    expect(() => jobs.start('more eggs')).toThrow(/already being worked out/)
    jobs.cancel(first.id)
  })

  it('knows nothing of a made-up id', () => {
    const jobs = new IntakeJobs(fakeResearch({}).research, () => SETTINGS, lmStudio('').fetchImpl)
    expect(jobs.get('nope')).toBeUndefined()
  })
})
