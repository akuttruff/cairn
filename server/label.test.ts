import { describe, it, expect, vi } from 'vitest'
import { isImageDataUrl, readLabel, toReading } from './label.ts'
import type { Settings } from '../src/types.ts'

const SETTINGS = { lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: 't', researchModel: 'text/model', notesModel: '', labelModel: '' } as Settings
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

function lmStudio(reply: string, models: object[] = [
  { type: 'llm', key: 'text/model', loaded_instances: [{ id: 'text/model' }], capabilities: { vision: false } },
  { type: 'llm', key: 'eyes/model', loaded_instances: [{ id: 'eyes/model' }], capabilities: { vision: true, reasoning: { allowed_options: ['off', 'on'] } } },
]) {
  const calls: { url: string; body?: Record<string, unknown> }[] = []
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ models }), { status: 200 })
    const enc = new TextEncoder()
    return new Response(new ReadableStream({ start(c) {
      for (const e of [{ type: 'message.delta', content: reply }, { type: 'chat.end' }]) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      c.close()
    } }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('reading a label', () => {
  it('accepts only a base64 image data URL of a modest size', () => {
    expect(isImageDataUrl(JPEG)).toBe(true)
    expect(isImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
    expect(isImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false)
    expect(isImageDataUrl('https://example.com/label.jpg')).toBe(false)
    expect(isImageDataUrl(`data:image/jpeg;base64,${'A'.repeat(8_000_000)}`)).toBe(false)
    expect(isImageDataUrl(42)).toBe(false)
  })

  it('keeps what the label said and leaves the rest null, never guessing', () => {
    const reading = toReading({
      name: null, brand: '  Kodiak ', serving: { label: '1/2 cup (53g)', grams: 53 },
      nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: 'five' }, note: null,
    }, 'eyes/model')
    expect(reading).toEqual({
      name: null, brand: 'Kodiak', serving: { label: '1/2 cup (53g)', grams: 53 },
      nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: null }, model: 'eyes/model',
    })
    // Out-of-range values are dropped, not repaired; a missing serving label gets the plain default.
    expect(toReading({ serving: { grams: -5 }, nutrients: { calories: 50_000, protein: 12 } }, 'm')).toMatchObject({
      serving: { label: '1 serving', grams: null }, nutrients: { calories: null, protein: 12 },
    })
  })

  it('is nothing when no number at all was read', () => {
    expect(toReading({ nutrients: {}, note: 'a photo of a dog' }, 'm')).toBeNull()
    expect(toReading('garbage', 'm')).toBeNull()
  })

  it('sends the picture to a vision model, text-only ones passed over, and parses the answer', async () => {
    const { fetchImpl, calls } = lmStudio(`Here you go:\n\`\`\`json\n${JSON.stringify({
      name: 'Protein Pancake Mix', brand: 'Kodiak', serving: { label: '1/2 cup (53g)', grams: 53 },
      nutrients: { calories: 190, protein: 14, fat: 2.5, carbs: 30, fiber: 3 }, note: null,
    })}\n\`\`\``)
    const reading = await readLabel(JPEG, SETTINGS, fetchImpl)
    expect(reading).toMatchObject({ name: 'Protein Pancake Mix', brand: 'Kodiak', serving: { grams: 53 }, nutrients: { calories: 190, fiber: 3 }, model: 'eyes/model' })
    const chat = calls.find((c) => c.url.endsWith('/api/v1/chat'))!.body!
    expect(chat.model).toBe('eyes/model')
    expect(chat.reasoning).toBe('off')
    expect(chat.input).toEqual([{ type: 'text', content: 'Read this nutrition label.' }, { type: 'image', data_url: JPEG }])
  })

  it('says why when the picture was not a label, and when no vision model is there', async () => {
    const { fetchImpl } = lmStudio(JSON.stringify({ name: null, brand: null, serving: { label: '', grams: null }, nutrients: {}, note: 'a receipt' }))
    await expect(readLabel(JPEG, SETTINGS, fetchImpl)).rejects.toThrow(/Couldn't read a nutrition label there: a receipt/)
    const blind = lmStudio('', [{ type: 'llm', key: 'text/model', loaded_instances: [{ id: 'text/model' }] }])
    await expect(readLabel(JPEG, SETTINGS, blind.fetchImpl)).rejects.toThrow(/No vision model/)
  })
})
