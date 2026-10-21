import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { Store, ValidationError } from './store.ts'
import { HealthCheck } from './health.ts'
import { TtlCache, searchFoods, usdaPortions } from './foods.ts'
import { ResearchJobs, listLlms } from './research.ts'
import { fingerprint, writeNotes } from './notes.ts'
import { LABEL_MAX_BYTES, isImageDataUrl, readLabel } from './label.ts'
import type { SearchResult } from './foods.ts'
import type { RangeNotes, Serving } from '../src/types.ts'

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void

export interface ApiOptions {
  dir?: string
  fetchImpl?: typeof fetch
}

const DAY_MS = 86_400_000

function json(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk
      if (body.length > limit) {
        req.destroy()
        reject(new ValidationError('request too large'))
      }
    })
    req.on('end', () => {
      if (!body) return resolve({})
      try { resolve(JSON.parse(body)) } catch { reject(new ValidationError('invalid JSON')) }
    })
    req.on('error', reject)
  })
}

/**
 * A state-changing request must come from this app's own page. The server is
 * reachable from any tab on a device on your network, so without this a web
 * page you happened to visit could write to your food log.
 */
function sameOrigin(req: IncomingMessage): boolean {
  const method = (req.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return true
  const origin = req.headers.origin
  if (!origin) return true // curl and scripts send none
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

export function createApi(options: ApiOptions = {}) {
  const store = new Store({ dir: options.dir })
  const fetchImpl = options.fetchImpl ?? fetch
  /** Ranges whose notes are being written right now, so a double tap does not write twice. */
  const writing = new Set<string>()
  const searchCache = new TtlCache<SearchResult>(DAY_MS)
  const portionCache = new TtlCache<Serving[]>(7 * DAY_MS)
  const research = new ResearchJobs(() => store.getSettings(), fetchImpl, {
    get: (key) => store.getLookup(key),
    set: (key, result) => store.setLookup(key, result),
  })
  /** `GET /api/health`: the process, its data file and the model server. */
  const health = new HealthCheck({
    app: 'cairn',
    dataFile: path.join(path.resolve(options.dir ?? '.data'), 'macros.sqlite'),
    busy: () => ({ notes: writing.size, research: research.running }),
    deps: { model: () => listLlms(store.getSettings(), fetchImpl) },
  })

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', 'http://local')
    const p = url.pathname.replace(/\/+$/, '')
    const method = req.method || 'GET'

    let m: RegExpExecArray | null

    if ((m = /^\/api\/day\/([^/]+)$/.exec(p)) && method === 'GET') {
      return json(res, 200, store.getDay(decodeURIComponent(m[1]!)))
    }

    if (p === '/api/range' && method === 'GET') {
      const start = url.searchParams.get('start') || ''
      const end = url.searchParams.get('end') || ''
      return json(res, 200, store.getRange(start, end))
    }

    if (p === '/api/entries' && method === 'POST') {
      return json(res, 201, store.addEntry(await readBody(req) as never))
    }
    if ((m = /^\/api\/entries\/([^/]+)$/.exec(p))) {
      const id = decodeURIComponent(m[1]!)
      if (method === 'PATCH') return json(res, 200, store.updateEntry(id, await readBody(req) as never))
      if (method === 'DELETE') {
        store.deleteEntry(id)
        return json(res, 200, { ok: true })
      }
    }

    if (p === '/api/water' && method === 'POST') {
      const body = await readBody(req) as { date?: unknown; ounces?: unknown }
      return json(res, 201, store.addWater(body.date as string, body.ounces as number))
    }
    if (p === '/api/alcohol' && method === 'POST') {
      const body = await readBody(req) as { date?: unknown; kind?: unknown }
      return json(res, 201, store.addAlcohol(body.date as string, body.kind as string))
    }
    if ((m = /^\/api\/alcohol\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteAlcohol(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }
    if ((m = /^\/api\/water\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteWater(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }
    if (p === '/api/workouts' && method === 'POST') {
      return json(res, 201, store.addWorkout(await readBody(req) as Record<string, unknown>))
    }
    if ((m = /^\/api\/workouts\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteWorkout(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }
    // Body measurements from the phone: { samples: [...] }, a bare list, or one sample.
    if (p === '/api/body' && method === 'POST') {
      const body = await readBody(req) as { samples?: unknown } | unknown[]
      const samples = Array.isArray(body) ? body : (body as { samples?: unknown }).samples ?? body
      return json(res, 200, store.addBodySamples(samples))
    }
    if (p === '/api/dog-walks' && method === 'POST') {
      return json(res, 201, store.addDogWalk(await readBody(req) as Record<string, unknown>))
    }
    if ((m = /^\/api\/dog-walks\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteDogWalk(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }
    if (p === '/api/meditation' && method === 'POST') {
      return json(res, 201, store.addMeditation(await readBody(req) as Record<string, unknown>))
    }
    if ((m = /^\/api\/meditation\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteMeditation(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }

    if (p === '/api/foods' && method === 'GET') {
      return json(res, 200, { saved: store.listFoods(), recent: store.recentFoods() })
    }
    if (p === '/api/foods' && method === 'POST') {
      return json(res, 201, store.saveFood(await readBody(req) as never))
    }
    if ((m = /^\/api\/foods\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteFood(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }

    // Meal presets: a named group of foods, logged together in one action.
    if (p === '/api/meals' && method === 'GET') {
      return json(res, 200, store.listPresets())
    }
    if (p === '/api/meals' && method === 'POST') {
      return json(res, 201, store.savePreset(await readBody(req) as never))
    }
    if ((m = /^\/api\/meals\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deletePreset(decodeURIComponent(m[1]!))
      return json(res, 200, { ok: true })
    }
    if ((m = /^\/api\/meals\/([^/]+)\/apply$/.exec(p)) && method === 'POST') {
      const { date, meal } = await readBody(req) as { date?: unknown; meal?: unknown }
      return json(res, 201, store.applyPreset(
        decodeURIComponent(m[1]!),
        typeof date === 'string' ? date : '',
        typeof meal === 'string' ? meal : '',
      ))
    }

    if (p === '/api/search' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim()
      if (q.length < 2) throw new ValidationError('search needs at least 2 characters')
      if (q.length > 100) throw new ValidationError('search is too long')
      const found = await searchFoods(q, store.getSettings().usdaApiKey, searchCache, fetchImpl)
      // Shown in the sheet and otherwise lost: keep a trace of what failed and when.
      for (const e of found.errors) console.log(`[macros] ${new Date().toISOString()} search ${e.source} failed for "${q}": ${e.message}`)
      return json(res, 200, found)
    }

    if ((m = /^\/api\/portions\/(\d+)$/.exec(p)) && method === 'GET') {
      const id = m[1]!
      let portions = portionCache.get(id)
      if (!portions) {
        portions = await usdaPortions(id, store.getSettings().usdaApiKey, fetchImpl)
        portionCache.set(id, portions)
      }
      return json(res, 200, portions)
    }

    // Online lookup through LM Studio + deep-research: slow, so a job to poll.
    if (p === '/api/research' && method === 'POST') {
      const { q, refresh } = await readBody(req) as { q?: unknown; refresh?: unknown }
      const query = typeof q === 'string' ? q.trim() : ''
      if (query.length < 2) throw new ValidationError('describe the food in at least 2 characters')
      if (query.length > 200) throw new ValidationError('description is too long')
      try {
        return json(res, 202, research.start(query, { refresh: refresh === true }))
      } catch (err) {
        return json(res, 429, { error: (err as Error).message })
      }
    }
    if ((m = /^\/api\/research\/([\w-]+)$/.exec(p))) {
      const id = m[1]!
      if (method === 'GET') {
        const job = research.get(id)
        return job ? json(res, 200, job) : json(res, 404, { error: 'no such lookup' })
      }
      if (method === 'DELETE') return json(res, 200, { cancelled: research.cancel(id) })
    }

    // /api/targets is what the app uses (blockers block "goals" URLs); /api/goals stays for anything else.
    if (p === '/api/targets' || p === '/api/goals') {
      if (method === 'GET') return json(res, 200, store.getGoals())
      if (method === 'PUT') return json(res, 200, store.setGoals(await readBody(req) as never))
    }

    if ((m = /^\/api\/day-type\/([^/]+)$/.exec(p)) && method === 'PUT') {
      const date = decodeURIComponent(m[1]!)
      const body = await readBody(req) as { type?: unknown }
      return json(res, 200, { date, type: store.setDayType(date, body.type) })
    }

    // One week's own workout plan (by its Sunday); DELETE puts it back on the default.
    if ((m = /^\/api\/workout-plan\/([^/]+)$/.exec(p))) {
      const weekStart = decodeURIComponent(m[1]!)
      if (method === 'PUT') {
        const body = await readBody(req) as { plan?: unknown }
        return json(res, 200, { weekStart, plan: store.setWeekPlan(weekStart, body.plan), custom: true })
      }
      if (method === 'DELETE') {
        store.clearWeekPlan(weekStart)
        return json(res, 200, { weekStart, ...store.planForWeek(weekStart) })
      }
    }

    // Notes on a week or month, from the local model. GET says what has been
    // written and whether the range's numbers have moved since; POST writes
    // them now (a few seconds on a small model).
    if (p === '/api/notes' && (method === 'GET' || method === 'POST')) {
      const body = method === 'POST' ? await readBody(req) as { start?: unknown; end?: unknown } : null
      const start = (method === 'GET' ? url.searchParams.get('start') : String(body?.start ?? '')) || ''
      const end = (method === 'GET' ? url.searchParams.get('end') : String(body?.end ?? '')) || ''
      const view = store.getRange(start, end)
      const now = fingerprint(view)
      const present = (): RangeNotes | null => {
        const saved = store.getNotes(start, end)
        return saved && { start, end, text: saved.text, model: saved.model, at: saved.at, stale: saved.fingerprint !== now }
      }
      if (method === 'GET') return json(res, 200, { notes: present() })
      if (view.loggedDays === 0 && view.water.of === 0 && view.workouts.sessions === 0) {
        return json(res, 400, { error: 'Nothing logged in this period yet.' })
      }
      const key = `${start}..${end}`
      if (writing.has(key)) return json(res, 409, { error: 'Already writing notes for this period.' })
      writing.add(key)
      try {
        const { text, model } = await writeNotes(view, store.getSettings(), fetchImpl)
        store.saveNotes(start, end, now, text, model)
        return json(res, 200, { notes: present() })
      } finally {
        writing.delete(key)
      }
    }

    // A photographed nutrition label, read by a vision model into the fields
    // of the Manual tab. Synchronous: seconds once the model is loaded.
    if (p === '/api/label' && method === 'POST') {
      const { image } = await readBody(req, LABEL_MAX_BYTES + 100) as { image?: unknown }
      if (!isImageDataUrl(image)) throw new ValidationError('send the label as a JPEG, PNG or WebP data URL')
      try {
        return json(res, 200, { reading: await readLabel(image, store.getSettings(), fetchImpl) })
      } catch (err) {
        return json(res, 502, { error: (err as Error).message })
      }
    }

    if (p === '/api/health' && method === 'GET') return json(res, 200, await health.report())

    if (p === '/api/lm-models' && method === 'GET') {
      try {
        return json(res, 200, { models: await listLlms(store.getSettings(), fetchImpl), error: null })
      } catch (err) {
        return json(res, 200, { models: [], error: (err as Error).message })
      }
    }

    if (p === '/api/settings') {
      if (method === 'GET') return json(res, 200, store.getPublicSettings())
      if (method === 'PUT') return json(res, 200, store.setSettings(await readBody(req) as never))
    }

    return json(res, 404, { error: 'no such endpoint' })
  }

  // The app icon: whichever one Settings picked, from the set in public/icons.
  // Served ahead of the static files, so /icon.svg (the tab icon) and the
  // home-screen PNGs follow the setting without a rebuild.
  const iconDir = path.resolve(process.cwd(), 'public', 'icons')
  const ICON_FILES: Record<string, { suffix: string; type: string }> = {
    '/icon.svg': { suffix: '.svg', type: 'image/svg+xml' },
    '/icon-180.png': { suffix: '-180.png', type: 'image/png' },
    '/icon-192.png': { suffix: '-192.png', type: 'image/png' },
    '/icon-512.png': { suffix: '-512.png', type: 'image/png' },
  }
  const serveIcon = (pathname: string, res: ServerResponse): boolean => {
    const f = ICON_FILES[pathname]
    if (!f) return false
    const file = path.join(iconDir, `${store.getSettings().appIcon}${f.suffix}`)
    if (!fs.existsSync(file)) return false
    res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-cache' })
    res.end(fs.readFileSync(file))
    return true
  }

  const middleware: Middleware = (req, res, next) => {
    if (req.method === 'GET' && serveIcon((req.url || '').split('?')[0]!, res)) return undefined
    if (!(req.url || '').startsWith('/api/')) return next()
    if (!sameOrigin(req)) return json(res, 403, { error: 'cross-origin write refused' })
    route(req, res).catch((err: unknown) => {
      if (err instanceof ValidationError) return json(res, 400, { error: err.message })
      console.log(`[macros] ${req.method} ${req.url}: ${(err as Error)?.message}`)
      return json(res, 500, { error: 'server error' })
    })
  }

  return { middleware, store }
}

export default function api(options: ApiOptions = {}): Plugin {
  const { middleware } = createApi(options)
  return {
    name: 'macros-api',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
