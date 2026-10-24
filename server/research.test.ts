import { describe, it, expect, vi } from 'vitest'
import { RESEARCH_PLUGIN, ResearchJobs, chooseModel, extractJson, listLlms, lmEvents, normalizeQuery, researchFood, toFoods } from './research.ts'
import type { LookupStore } from './research.ts'
import { DEFAULT_WORKOUT_KINDS } from '../src/types.ts'
import type { Settings } from '../src/types.ts'

const SETTINGS: Settings = { usdaApiKey: '', lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: 'sk-lm-T', researchModel: '', notesModel: '', labelModel: '', preferredModel: '', autoLookup: true, appIcon: 'ring', charts: ['calories', 'protein', 'fiber', 'water'], workoutKinds: DEFAULT_WORKOUT_KINDS }

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

describe('lmEvents', () => {
  const stream = (chunks: string[], onCancel: () => void): ReadableStream<Uint8Array> => {
    const enc = new TextEncoder()
    let i = 0
    return new ReadableStream({
      pull(c) { if (i < chunks.length) c.enqueue(enc.encode(chunks[i++])); else c.close() },
      cancel: onCancel,
    })
  }

  it('yields data events across chunk boundaries, skipping anything else', async () => {
    const seen: unknown[] = []
    const body = stream(['event: x\ndata: {"type":"a"}\nda', 'ta: {"type":"b"}\ndata: not json\n'], () => {})
    for await (const evt of lmEvents(body)) seen.push(evt.type)
    expect(seen).toEqual(['a', 'b'])
  })

  it('cancels the stream when the reader stops early', async () => {
    const onCancel = vi.fn()
    const body = stream(['data: {"type":"error"}\n', 'data: {"type":"never"}\n'], onCancel)
    await expect((async () => {
      for await (const evt of lmEvents(body)) if (evt.type === 'error') throw new Error('stop')
    })()).rejects.toThrow('stop')
    expect(onCancel).toHaveBeenCalled()
  })
})

