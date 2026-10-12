import { describe, it, expect, vi } from 'vitest'
import { LABEL_PROMPT, readLabel } from './intake.ts'
import type { Settings } from '../src/types.ts'

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
