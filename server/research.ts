import { randomUUID } from 'node:crypto'
import { NUTRIENTS } from '../src/types.ts'
import type { Food, LmModelOption, Nutrients, Serving, Settings, SourceLink } from '../src/types.ts'

/**
 * Online nutrition lookup: LM Studio runs a local model with the
 * deep-research MCP enabled, the model reads the brand's or restaurant's own
 * nutrition page, and answers in JSON. For what the databases don't have --
 * restaurant dishes, store items, a specific build of a bowl.
 *
 * Nothing here is logged automatically. A lookup produces candidates, with
 * their sources, for a person to check; the numbers are validated but can
 * still be wrong, as any page the model read can be.
 */

export const RESEARCH_PLUGIN = 'mcp/deep-research'
const LOOKUP_TIMEOUT_MS = 6 * 60_000
const MAX_ITEMS = 3

export const SYSTEM_PROMPT = [
  'You look up nutrition facts. Use the research tool (and fetch_page if needed) to find published nutrition',
  'information for the food named, then reply with ONLY a JSON object -- no prose before or after:',
  '{"found": boolean, "items": [{"name": string, "brand": string|null,',
  ' "serving": {"label": string, "grams": number|null},',
  ' "nutrients": {"calories": number, "protein": number|null, "fat": number|null, "carbs": number|null, "fiber": number|null},',
  ' "other_servings": [{"label": string, "grams": number}], "source_url": string}], "note": string}',
  'Rules:',
  '- Nutrients are for ONE serving exactly as the source publishes it ("1 bowl", "1 cup", "2 cookies").',
  '- serving.grams only if the source states the serving weight (or it is on the label); otherwise null. Never estimate a weight.',
  "- Prefer the brand's or restaurant's official nutrition page or label, then USDA, then reputable databases.",
  '- For a custom build (a bowl with chosen ingredients), add up the official per-ingredient values and say so in note.',
  '- Never invent numbers. Use null for a nutrient the source does not give. If nothing reliable is found,',
  '  reply {"found": false, "items": [], "note": "<why>"}.',
  `- Up to ${MAX_ITEMS} items, only for clear variants (sizes, flavours). Mention disagreeing sources in note.`,
].join('\n')

export interface ResearchResult {
  query: string
  foods: Food[]
  note?: string
  model: string
  /** Seconds the lookup took. */
  seconds: number
}

// ---------------------------------------------------------------------------
// Parsing the model's answer
// ---------------------------------------------------------------------------

/** The JSON object in a reply, whether bare, fenced, or surrounded by prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const candidates = [fenced?.[1], text]
  for (const c of candidates) {
    if (!c) continue
    const start = c.indexOf('{')
    const end = c.lastIndexOf('}')
    if (start === -1 || end <= start) continue
    try {
      return JSON.parse(c.slice(start, end + 1))
    } catch { /* try the next */ }
  }
  return null
}

const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? v : null

const str = (v: unknown, max = 200): string =>
  (typeof v === 'string' ? v.trim().slice(0, max) : '')

const round2 = (n: number): number => Math.round(n * 100) / 100

function cleanUrl(v: unknown): SourceLink | null {
  const url = str(v, 500)
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return { title: parsed.hostname.replace(/^www\./, ''), url }
  } catch {
    return null
  }
}

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80)

interface RawItem {
  name?: unknown
  brand?: unknown
  serving?: { label?: unknown; grams?: unknown }
  nutrients?: Record<string, unknown>
  other_servings?: { label?: unknown; grams?: unknown }[]
  source_url?: unknown
}

/**
 * Validated foods from the model's JSON. Anything without calories, or with
 * values outside what a serving of food can contain, is dropped rather than
 * repaired.
 */
