import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MEALS, NUTRIENTS } from '../src/types.ts'
import type {
  DayView, Entry, Food, Goals, NewEntry, Nutrients, PublicSettings, Settings,
} from '../src/types.ts'
import { DEFAULT_GOALS, isDateString, scale, sumDay } from '../src/lib/nutrition.ts'

/**
 * Everything is kept on the machine running the server, so the log is shared
 * between devices and survives a phone clearing its storage.
 */

interface LogFile {
  /** Keyed by local calendar date, YYYY-MM-DD. */
  entries: Record<string, Entry[]>
  foods: Food[]
  goals: Goals
}

const emptyLog = (): LogFile => ({ entries: {}, foods: [], goals: { ...DEFAULT_GOALS } })

export class ValidationError extends Error {}

const MAX_NAME = 200

/** A nutrient value is a finite, non-negative number, or null for unknown. */
function cleanNutrients(input: unknown, label: string): Nutrients {
  if (!input || typeof input !== 'object') throw new ValidationError(`${label} is required`)
  const src = input as Record<string, unknown>
  const out = {} as Nutrients
  for (const key of NUTRIENTS) {
    const v = src[key]
    if (v === null || v === undefined || v === '') {
      out[key] = null
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000) {
      out[key] = v
    } else {
      throw new ValidationError(`${label}.${key} must be a non-negative number or null`)
    }
  }
  return out
}

function cleanName(v: unknown, label = 'name'): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new ValidationError(`${label} is required`)
  return s.slice(0, MAX_NAME)
}

function cleanGrams(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 10_000) {
    throw new ValidationError('grams must be a positive number')
  }
  return v
}

export interface StoreOptions {
  dir?: string
}

export class Store {
  private dataDir: string
  private logPath: string
  private settingsPath: string
  private log: LogFile
  private logMtime = 0

  constructor(options: StoreOptions = {}) {
    this.dataDir = options.dir || path.resolve(process.cwd(), '.data')
    this.logPath = path.join(this.dataDir, 'log.json')
    this.settingsPath = path.join(this.dataDir, 'settings.json')
    this.log = this.readLog()
  }

  // --- persistence --------------------------------------------------------