describe('normalizeQuery', () => {
  it('ignores case, punctuation, order and repeats', () => {
    expect(normalizeQuery("Chipotle Chicken-Bowl!")).toBe('bowl chicken chipotle')
    expect(normalizeQuery('bowl  chicken chipotle bowl')).toBe('bowl chicken chipotle')
  })
  it('keeps distinct foods distinct', () => {
    expect(normalizeQuery('chicken bowl')).not.toBe(normalizeQuery('chicken burrito bowl'))
  })
})

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

  it('for a job that needs eyes, passes over the text models for one that can see', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [
      { type: 'llm', key: 'text/loaded', loaded_instances: [{ id: 'text/loaded' }], capabilities: { vision: false } },
      { type: 'llm', key: 'eyes/unloaded', capabilities: { vision: true, reasoning: { allowed_options: ['off', 'on'] } } },
      { type: 'llm', key: 'eyes/loaded', loaded_instances: [{ id: 'eyes/loaded' }], capabilities: { vision: true } },
    ] }))) as unknown as typeof fetch
    // The loaded vision model wins over the loaded text one and the unloaded vision one.
    expect(await chooseModel({ ...SETTINGS, researchModel: 'text/loaded' }, fetchImpl, undefined, '', true)).toEqual({ model: 'eyes/loaded', reasoning: null })
    // A chosen vision model is taken as is, even unloaded; a chosen text model is not.
    expect(await chooseModel(SETTINGS, fetchImpl, undefined, 'eyes/unloaded', true)).toEqual({ model: 'eyes/unloaded', reasoning: 'off' })
    expect((await chooseModel(SETTINGS, fetchImpl, undefined, 'text/loaded', true)).model).toBe('eyes/loaded')
    const blind = vi.fn(async () => new Response(JSON.stringify({ models: [
      { type: 'llm', key: 'text/loaded', loaded_instances: [{ id: 'text/loaded' }], capabilities: { vision: false } },
    ] }))) as unknown as typeof fetch
    await expect(chooseModel(SETTINGS, blind, undefined, '', true)).rejects.toThrow(/No vision model/)
  })

  describe('with a "use when loaded" model', () => {
    const lm = (models: object[]) => vi.fn(async () => new Response(JSON.stringify({ models }))) as unknown as typeof fetch
    const always = { type: 'llm', key: 'big/always', capabilities: { vision: false, reasoning: { allowed_options: ['low', 'high'] } } }
    const chosen = { type: 'llm', key: 'small/chosen', loaded_instances: [{ id: 'small/chosen' }], capabilities: { reasoning: { allowed_options: ['off', 'on'] } } }
    const eyes = { type: 'llm', key: 'eyes/loaded', loaded_instances: [{ id: 'eyes/loaded' }], capabilities: { vision: true } }
    const settings = { ...SETTINGS, researchModel: 'small/chosen', preferredModel: 'big/always' }

    it('stands in for the research model while it is loaded, with its own reasoning', async () => {
      const fetchImpl = lm([{ ...always, loaded_instances: [{ id: 'big/always:2' }] }, chosen])
      expect(await chooseModel(settings, fetchImpl)).toEqual({ model: 'big/always:2', reasoning: 'low' })
      // Notes with no model of their own use it too.
      expect(await chooseModel(settings, fetchImpl, undefined, settings.notesModel)).toEqual({ model: 'big/always:2', reasoning: 'low' })
      // Named by a loaded instance id, it matches too.
      expect((await chooseModel({ ...settings, preferredModel: 'big/always:2' }, fetchImpl)).model).toBe('big/always:2')
      // No reasoning options means none is sent.
      const plain = lm([{ type: 'llm', key: 'big/always', loaded_instances: [{ id: 'big/always' }] }, chosen])
      expect(await chooseModel(settings, plain)).toEqual({ model: 'big/always', reasoning: null })
    })

    it('leaves a job its own model even while it is loaded', async () => {
      const fetchImpl = lm([{ ...always, loaded_instances: [{ id: 'big/always' }] }, chosen])
      // Notes with their own model ignore it.
      expect(await chooseModel({ ...settings, notesModel: 'small/chosen' }, fetchImpl, undefined, 'small/chosen')).toEqual({ model: 'small/chosen', reasoning: 'off' })
      // A label with its own labelModel keeps it, even when the preferred one can see.
      const seeing = lm([{ ...always, loaded_instances: [{ id: 'big/always' }], capabilities: { vision: true } }, eyes])
      expect(await chooseModel({ ...settings, labelModel: 'eyes/loaded' }, seeing, undefined, 'eyes/loaded', true)).toEqual({ model: 'eyes/loaded', reasoning: null })
    })

    it('leaves things as they were while it is not loaded', async () => {
      const fetchImpl = lm([{ ...always, loaded_instances: [] }, chosen])
      expect(await chooseModel(settings, fetchImpl)).toEqual({ model: 'small/chosen', reasoning: 'off' })
      expect(await chooseModel(settings, lm([always, chosen]), undefined, 'other/notes')).toEqual({ model: 'other/notes', reasoning: null })
    })

    it('for a job that needs eyes, passes over one that cannot see', async () => {
      const fetchImpl = lm([{ ...always, loaded_instances: [{ id: 'big/always' }] }, eyes])
      expect(await chooseModel(settings, fetchImpl, undefined, '', true)).toEqual({ model: 'eyes/loaded', reasoning: null })
      // One that can see is used for that too, when no label model is chosen.
      const seeing = lm([{ ...always, loaded_instances: [{ id: 'big/always' }], capabilities: { vision: true, reasoning: { allowed_options: ['off'] } } }, eyes])
      expect(await chooseModel(settings, seeing, undefined, '', true)).toEqual({ model: 'big/always', reasoning: 'off' })
    })
  })

  it('explains when nothing is loaded or LM Studio is down', async () => {
    const empty = vi.fn(async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch
    await expect(chooseModel(SETTINGS, empty)).rejects.toThrow(/No model is loaded/)
    const down = vi.fn(async () => { throw new TypeError('ECONNREFUSED') }) as unknown as typeof fetch
    await expect(chooseModel(SETTINGS, down)).rejects.toThrow(/Couldn't reach LM Studio/)
  })
})

