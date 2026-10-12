import { randomUUID } from 'node:crypto'
import { chatText, chooseModel, extractJson, toFoods } from './research.ts'
import type { ResearchJobs, ResearchResult } from './research.ts'
import type { Food, Settings } from '../src/types.ts'

/**
 * Two more ways in than typing a name: a photo of a Nutrition Facts panel,
 * read by the model; and a few words about what was eaten, split into foods
 * by the model and then looked up one by one with the research tool.
 */

// ---------------------------------------------------------------------------
// A photo of a label
// ---------------------------------------------------------------------------

export const LABEL_PROMPT = [
  'You read Nutrition Facts panels from photos. Reply with ONLY a JSON object -- no prose before or after:',
  '{"found": boolean, "items": [{"name": string, "brand": string|null,',
  ' "serving": {"label": string, "grams": number|null},',
  ' "nutrients": {"calories": number, "protein": number|null, "fat": number|null, "carbs": number|null, "fiber": number|null},',
  ' "other_servings": [{"label": string, "grams": number}], "source_url": null}], "note": string}',
  'Rules:',
  '- One item: the product in the photo. Nutrients are for ONE serving, exactly as printed in the per-serving column.',
  '- serving.label is the household measure as printed, without the weight ("2/3 cup", "1 bar", "2 cookies");',
  '  serving.grams is the weight printed beside it, or null if none is printed. Never estimate a weight.',
  '- carbs is Total Carbohydrate; fiber is Dietary Fiber; fat is Total Fat; calories is Calories.',
  '- If the panel also gives a per-container column and the container weight can be read or worked out from',
  '  "servings per container" times the serving weight, add {"label": "1 container", "grams": <weight>} to other_servings.',
  '- name and brand come from the packaging if visible; otherwise name the food from the panel\'s context, brand null.',
  '- If a number is unreadable, use null for it. If there is no readable Nutrition Facts panel,',
  '  reply {"found": false, "items": [], "note": "<what the photo shows instead>"}.',
  '- Mention anything doubtful (a blurry figure, a cropped panel) in note.',
].join('\n')

const LABEL_MAX_TOKENS = 600

export interface LabelImage {
  /** A data URL: data:image/jpeg;base64,... */
  dataUrl: string
}

export interface LabelResult {
  foods: Food[]
  note?: string
  model: string
  seconds: number
}

/** Read one label photo into a food, ready to log or correct. */
export async function readLabel(image: LabelImage, hint: string, settings: Settings, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<LabelResult> {
  const started = Date.now()
  const { model, reasoning, vision } = await chooseModel(settings, fetchImpl, signal)
  if (vision === false) throw new Error(`${model} can't look at pictures. Choose a model that can in Settings.`)
  const body: Record<string, unknown> = {
    model,
    system_prompt: LABEL_PROMPT,
    input: [
      { type: 'text', content: hint.trim() ? `Read this nutrition label. The product is: ${hint.trim()}` : 'Read this nutrition label.' },
      { type: 'image', data_url: image.dataUrl },
    ],
    max_output_tokens: LABEL_MAX_TOKENS,
  }
  if (reasoning) body.reasoning = reasoning
  const text = await chatText(settings, body, fetchImpl, signal)
  const data = extractJson(text)
  if (data == null) throw new Error("The model's answer wasn't in the expected format. Try again.")
  const { foods, note } = toFoods(data, hint.trim() || 'Scanned label')
  return {
    // What a label says is the product's own word for itself, not something found on the web.
    foods: foods.map((f) => ({ ...f, id: f.id.replace(/^web:/, 'label:'), source: 'custom' as const, sources: undefined })),
    note,
    model,
    seconds: Math.round((Date.now() - started) / 1000),
  }
}

// ---------------------------------------------------------------------------
// A description in words
// ---------------------------------------------------------------------------

export const PARSE_PROMPT = [
  'You split a description of what someone ate into separate foods, so each can be looked up.',
  'Reply with ONLY a JSON object -- no prose before or after:',
  '{"items": [{"text": string, "food": string, "brand": string|null, "quantity": number, "unit": string|null, "grams": number|null}]}',
  'Rules:',
  '- One item per distinct food or dish. "eggs scrambled in butter" is two: the eggs and the butter.',
  '  A named dish ("chicken burrito bowl", "pad thai") stays one item. Keep the order written.',
  '- text: the words from the description that this item came from.',
  '- food: a name good for looking up nutrition facts, with the brand or restaurant when given',
  '  ("Trader Joe\'s Mandarin Orange Chicken", "Chipotle chicken burrito bowl", "large egg", "sourdough bread").',
  '- quantity and unit as written: "2 eggs" is quantity 2, unit null; "a cup of rice" is 1, "cup";',
  '  "half a bagel" is 0.5, null; "a handful of almonds" is 1, "handful"; a food with no amount is 1, null.',
  '- grams only when a weight is written ("150 g chicken" is 150). Never estimate a weight.',
  '- Leave out drinks of plain water and anything that is not food or drink.',
  `- At most ${12} items.`,
].join('\n')

const PARSE_MAX_TOKENS = 900
export const MAX_DESCRIPTION = 600

export interface ParsedItem {
  text: string
  food: string
  brand?: string
  quantity: number
  unit: string | null
  grams: number | null
}

const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 100) / 100 : null