  private readLog(): LogFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.logPath, 'utf8')) as Partial<LogFile>
      this.logMtime = fs.statSync(this.logPath).mtimeMs
      return {
        entries: raw.entries ?? {},
        foods: raw.foods ?? [],
        goals: { ...DEFAULT_GOALS, ...raw.goals },
      }
    } catch {
      return emptyLog()
    }
  }

  /** Pick up edits made to the file while the server was running. */
  private refresh(): void {
    try {
      const mtime = fs.statSync(this.logPath).mtimeMs
      if (mtime !== this.logMtime) this.log = this.readLog()
    } catch { /* no file yet */ }
  }

  private write(file: string, value: unknown): void {
    // 0700 / 0600: this is a record of everything you eat.
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(this.dataDir, 0o700) } catch { /* not ours to change */ }
    // Write-then-rename, so a crash mid-write leaves the old file intact.
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, file)
  }

  private countEntries(log: LogFile): number {
    return Object.values(log.entries).reduce((n, list) => n + list.length, 0)
  }

  private flush(): void {
    // Snapshot before any write that would lose more than one entry: a
    // single delete is intentional, a bigger drop is probably a bug.
    const onDisk = (() => {
      try { return JSON.parse(fs.readFileSync(this.logPath, 'utf8')) as LogFile } catch { return null }
    })()
    if (onDisk && this.countEntries(onDisk) - this.countEntries(this.log) > 1) {
      const dir = path.join(this.dataDir, 'backups')
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const name = `log.${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      fs.writeFileSync(path.join(dir, name), JSON.stringify(onDisk), { mode: 0o600 })
    }
    this.write(this.logPath, this.log)
    try { this.logMtime = fs.statSync(this.logPath).mtimeMs } catch { /* re-read next time */ }
  }

  // --- days and entries ------------------------------------------------------

  getDay(date: string): DayView {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    this.refresh()
    const entries = [...(this.log.entries[date] ?? [])]
      .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.createdAt - b.createdAt)
    return { date, entries, goals: { ...this.log.goals }, ...sumDay(entries) }
  }

  addEntry(input: NewEntry): Entry {
    if (!isDateString(input?.date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(input.meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    const grams = cleanGrams(input.grams)

    let per100g: Nutrients | undefined
    let nutrients: Nutrients
    if (input.per100g) {
      if (grams == null) throw new ValidationError('grams is required with per100g')
      per100g = cleanNutrients(input.per100g, 'per100g')
      nutrients = scale(per100g, grams)
    } else {
      nutrients = cleanNutrients(input.nutrients, 'nutrients')
    }

    const entry: Entry = {
      id: randomUUID(),
      date: input.date,
      meal: input.meal,
      name: cleanName(input.name),
      brand: typeof input.brand === 'string' && input.brand.trim() ? input.brand.trim().slice(0, MAX_NAME) : undefined,
      grams,
      nutrients,
      per100g,
      foodId: typeof input.foodId === 'string' ? input.foodId.slice(0, 200) : undefined,
      source: input.source === 'usda' || input.source === 'off' ? input.source : 'custom',
      createdAt: Date.now(),
    }
    this.refresh()
    ;(this.log.entries[entry.date] ??= []).push(entry)
    this.flush()
    return entry
  }

  private find(id: string): { list: Entry[]; index: number } | null {
    this.refresh()
    for (const list of Object.values(this.log.entries)) {
      const index = list.findIndex((e) => e.id === id)
      if (index !== -1) return { list, index }
    }
    return null
  }

  /** Change the weight, meal or name. A new weight rescales from per100g. */
  updateEntry(id: string, patch: { grams?: number; meal?: string; name?: string; nutrients?: Nutrients }): Entry {
    const hit = this.find(id)
    if (!hit) throw new ValidationError('no such entry')
    const entry = { ...hit.list[hit.index]! }

    if (patch.meal !== undefined) {
      if (!MEALS.includes(patch.meal as Entry['meal'])) throw new ValidationError('invalid meal')
      entry.meal = patch.meal as Entry['meal']
    }
    if (patch.name !== undefined) entry.name = cleanName(patch.name)
    if (patch.grams !== undefined) {
      const grams = cleanGrams(patch.grams)
      if (grams == null) throw new ValidationError('grams must be a positive number')
      entry.grams = grams
      if (entry.per100g) entry.nutrients = scale(entry.per100g, grams)
    }
    if (patch.nutrients !== undefined) {
      if (entry.per100g) throw new ValidationError('nutrients follow from the weight for a database food')
      entry.nutrients = cleanNutrients(patch.nutrients, 'nutrients')
    }

    hit.list[hit.index] = entry
    this.flush()
    return entry
  }

  deleteEntry(id: string): void {
    const hit = this.find(id)
    if (!hit) throw new ValidationError('no such entry')
    const [removed] = hit.list.splice(hit.index, 1)
    if (removed && hit.list.length === 0) delete this.log.entries[removed.date]
    this.flush()
  }

  // --- foods -------------------------------------------------------------------

  listFoods(): Food[] {
    this.refresh()
    return [...this.log.foods].sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Foods logged recently, most recent first, one per food. The honest
   * "frequent foods" list: what you actually eat, not what you remembered
   * to save.
   */
  recentFoods(limit = 20): Food[] {
    this.refresh()
    const all = Object.values(this.log.entries).flat().sort((a, b) => b.createdAt - a.createdAt)
    const seen = new Set<string>()
    const out: Food[] = []
    for (const e of all) {
      const key = e.foodId || `${e.name}|${e.brand ?? ''}`
      if (seen.has(key) || !e.per100g) continue
      seen.add(key)
      out.push({
        id: e.foodId || `recent:${key}`,
        name: e.name,
        brand: e.brand,
        source: e.source,
        per100g: e.per100g,
        // The weight last used is the most likely next one.
        servings: e.grams ? [{ label: `last time (${e.grams} g)`, grams: e.grams }] : undefined,
      })
      if (out.length >= limit) break
    }
    return out
  }

  saveFood(input: Food): Food {
    const food: Food = {
      id: typeof input.id === 'string' && input.id ? input.id.slice(0, 200) : `custom:${randomUUID()}`,
      name: cleanName(input.name),
      brand: typeof input.brand === 'string' && input.brand.trim() ? input.brand.trim().slice(0, MAX_NAME) : undefined,
      source: input.source === 'usda' || input.source === 'off' ? input.source : 'custom',
      sourceId: typeof input.sourceId === 'string' ? input.sourceId.slice(0, 100) : undefined,
      per100g: cleanNutrients(input.per100g, 'per100g'),
      servings: Array.isArray(input.servings)
        ? input.servings
          .filter((s) => s && typeof s.label === 'string' && typeof s.grams === 'number' && s.grams > 0)
          .slice(0, 20)
          .map((s) => ({ label: s.label.slice(0, 100), grams: s.grams }))
        : undefined,
    }
    this.refresh()
    const i = this.log.foods.findIndex((f) => f.id === food.id)
    if (i === -1) this.log.foods.push(food)
    else this.log.foods[i] = food
    this.flush()
    return food
  }

  deleteFood(id: string): void {
    this.refresh()
    const before = this.log.foods.length
    this.log.foods = this.log.foods.filter((f) => f.id !== id)
    if (this.log.foods.length === before) throw new ValidationError('no such food')
    this.flush()
  }

  // --- goals and settings -----------------------------------------------------

  getGoals(): Goals {
    this.refresh()
    return { ...this.log.goals }
  }

  setGoals(input: Partial<Goals>): Goals {
    this.refresh()
    const next = { ...this.log.goals }
    for (const key of NUTRIENTS) {
      const v = (input as Record<string, unknown>)[key]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) {
        throw new ValidationError(`goal ${key} must be a non-negative number`)
      }
      next[key] = v
    }
    this.log.goals = next
    this.flush()
    return { ...next }
  }

  getSettings(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>
      return { usdaApiKey: typeof raw.usdaApiKey === 'string' ? raw.usdaApiKey : '' }
    } catch {
      return { usdaApiKey: '' }
    }
  }

  getPublicSettings(): PublicSettings {
    return { hasUsdaKey: Boolean(this.getSettings().usdaApiKey) }
  }

  setSettings(input: Partial<Settings>): PublicSettings {
    const next = this.getSettings()
    if (typeof input.usdaApiKey === 'string') next.usdaApiKey = input.usdaApiKey.trim().slice(0, 100)
    this.write(this.settingsPath, next)
    return this.getPublicSettings()
  }
}
