import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin } from 'vite'
import { Store, ValidationError } from './store.ts'
import { TtlCache, searchFoods, usdaPortions } from './foods.ts'
import { ResearchJobs } from './research.ts'
import type { SearchResult } from './foods.ts'
import type { Serving } from '../src/types.ts'

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

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk
      if (body.length > 1_000_000) {
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
  const searchCache = new TtlCache<SearchResult>(DAY_MS)
  const portionCache = new TtlCache<Serving[]>(7 * DAY_MS)
  const research = new ResearchJobs(() => store.getSettings(), fetchImpl, path.join(store.dataDir, 'lookups.json'))

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || '/', 'http://local')
    const p = url.pathname.replace(/\/+$/, '')
    const method = req.method || 'GET'

    let m: RegExpExecArray | null

    if ((m = /^\/api\/day\/([^/]+)$/.exec(p)) && method === 'GET') {
      return json(res, 200, store.getDay(decodeURIComponent(m[1]!)))
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
    if ((m = /^\/api\/water\/([^/]+)$/.exec(p)) && method === 'DELETE') {
      store.deleteWater(decodeURIComponent(m[1]!))
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
      return json(res, 200, await searchFoods(q, store.getSettings().usdaApiKey, searchCache, fetchImpl))
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
      const { q } = await readBody(req) as { q?: unknown }
      const query = typeof q === 'string' ? q.trim() : ''
      if (query.length < 2) throw new ValidationError('describe the food in at least 2 characters')
      if (query.length > 200) throw new ValidationError('description is too long')
      try {
        return json(res, 202, research.start(query))
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

    if (p === '/api/goals') {
      if (method === 'GET') return json(res, 200, store.getGoals())
      if (method === 'PUT') return json(res, 200, store.setGoals(await readBody(req) as never))
    }

    if (p === '/api/settings') {
      if (method === 'GET') return json(res, 200, store.getPublicSettings())
      if (method === 'PUT') return json(res, 200, store.setSettings(await readBody(req) as never))
    }

    return json(res, 404, { error: 'no such endpoint' })
  }

  const middleware: Middleware = (req, res, next) => {
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