/** The model's split, tidied: anything without a food name is dropped. */
export function toItems(data: unknown): ParsedItem[] {
  const raw = (data && typeof data === 'object' ? (data as { items?: unknown }).items : null)
  if (!Array.isArray(raw)) return []
  const items: ParsedItem[] = []
  for (const r of raw.slice(0, 12) as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue
    const food = str(r.food)
    if (!food) continue
    items.push({
      text: str(r.text) || food,
      food,
      brand: str(r.brand, 60) || undefined,
      quantity: num(r.quantity, 1_000) ?? 1,
      unit: str(r.unit, 40) || null,
      grams: num(r.grams, 10_000),
    })
  }
  return items
}

/** Split a description into foods, with the amounts as written. */
export async function parseDescription(text: string, settings: Settings, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<{ items: ParsedItem[]; model: string }> {
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal)
  const body: Record<string, unknown> = {
    model,
    system_prompt: PARSE_PROMPT,
    input: `Eaten: ${text.trim()}`,
    max_output_tokens: PARSE_MAX_TOKENS,
  }
  if (reasoning) body.reasoning = reasoning
  const reply = await chatText(settings, body, fetchImpl, signal)
  const data = extractJson(reply)
  if (data == null) throw new Error("The model's answer wasn't in the expected format. Try again.")
  return { items: toItems(data), model }
}

// ---------------------------------------------------------------------------
// The whole thing as a job: parse, then look each food up
// ---------------------------------------------------------------------------

export interface IntakeItem extends ParsedItem {
  status: 'pending' | 'looking' | 'done' | 'error'
  step?: string
  /** Up to three foods the lookup offered; the first is the best guess. */
  foods?: Food[]
  note?: string
  error?: string
}

export interface IntakeJob {
  id: string
  text: string
  status: 'running' | 'done' | 'error'
  /** What is happening now: "reading your description", "looking up 2 of 4". */
  step: string
  startedAt: number
  model?: string
  items: IntakeItem[]
  error?: string
}

const JOB_TTL_MS = 60 * 60_000
const PARSE_TIMEOUT_MS = 90_000
const MAX_RUNNING = 1

/**
 * Like a lookup, a description takes longer than a phone keeps a request
 * open, so it runs as a job the page polls. Each food is looked up through
 * the research jobs, so repeats come from that cache.
 */
export class IntakeJobs {
  private jobs = new Map<string, IntakeJob & { controller?: AbortController }>()
  private research: ResearchJobs
  private getSettings: () => Settings
  private fetchImpl: typeof fetch

  constructor(research: ResearchJobs, getSettings: () => Settings, fetchImpl: typeof fetch = fetch) {
    this.research = research
    this.getSettings = getSettings
    this.fetchImpl = fetchImpl
  }

  start(text: string): IntakeJob {
    this.prune()
    const t = text.trim().replace(/\s+/g, ' ')
    if ([...this.jobs.values()].filter((j) => j.status === 'running').length >= MAX_RUNNING) {
      throw new Error('A description is already being worked out. Wait for it to finish.')
    }
    const controller = new AbortController()
    const job = { id: randomUUID(), text: t, status: 'running' as const, step: 'reading your description', startedAt: Date.now(), items: [] as IntakeItem[], controller }
    this.jobs.set(job.id, job)
    this.run(job, controller.signal)
      .catch((err: Error) => {
        const message = err.name === 'TimeoutError' ? 'The model took too long and was stopped.' : err.name === 'AbortError' ? 'Cancelled.' : err.message
        Object.assign(job, { status: 'error', step: 'failed', error: message })
      })
      .finally(() => { delete (job as { controller?: AbortController }).controller })
    return this.view(job)
  }

  private async run(job: IntakeJob, signal: AbortSignal): Promise<void> {
    const parsed = await parseDescription(job.text, this.getSettings(), this.fetchImpl, AbortSignal.any([signal, AbortSignal.timeout(PARSE_TIMEOUT_MS)]))
    if (signal.aborted) throw signal.reason
    job.model = parsed.model
    job.items = parsed.items.map((i) => ({ ...i, status: 'pending' }))
    if (!job.items.length) {
      Object.assign(job, { status: 'error', step: 'failed', error: "Couldn't find any foods in that. Try naming them one by one." })
      return
    }
    // One at a time: LM Studio answers one request at a time anyway, and this
    // way the page can show which food it is on.
    for (const [index, item] of job.items.entries()) {
      if (signal.aborted) throw signal.reason
      job.step = `looking up ${index + 1} of ${job.items.length}`
      item.status = 'looking'
      try {
        const query = item.brand && !item.food.toLowerCase().includes(item.brand.toLowerCase()) ? `${item.brand} ${item.food}` : item.food
        const result: ResearchResult = await this.research.lookup(query, { signal, onStep: (s) => { item.step = s } })
        Object.assign(item, { status: 'done', step: undefined, foods: result.foods, note: result.note })
      } catch (err) {
        if (signal.aborted) throw signal.reason
        Object.assign(item, { status: 'error', step: undefined, error: (err as Error).message })
      }
    }
    Object.assign(job, { status: 'done', step: 'done' })
  }

  get(id: string): IntakeJob | undefined {
    const job = this.jobs.get(id)
    return job && this.view(job)
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job?.controller) return false
    Object.assign(job, { status: 'error', step: 'failed', error: 'Cancelled.' })
    job.controller.abort()
    return true
  }

  private view(job: IntakeJob & { controller?: AbortController }): IntakeJob {
    const { controller: _controller, ...rest } = job
    return { ...rest, items: rest.items.map((i) => ({ ...i })) }
  }

  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.startedAt < cutoff) this.jobs.delete(id)
    }
  }
}
