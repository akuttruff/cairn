import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RESEARCH_PLUGIN, ResearchJobs, chooseModel, extractJson, researchFood, toFoods } from './research.ts'
import type { Settings } from '../src/types.ts'

const SETTINGS: Settings = { usdaApiKey: '', lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: 'sk-lm-T', researchModel: '' }

const BOWL_REPLY = {
  found: true,
  items: [{
    name: 'Chicken Burrito Bowl', brand: 'Chipotle',
    serving: { label: '1 bowl', grams: null },
    nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null },
    other_servings: [], source_url: 'https://www.chipotle.com/nutrition-calculator',
  }],
  note: 'Sum of published per-ingredient values.',
}

const ORANGE_CHICKEN = {
  found: true,
  items: [{
    name: 'Mandarin Orange Chicken', brand: "Trader Joe's",
    serving: { label: '1 cup', grams: 163 },
    nutrients: { calories: 320, protein: 22, fat: 10, carbs: 35, fiber: null },
    other_servings: [{ label: '1 package', grams: 624 }],
    source_url: 'https://foods.fatsecret.com/x',
  }],
  note: '',
}

const MODELS = {
  models: [
    { type: 'embedding', key: 'nomic', loaded_instances: [{ id: 'nomic' }] },
    { type: 'llm', key: 'qwen/qwen3.8-27b', loaded_instances: [{ id: 'qwen/qwen3.8-27b' }], capabilities: { reasoning: { allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'] } } },
  ],
}

const sse = (events: object[]): Response => {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      c.close()
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

/** LM Studio stand-in: models list, then a chat that streams `reply`. */
function lmStudio(reply: string, extra: object[] = []) {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify(MODELS), { status: 200 })
    return sse([...extra, { type: 'message.delta', content: reply }, { type: 'chat.end', result: {} }])
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('extractJson', () => {
  it('finds the object in a fenced block with prose around it', () => {
    expect(extractJson('Here you go:\n```json\n{"found": true}\n```\nEnjoy')).toEqual({ found: true })
  })
  it('finds a bare object', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 })
  })
  it('returns null for no JSON', () => {
    expect(extractJson('I could not find it.')).toBeNull()
  })
})

describe('toFoods', () => {
  it('keeps a weightless serving as per-serving nutrition, with its source', () => {
    const { foods, note } = toFoods(BOWL_REPLY, 'burrito bowl')
    expect(foods).toHaveLength(1)
    const [bowl] = foods
    expect(bowl!.perServing).toEqual({ label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } })
    expect(bowl!.per100g).toBeUndefined()
    expect(bowl!.sources).toEqual([{ title: 'chipotle.com', url: 'https://www.chipotle.com/nutrition-calculator' }])
    expect(bowl!.source).toBe('web')
    expect(note).toMatch(/per-ingredient/)
  })

  it('turns a weighed serving into per-100g values and servings', () => {
    const [food] = toFoods(ORANGE_CHICKEN, 'q').foods
    expect(food!.per100g!.calories).toBe(196.32)
    expect(food!.servings).toEqual([{ label: '1 cup', grams: 163 }, { label: '1 package', grams: 624 }])
  })

  it('drops items without calories or with impossible values', () => {
    const { foods } = toFoods({
      found: true,
      items: [
        { name: 'no calories', nutrients: { protein: 5 } },
        { name: 'negative', nutrients: { calories: -5 } },
        { name: 'ok', nutrients: { calories: 100, protein: 'lots' } },
      ],
    }, 'q')
    expect(foods.map((f) => f.name)).toEqual(['ok'])
    expect(foods[0]!.perServing!.nutrients.protein).toBeNull()
    expect(foods[0]!.perServing!.label).toBe('1 serving')
  })

  it('ignores a non-http source link', () => {
    const [food] = toFoods({ found: true, items: [{ name: 'x', nutrients: { calories: 1 }, source_url: 'javascript:alert(1)' }] }, 'q').foods
    expect(food!.sources).toBeUndefined()
  })

  it('reports not found', () => {
    expect(toFoods({ found: false, items: [], note: 'nothing' }, 'q')).toEqual({ foods: [], note: 'nothing' })
  })
})

describe('chooseModel', () => {
  it('uses the loaded LLM, not an embedding model, with reasoning off', async () => {
    const { fetchImpl } = lmStudio('')
    expect(await chooseModel(SETTINGS, fetchImpl)).toEqual({ model: 'qwen/qwen3.8-27b', reasoning: 'off' })
  })

  it('prefers the model chosen in Settings', async () => {
    const { fetchImpl } = lmStudio('')
    expect((await chooseModel({ ...SETTINGS, researchModel: 'other/model' }, fetchImpl)).model).toBe('other/model')
  })

  it('explains when nothing is loaded or LM Studio is down', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch
    await expect(chooseModel(SETTINGS, empty)).rejects.toThrow(/No model is loaded/)
    const down = vi.fn(async () => { throw new TypeError('ECONNREFUSED') }) as unknown as typeof fetch
    await expect(chooseModel(SETTINGS, down)).rejects.toThrow(/Couldn't reach LM Studio/)
  })
})