describe('listLlms', () => {
  it('lists downloaded LLMs, loaded first, and leaves out embedding models', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ models: [
      { type: 'llm', key: 'b/unloaded', loaded_instances: [] },
      { type: 'embedding', key: 'nomic', loaded_instances: [{ id: 'nomic' }] },
      { type: 'llm', key: 'a/unloaded' },
      { type: 'llm', key: 'z/loaded', loaded_instances: [{ id: 'z/loaded' }] },
    ] }))) as unknown as typeof fetch
    expect(await listLlms(SETTINGS, fetchImpl)).toEqual([
      { key: 'z/loaded', loaded: true, vision: false },
      { key: 'a/unloaded', loaded: false, vision: false },
      { key: 'b/unloaded', loaded: false, vision: false },
    ])
  })

  it('says when LM Studio is down', async () => {
    const down = vi.fn(async () => { throw new TypeError('ECONNREFUSED') }) as unknown as typeof fetch
    await expect(listLlms(SETTINGS, down)).rejects.toThrow(/Couldn't reach LM Studio/)
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

  it('answers a reworded repeat from cache too', async () => {
    const { fetchImpl, calls } = lmStudio(JSON.stringify(BOWL_REPLY))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    const first = jobs.start('Chipotle chicken bowl')
    await vi.waitFor(() => expect(jobs.get(first.id)!.status).toBe('done'))
    const chats = calls.filter((c) => c.url.endsWith('/chat')).length
    expect(jobs.start('bowl, chicken chipotle').status).toBe('done')
    expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats)
  })

  it('does not remember "nothing reliable found"', async () => {
    const { fetchImpl, calls } = lmStudio(JSON.stringify({ found: false, items: [], note: 'no such thing' }))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    const first = jobs.start('unicorn steak')
    await vi.waitFor(() => expect(jobs.get(first.id)!.status).toBe('done'))
    expect(jobs.get(first.id)!.result!.foods).toEqual([])
    const chats = calls.filter((c) => c.url.endsWith('/chat')).length
    const again = jobs.start('unicorn steak')
    expect(again.status).toBe('running')
    await vi.waitFor(() => expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats + 1))
  })

  it('looks up again on request, even when the answer is cached', async () => {
    const { fetchImpl, calls } = lmStudio(JSON.stringify(BOWL_REPLY))
    const jobs = new ResearchJobs(() => SETTINGS, fetchImpl)
    const first = jobs.start('chipotle bowl')
    await vi.waitFor(() => expect(jobs.get(first.id)!.status).toBe('done'))
    const chats = calls.filter((c) => c.url.endsWith('/chat')).length
    const fresh = jobs.start('chipotle bowl', { refresh: true })
    expect(fresh.status).toBe('running')
    await vi.waitFor(() => expect(jobs.get(fresh.id)!.status).toBe('done'))
    expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats + 1)
  })

  it('keeps finished lookups in whatever cache it is given', async () => {
    const kept = new Map<string, unknown>()
    const cache: LookupStore = { get: (k) => kept.get(k) as never, set: (k, r) => { kept.set(k, r) } }
    const { fetchImpl, calls } = lmStudio(JSON.stringify(BOWL_REPLY))
    const first = new ResearchJobs(() => SETTINGS, fetchImpl, cache)
    const job = first.start('chipotle bowl')
    await vi.waitFor(() => expect(first.get(job.id)!.status).toBe('done'))
    expect([...kept.keys()]).toEqual(['bowl chipotle'])

    const chats = calls.filter((c) => c.url.endsWith('/chat')).length
    const restarted = new ResearchJobs(() => SETTINGS, fetchImpl, cache)
    const again = restarted.start('Chipotle Bowl')
    expect(again.status).toBe('done')
    expect(again.result!.foods[0]!.name).toBe('Chicken Burrito Bowl')
    expect(calls.filter((c) => c.url.endsWith('/chat'))).toHaveLength(chats)
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

  it('frees its slot the moment it is cancelled', async () => {
    const hang = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch
    const jobs = new ResearchJobs(() => SETTINGS, hang)
    const a = jobs.start('a')
    jobs.start('b')
    jobs.cancel(a.id)
    expect(() => jobs.start('c')).not.toThrow()
    expect(jobs.get(a.id)).toMatchObject({ status: 'error', error: 'Cancelled.' })
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