export function toFoods(data: unknown, query: string): { foods: Food[]; note?: string } {
  const obj = (data && typeof data === 'object' ? data : {}) as { found?: unknown; items?: unknown; note?: unknown }
  const note = str(obj.note, 1000) || undefined
  if (obj.found === false || !Array.isArray(obj.items)) return { foods: [], note }

  const foods: Food[] = []
  for (const raw of (obj.items as RawItem[]).slice(0, MAX_ITEMS)) {
    if (!raw || typeof raw !== 'object') continue
    const nutrients = {} as Nutrients
    for (const key of NUTRIENTS) nutrients[key] = num(raw.nutrients?.[key], key === 'calories' ? 10_000 : 1_000)
    if (nutrients.calories == null) continue

    const name = str(raw.name) || query
    const brand = str(raw.brand) || undefined
    const label = str(raw.serving?.label, 100) || '1 serving'
    const grams = num(raw.serving?.grams, 5_000)
    const source = cleanUrl(raw.source_url)

    const food: Food = {
      id: `web:${slug(`${brand ?? ''} ${name} ${label}`)}`,
      name,
      brand,
      source: 'web',
      perServing: { label, grams: grams && grams > 0 ? grams : null, nutrients },
      sources: source ? [source] : undefined,
      note,
    }
    if (grams && grams > 0) {
      // A weighed serving gives per-100g values, and with them g/oz and any
      // other servings the source listed.
      const per100g = {} as Nutrients
      for (const key of NUTRIENTS) {
        const v = nutrients[key]
        per100g[key] = v == null ? null : round2((v * 100) / grams)
      }
      food.per100g = per100g
      const servings: Serving[] = [{ label, grams }]
      for (const s of (raw.other_servings ?? []).slice(0, 5)) {
        const l = str(s?.label, 100)
        const g = num(s?.grams, 5_000)
        if (l && g && g > 0 && !servings.some((x) => x.label.toLowerCase() === l.toLowerCase())) servings.push({ label: l, grams: g })
      }
      food.servings = servings
    }
    foods.push(food)
  }
  return { foods, note }
}

// ---------------------------------------------------------------------------
// Talking to LM Studio
// ---------------------------------------------------------------------------

interface LmModel {
  type?: string
  key?: string
  loaded_instances?: { id?: string }[]
  capabilities?: { vision?: boolean; reasoning?: { allowed_options?: string[] } }
}

export const authHeaders = (settings: Settings): Record<string, string> =>
  (settings.lmStudioToken ? { Authorization: `Bearer ${settings.lmStudioToken}` } : {})

async function fetchLmModels(settings: Settings, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<LmModel[]> {
  const base = settings.lmStudioUrl.replace(/\/+$/, '')
  try {
    const timeout = AbortSignal.timeout(5_000)
    const res = await fetchImpl(`${base}/api/v1/models`, {
      headers: authHeaders(settings),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (res.status === 401 || res.status === 403) throw new Error('LM Studio rejected the token. Check it in Settings.')
    return res.ok ? ((await res.json()) as { models?: LmModel[] }).models ?? [] : []
  } catch (err) {
    if (signal?.aborted) throw signal.reason
    if ((err as Error).message.includes('token')) throw err
    throw new Error(`Couldn't reach LM Studio at ${base}. Is its server running?`)
  }
}

/**
 * Every LLM LM Studio has downloaded, loaded ones first -- what the model
 * picker in Settings offers. An unloaded one is fine to choose: LM Studio
 * loads it when the lookup asks for it.
 */
export async function listLlms(settings: Settings, fetchImpl: typeof fetch): Promise<LmModelOption[]> {
  const models = await fetchLmModels(settings, fetchImpl)
  return models
    .filter((m) => m.type === 'llm' && m.key)
    .map((m) => ({ key: m.key!, loaded: Boolean(m.loaded_instances?.length), vision: m.capabilities?.vision === true }))
    .sort((a, b) => Number(b.loaded) - Number(a.loaded) || a.key.localeCompare(b.key))
}

/**
 * The model to research with -- the one chosen in Settings, else whichever
 * LLM LM Studio has loaded, so a lookup never makes it load a second copy --
 * and the cheapest reasoning it allows. Reasoning off made a lookup three
 * times faster (74 s vs 227 s) with an equally good answer.
 *
 * With `vision`, the job needs a model that can see images (reading a
 * label): a chosen text-only model is passed over, and when nothing
 * suitable is loaded, any downloaded vision model will do -- LM Studio
 * loads it on the first call.
 */
export async function chooseModel(
  settings: Settings,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  /** A model to prefer over the research one (the notes model, when set). */
  preferred = '',
  vision = false,
): Promise<{ model: string; reasoning: string | null }> {
  const models = await fetchLmModels(settings, fetchImpl, signal)
  const sees = (m: LmModel): boolean => m.type === 'llm' && m.capabilities?.vision === true
  const wanted = vision ? preferred : preferred || settings.researchModel
  let entry = wanted
    ? models.find((m) => m.key === wanted || m.loaded_instances?.some((i) => i.id === wanted))
    : models.find((m) => m.type === 'llm' && m.loaded_instances?.length)
  if (vision && !(entry && sees(entry))) {
    entry = models.find((m) => sees(m) && m.loaded_instances?.length) ?? models.find(sees)
    if (!entry) throw new Error('No vision model in LM Studio. Download one that can read images (Gemma 3, Qwen3-VL), or choose one in Settings.')
  }
  const model = (vision ? '' : wanted) || entry?.loaded_instances?.[0]?.id || entry?.key
  if (!model) throw new Error('No model is loaded in LM Studio. Load one, or choose one in Settings.')
  const allowed = entry?.capabilities?.reasoning?.allowed_options ?? []
  const reasoning = ['off', 'minimal', 'low'].find((r) => allowed.includes(r)) ?? null
  return { model, reasoning }
}

export async function describeError(res: Response): Promise<string> {
  let detail = ''
  try {
    const text = await res.text()
    try { detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '' } catch { detail = text.slice(0, 200) }
  } catch { /* no body */ }
  if (res.status === 401 || res.status === 403) return 'LM Studio rejected the token. Check it in Settings.'
  if (/plugin|integration|mcp/i.test(detail)) {
    return `LM Studio couldn't use ${RESEARCH_PLUGIN}: ${detail} Check that it is in LM Studio's mcp.json and allowed for API use.`
  }
  return detail || `LM Studio returned HTTP ${res.status}.`
}

/** One event of LM Studio's streamed chat, as far as anything here reads it. */
export interface LmEvent {
  type?: string
  content?: string
  tool_name?: string
  arguments?: { url?: string }
  error?: { message?: string }
}

/**
 * The `data:` events of an LM Studio chat stream, one at a time. However the
 * caller stops -- the stream ends, it throws on an error event, it is aborted
 * -- the reader is cancelled, so the connection is not left half-read.
 */
export async function* lmEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<LmEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let evt: LmEvent
        try { evt = JSON.parse(line.slice(5).trim()) as LmEvent } catch { continue }
        yield evt
      }
    }
  } finally {
    reader.cancel().catch(() => { /* already closed or errored */ })
  }
}