describe('researchFood', () => {
  it('asks LM Studio with the deep-research plugin and parses the answer', async () => {
    const { fetchImpl, calls } = lmStudio(`Based on the menu:\n\`\`\`json\n${JSON.stringify(BOWL_REPLY)}\n\`\`\``)
    const steps: string[] = []
    const result = await researchFood('chipotle chicken bowl', SETTINGS, {
      fetchImpl, onStep: (s) => steps.push(s),
    })
    const chat = calls.find((c) => c.url.endsWith('/api/v1/chat'))!
    expect(chat.body).toMatchObject({
      model: 'qwen/qwen3.8-27b', reasoning: 'off', input: 'Food: chipotle chicken bowl',
      integrations: [{ type: 'plugin', id: RESEARCH_PLUGIN }],
    })
    expect(result.foods[0]!.name).toBe('Chicken Burrito Bowl')
    expect(result.model).toBe('qwen/qwen3.8-27b')
    expect(steps).toContain('starting')
  })

  it('reports what it is reading as it goes', async () => {
    const { fetchImpl } = lmStudio(JSON.stringify(BOWL_REPLY), [
      { type: 'prompt_processing.start' },
      { type: 'tool_call.name', tool_name: 'research' },
      { type: 'tool_call.arguments', arguments: { url: 'https://www.chipotle.com/nutrition' } },
      { type: 'prompt_processing.start' },
    ])
    const steps: string[] = []
    await researchFood('q', SETTINGS, { fetchImpl, onStep: (s) => steps.push(s) })
    expect(steps).toEqual(expect.arrayContaining(['reading the request', 'searching the web', 'reading chipotle.com', 'reading what it found']))
    expect(steps.indexOf('reading what it found')).toBeGreaterThan(steps.indexOf('searching the web'))
  })

  it('fails clearly when the answer is not JSON', async () => {
    const { fetchImpl } = lmStudio('Sorry, I could not find that.')
    await expect(researchFood('q', SETTINGS, { fetchImpl })).rejects.toThrow(/expected format/)
  })

  it('explains a missing MCP plugin', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith('/models')
      ? new Response(JSON.stringify(MODELS))
      : new Response(JSON.stringify({ error: { message: 'Plugin mcp/deep-research not found.' } }), { status: 400 }))) as unknown as typeof fetch
    await expect(researchFood('q', SETTINGS, { fetchImpl })).rejects.toThrow(/mcp\.json/)
  })
})

describe('ResearchJobs', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0))

  it('runs a lookup in the background and keeps the result', async () => {
    const { fetchImpl } = lmStudio(JSON.stringify(BOWL_REPLY))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    const job = jobs.start('chipotle bowl')
    expect(job.status).toBe('running')
    await vi.waitFor(() => expect(jobs.get(job.id)!.status).toBe('done'))
    expect(jobs.get(job.id)!.result!.foods).toHaveLength(1)
  })

  it('answers a repeat from cache without asking LM Studio again', async () => {
    const { fetchImpl, calls } = lmStudio(JSON.stringify(BOWL_REPLY))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    const first = jobs.start('Chipotle bowl')
    await vi.waitFor(() => expect(jobs.get(first.id)!.status).toBe('done'))
    const chats = calls.filter((c) => c.url.endsWith('/chat')).length
    const again = jobs.start('  chipotle   BOWL ')
    expect(again.status).toBe('done')
    expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats)
  })

  it("keeps finished lookups on disk, so a restart doesn't repeat them", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-lookups-'))
    try {
      const file = path.join(dir, 'lookups.json')
      const { fetchImpl, calls } = lmStudio(JSON.stringify(BOWL_REPLY))
      const first = new ResearchJobs(() => SETTINGS, fetchImpl, file)
      const job = first.start('chipotle bowl')
      await vi.waitFor(() => expect(first.get(job.id)!.status).toBe('done'))
      expect((fs.statSync(file).mode & 0o777).toString(8)).toBe('600')

      const chats = calls.filter((c) => c.url.endsWith('/chat')).length
      const restarted = new ResearchJobs(() => SETTINGS, fetchImpl, file)
      const again = restarted.start('Chipotle Bowl')
      expect(again.status).toBe('done')
      expect(again.result!.foods[0]!.name).toBe('Chicken Burrito Bowl')
      expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('joins a lookup already running for the same food', () => {
    const { fetchImpl } = lmStudio(JSON.stringify(BOWL_REPLY))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    expect(jobs.start('bowl').id).toBe(jobs.start('Bowl').id)
  })

  it('limits how many run at once', () => {
    const hang = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const jobs = new ResearchJobs(() => SETTINGS, hang)
    jobs.start('a')
    jobs.start('b')
    expect(() => jobs.start('c')).toThrow(/already running/)
  })

  it('cancels', async () => {
    const hang = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })) as unknown as typeof fetch
    const jobs = new ResearchJobs(() => SETTINGS, hang)
    const job = jobs.start('a')
    await settle()
    expect(jobs.cancel(job.id)).toBe(true)
    await vi.waitFor(() => expect(jobs.get(job.id)).toMatchObject({ status: 'error', error: 'Cancelled.' }))
  })
})