export interface ResearchOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Progress, for display: "searching the web", "reading chipotle.com". */
  onStep?: (step: string) => void
}

export async function researchFood(query: string, settings: Settings, options: ResearchOptions = {}): Promise<ResearchResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const step = options.onStep ?? (() => {})
  const started = Date.now()
  step('choosing a model')
  const { model, reasoning } = await chooseModel(settings, fetchImpl, options.signal)

  const body: Record<string, unknown> = {
    model,
    system_prompt: SYSTEM_PROMPT,
    input: `Food: ${query}`,
    stream: true,
    integrations: [{ type: 'plugin', id: RESEARCH_PLUGIN }],
  }
  if (reasoning) body.reasoning = reasoning

  step('starting')
  const res = await fetchImpl(`${settings.lmStudioUrl.replace(/\/+$/, '')}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(settings) },
    body: JSON.stringify(body),
    signal: options.signal,
  })
  if (!res.ok) throw new Error(await describeError(res))
  if (!res.body) throw new Error('LM Studio returned no stream.')

  let text = ''
  let usedTools = false
  for await (const evt of lmEvents(res.body)) {
    switch (evt.type) {
      case 'model_load.start': step('loading the model'); break
      // After a tool call, the "prompt" being processed is what the tool returned.
      case 'prompt_processing.start': step(usedTools ? 'reading what it found' : 'reading the request'); break
      case 'tool_call.name':
        usedTools = true
        step(evt.tool_name === 'fetch_page' ? 'reading a page' : 'searching the web')
        break
      case 'tool_call.arguments': {
        const host = (() => { try { return new URL(evt.arguments?.url ?? '').hostname.replace(/^www\./, '') } catch { return '' } })()
        if (host) step(`reading ${host}`)
        break
      }
      case 'message.start': step('writing up'); break
      case 'message.delta': text += evt.content ?? ''; break
      case 'error': throw new Error(evt.error?.message || 'LM Studio reported an error.')
      default: break
    }
  }

  const data = extractJson(text)
  if (data == null) throw new Error("The model's answer wasn't in the expected format. Try again.")
  const { foods, note } = toFoods(data, query)
  return { query, foods, note, model, seconds: Math.round((Date.now() - started) / 1000) }
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * A lookup takes a minute or more, far longer than a phone keeps a request
 * open with its screen locked. So it runs as a job the page polls, and the
 * answer is there whenever you look again.
 */
export interface ResearchJob {
  id: string
  query: string
  status: 'running' | 'done' | 'error'
  step: string
  startedAt: number
  result?: ResearchResult
  error?: string
}

const MAX_RUNNING = 2
const JOB_TTL_MS = 60 * 60_000
export const LOOKUP_TTL_MS = 30 * 86_400_000
export const LOOKUP_MAX = 200

/**
 * What identifies "the same lookup": the words, ignoring case, punctuation and
 * order -- so "Chipotle chicken bowl" and "chicken bowl, chipotle" share one
 * answer instead of costing two minutes of the model's time each.
 */
export function normalizeQuery(query: string): string {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  return [...new Set(words)].sort().join(' ')
}

/** Finished lookups. The real one lives in the database (Store); this is the in-memory stand-in. */
export interface LookupStore {
  get(key: string): ResearchResult | undefined
  set(key: string, result: ResearchResult): void
}

export class MemoryLookupCache implements LookupStore {
  private entries = new Map<string, { at: number; result: ResearchResult }>()

  get(key: string): ResearchResult | undefined {
    const hit = this.entries.get(key)
    if (!hit || Date.now() - hit.at > LOOKUP_TTL_MS) return undefined
    return hit.result
  }

  set(key: string, result: ResearchResult): void {
    this.entries.delete(key)
    this.entries.set(key, { at: Date.now(), result })
    while (this.entries.size > LOOKUP_MAX) this.entries.delete(this.entries.keys().next().value!)
  }
}

export class ResearchJobs {
  private jobs = new Map<string, ResearchJob & { controller?: AbortController }>()
  private cache: LookupStore
  private getSettings: () => Settings
  private fetchImpl: typeof fetch

  /** How many lookups are running right now. */
  get running(): number { return [...this.jobs.values()].filter((j) => j.status === 'running').length }

  /** `cache`: where finished lookups are kept; omit to keep them in memory only. */
  constructor(getSettings: () => Settings, fetchImpl: typeof fetch = fetch, cache: LookupStore = new MemoryLookupCache()) {
    this.getSettings = getSettings
    this.fetchImpl = fetchImpl
    this.cache = cache
  }

  /**
   * Start a lookup, or return the one already answering this query. A
   * repeat is answered from the cache unless `refresh` asks for a fresh one.
   */
  start(query: string, options: { refresh?: boolean } = {}): ResearchJob {
    this.prune()
    const q = query.trim().replace(/\s+/g, ' ')
    const key = normalizeQuery(q)
    const cached = options.refresh ? undefined : this.cache.get(key)
    if (cached) return this.add({ id: randomUUID(), query: q, status: 'done', step: 'done', startedAt: Date.now(), result: cached })
    for (const job of this.jobs.values()) {
      if (job.status === 'running' && normalizeQuery(job.query) === key) return this.view(job)
    }
    if ([...this.jobs.values()].filter((j) => j.status === 'running').length >= MAX_RUNNING) {
      throw new Error(`${MAX_RUNNING} lookups are already running. Wait for one to finish.`)
    }

    const controller = new AbortController()
    const job = { id: randomUUID(), query: q, status: 'running' as const, step: 'starting', startedAt: Date.now(), controller }
    this.jobs.set(job.id, job)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LOOKUP_TIMEOUT_MS)])
    researchFood(q, this.getSettings(), { fetchImpl: this.fetchImpl, signal, onStep: (s) => { job.step = s } })
      .then((result) => {
        // "Nothing reliable found" isn't worth remembering: it would be replayed for a month.
        if (result.foods.length) this.cache.set(key, result)
        if (job.status === 'running') Object.assign(job, { status: 'done', step: 'done', result })
      })
      .catch((err: Error) => {
        const message = err.name === 'TimeoutError'
          ? 'The lookup took too long and was stopped.'
          : err.name === 'AbortError' ? 'Cancelled.' : err.message
        Object.assign(job, { status: 'error', step: 'failed', error: message })
      })
      .finally(() => { delete (job as { controller?: AbortController }).controller })
    return this.view(job)
  }

  get(id: string): ResearchJob | undefined {
    const job = this.jobs.get(id)
    return job && this.view(job)
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job?.controller) return false
    // Settle now rather than when the abort lands, so the lookup that
    // replaces it (the query was edited) isn't refused for want of a slot.
    Object.assign(job, { status: 'error', step: 'failed', error: 'Cancelled.' })
    job.controller.abort()
    return true
  }

  private add(job: ResearchJob): ResearchJob {
    this.jobs.set(job.id, job)
    return this.view(job)
  }

  private view(job: ResearchJob & { controller?: AbortController }): ResearchJob {
    const { controller: _controller, ...rest } = job
    return { ...rest }
  }

  private prune(): void {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.startedAt < cutoff) this.jobs.delete(id)
    }
  }
}

/**
 * One plain reply from LM Studio: the text of a /api/v1/chat stream with no
 * tools, for the short jobs (the week's notes) that just want words back.
 */
export async function chatText(
  settings: Settings,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchImpl(`${settings.lmStudioUrl.replace(/\/+$/, '')}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(settings) },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!res.ok) throw new Error(await describeError(res))
  if (!res.body) throw new Error('LM Studio returned no stream.')
  let text = ''
  for await (const evt of lmEvents(res.body)) {
    if (evt.type === 'message.delta') text += evt.content ?? ''
    else if (evt.type === 'error') throw new Error(evt.error?.message || 'LM Studio reported an error.')
  }
  return text.trim()
}
