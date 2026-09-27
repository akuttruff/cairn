import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { MEALS, NUTRIENTS } from '../src/types.ts'
import type {
  Amount, DayView, Entry, Food, FoodSource, Goals, Meal, MealPreset, MealPresetItem, NewEntry, Nutrients,
  PerServing, PublicSettings, Settings, SourceLink,
} from '../src/types.ts'
import { DEFAULT_GOALS, isDateString, scale, sumDay } from '../src/lib/nutrition.ts'
import { multiply } from '../src/lib/units.ts'

/**
 * Everything is kept on the machine running the server, so the log is shared
 * between devices and survives a phone clearing its storage.
 */

interface LogFile {
  /** Keyed by local calendar date, YYYY-MM-DD. */
  entries: Record<string, Entry[]>
  foods: Food[]
  mealPresets: MealPreset[]
  goals: Goals
}

const emptyLog = (): LogFile => ({ entries: {}, foods: [], mealPresets: [], goals: { ...DEFAULT_GOALS } })

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

const cleanSource = (v: unknown): FoodSource =>
  (v === 'usda' || v === 'off' || v === 'web' ? v : 'custom')

const cleanLabel = (v: unknown, label: string): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new ValidationError(`${label} is required`)
  return s.slice(0, 100)
}

/** 1.5 x "1 cup"; the unit's weight when known. */
function cleanAmount(input: unknown): Amount {
  const a = input as Partial<Amount> | null
  if (!a || typeof a !== 'object') throw new ValidationError('amount is invalid')
  const q = a.quantity
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 10_000) {
    throw new ValidationError('amount.quantity must be a positive number')
  }
  return {
    quantity: q,
    unit: cleanLabel(a.unit, 'amount.unit'),
    unitGrams: a.unitGrams == null ? null : cleanGrams(a.unitGrams),
  }
}

function cleanPerServing(input: unknown): PerServing | undefined {
  if (input == null) return undefined
  const ps = input as Partial<PerServing>
  return {
    label: cleanLabel(ps.label, 'perServing.label'),
    grams: ps.grams == null ? null : cleanGrams(ps.grams),
    nutrients: cleanNutrients(ps.nutrients, 'perServing.nutrients'),
  }
}

/** Only http(s) links, so a looked-up food can't carry a javascript: URL into the page. */
function cleanSources(input: unknown): SourceLink[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: SourceLink[] = []
  for (const item of input.slice(0, 5)) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
    } catch {
      continue
    }
    const title = typeof item?.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 200) : url
    out.push({ title, url: url.slice(0, 500) })
  }
  return out.length ? out : undefined
}

export interface StoreOptions {
  dir?: string
}

export class Store {
  readonly dataDir: string
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
        mealPresets: raw.mealPresets ?? [],
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

  /**
   * Validates one entry's contents, without a date or meal -- shared by
   * addEntry (which supplies its own right after) and meal presets, whose
   * items are cleaned the same way at save time and applied, unchanged,
   * through addEntry once a date and meal are chosen for them.
   */
  private cleanEntryItem(input: unknown, label = 'entry'): MealPresetItem {
    const src = (input && typeof input === 'object' ? input : {}) as Partial<NewEntry>
    const grams = cleanGrams(src.grams)
    const amount = src.amount == null ? undefined : cleanAmount(src.amount)
    const per100g = src.per100g == null ? undefined : cleanNutrients(src.per100g, `${label}.per100g`)
    const perUnit = src.perUnit == null ? undefined : cleanNutrients(src.perUnit, `${label}.perUnit`)
    const nutrients = src.nutrients == null ? undefined : cleanNutrients(src.nutrients, `${label}.nutrients`)
    if (per100g) {
      if (grams == null) throw new ValidationError(`${label}: grams is required with per100g`)
    } else if (perUnit) {
      // A food known per serving: the amount says how many servings.
      if (!amount) throw new ValidationError(`${label}: amount is required with perUnit`)
    } else if (!nutrients) {
      throw new ValidationError(`${label} needs per100g, perUnit or nutrients`)
    }
    return {
      name: cleanName(src.name, `${label}.name`),
      brand: typeof src.brand === 'string' && src.brand.trim() ? src.brand.trim().slice(0, MAX_NAME) : undefined,
      grams,
      amount,
      per100g,
      perUnit,
      nutrients,
      foodId: typeof src.foodId === 'string' ? src.foodId.slice(0, 200) : undefined,
      source: cleanSource(src.source),
    }
  }

  addEntry(input: NewEntry): Entry {
    if (!isDateString(input?.date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(input.meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    const item = this.cleanEntryItem(input)
    let grams = item.grams

    let nutrients: Nutrients
    if (item.per100g) {
      nutrients = scale(item.per100g, grams!)
    } else if (item.perUnit) {
      nutrients = multiply(item.perUnit, item.amount!.quantity)
      grams = item.amount!.unitGrams == null ? null : Math.round(item.amount!.unitGrams * item.amount!.quantity * 10) / 10
    } else {
      nutrients = item.nutrients!
    }

    const entry: Entry = {
      id: randomUUID(),
      date: input.date,
      meal: input.meal,
      name: item.name,
      brand: item.brand,
      grams,
      amount: item.amount,
      nutrients,
      per100g: item.per100g,
      perUnit: item.perUnit,
      foodId: item.foodId,
      source: item.source,
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

  /**
   * Change the amount, meal or name. A new quantity rescales in the unit the
   * entry was logged in; a new weight rescales from per100g.
   */
  updateEntry(id: string, patch: {
    grams?: number; quantity?: number; meal?: string; name?: string; nutrients?: Nutrients; perUnit?: Nutrients
  }): Entry {
    const hit = this.find(id)
    if (!hit) throw new ValidationError('no such entry')
    const entry = { ...hit.list[hit.index]! }

    if (patch.meal !== undefined) {
      if (!MEALS.includes(patch.meal as Entry['meal'])) throw new ValidationError('invalid meal')
      entry.meal = patch.meal as Entry['meal']
    }
    if (patch.name !== undefined) entry.name = cleanName(patch.name)
    if (patch.perUnit !== undefined) {
      // Your own numbers for one serving; a database's stay as published.
      if (!entry.perUnit || entry.source !== 'custom') throw new ValidationError('only your own entries can change their numbers')
      entry.perUnit = cleanNutrients(patch.perUnit, 'perUnit')
      entry.nutrients = multiply(entry.perUnit, entry.amount?.quantity ?? 1)
    }
    if (patch.quantity !== undefined) {
      if (!entry.amount) throw new ValidationError('this entry has no serving to count')
      const amount = cleanAmount({ ...entry.amount, quantity: patch.quantity })
      entry.amount = amount
      const grams = amount.unitGrams == null ? null : Math.round(amount.unitGrams * amount.quantity * 10) / 10
      if (entry.perUnit) {
        entry.nutrients = multiply(entry.perUnit, amount.quantity)
        entry.grams = grams
      } else if (entry.per100g && grams != null) {
        entry.grams = grams
        entry.nutrients = scale(entry.per100g, grams)
      }
    }
    if (patch.grams !== undefined) {
      const grams = cleanGrams(patch.grams)
      if (grams == null) throw new ValidationError('grams must be a positive number')
      entry.grams = grams
      if (entry.per100g) entry.nutrients = scale(entry.per100g, grams)
      // Now measured by weight, not in the old unit.
      if (patch.quantity === undefined) delete entry.amount
    }
    if (patch.nutrients !== undefined) {
      if (entry.per100g || entry.perUnit) throw new ValidationError('nutrients follow from the amount for a database food')
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
      if (seen.has(key) || !(e.per100g || (e.perUnit && e.amount))) continue
      seen.add(key)
      const food: Food = { id: e.foodId || `recent:${key}`, name: e.name, brand: e.brand, source: e.source }
      if (e.per100g) {
        food.per100g = e.per100g
        // The unit last used is the most likely next one.
        if (e.amount?.unitGrams) food.servings = [{ label: e.amount.unit, grams: e.amount.unitGrams }]
        else if (e.grams) food.servings = [{ label: `last time (${e.grams} g)`, grams: e.grams }]
      } else if (e.perUnit && e.amount) {
        food.perServing = { label: e.amount.unit, grams: e.amount.unitGrams, nutrients: e.perUnit }
      }
      out.push(food)
      if (out.length >= limit) break
    }
    return out
  }

  saveFood(input: Food): Food {
    const food: Food = {
      id: typeof input.id === 'string' && input.id ? input.id.slice(0, 200) : `custom:${randomUUID()}`,
      name: cleanName(input.name),
      brand: typeof input.brand === 'string' && input.brand.trim() ? input.brand.trim().slice(0, MAX_NAME) : undefined,
      source: cleanSource(input.source),
      sourceId: typeof input.sourceId === 'string' ? input.sourceId.slice(0, 100) : undefined,
      per100g: input.per100g == null ? undefined : cleanNutrients(input.per100g, 'per100g'),
      perServing: cleanPerServing(input.perServing),
      sources: cleanSources(input.sources),
      note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1000) : undefined,
      servings: Array.isArray(input.servings)
        ? input.servings
          .filter((s) => s && typeof s.label === 'string' && typeof s.grams === 'number' && s.grams > 0)
          .slice(0, 20)
          .map((s) => ({ label: s.label.slice(0, 100), grams: s.grams }))
        : undefined,
    }
    if (!food.per100g && !food.perServing) throw new ValidationError('a food needs per100g or perServing nutrition')
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

  // --- meal presets --------------------------------------------------------

  listPresets(): MealPreset[] {
    this.refresh()
    return [...this.log.mealPresets].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** A named group of foods -- create with no id, or save an edit with one. */
  savePreset(input: { id?: unknown; name?: unknown; items?: unknown }): MealPreset {
    if (!Array.isArray(input?.items) || input.items.length === 0) {
      throw new ValidationError('a meal needs at least one food')
    }
    if (input.items.length > 30) throw new ValidationError('a meal can have at most 30 foods')
    const preset: MealPreset = {
      id: typeof input.id === 'string' && input.id ? input.id.slice(0, 200) : `meal:${randomUUID()}`,
      name: cleanName(input.name, 'name'),
      items: input.items.map((item, i) => this.cleanEntryItem(item, `item ${i + 1}`)),
      createdAt: Date.now(),
    }
    this.refresh()
    const i = this.log.mealPresets.findIndex((p) => p.id === preset.id)
    if (i === -1) this.log.mealPresets.push(preset)
    else this.log.mealPresets[i] = preset
    this.flush()
    return preset
  }

  deletePreset(id: string): void {
    this.refresh()
    const before = this.log.mealPresets.length
    this.log.mealPresets = this.log.mealPresets.filter((p) => p.id !== id)
    if (this.log.mealPresets.length === before) throw new ValidationError('no such meal')
    this.flush()
  }

  /**
   * Logs every food in a saved meal to one date and meal-of-day, in one
   * action. date/meal are checked once upfront, common to every item, so a
   * bad one can't log the first few foods and then fail partway through.
   */
  applyPreset(id: string, date: string, meal: string): Entry[] {
    this.refresh()
    const preset = this.log.mealPresets.find((p) => p.id === id)
    if (!preset) throw new ValidationError('no such meal')
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(meal as Meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    return preset.items.map((item) => this.addEntry({ ...item, date, meal: meal as Meal }))
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
    const defaults: Settings = {
      usdaApiKey: '', lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: '', researchModel: '', autoLookup: true,
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsPath, 'utf8')) as Partial<Settings>
      const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback)
      return {
        usdaApiKey: str(raw.usdaApiKey, ''),
        lmStudioUrl: str(raw.lmStudioUrl, defaults.lmStudioUrl) || defaults.lmStudioUrl,
        lmStudioToken: str(raw.lmStudioToken, ''),
        researchModel: str(raw.researchModel, ''),
        autoLookup: typeof raw.autoLookup === 'boolean' ? raw.autoLookup : true,
      }
    } catch {
      return defaults
    }
  }

  getPublicSettings(): PublicSettings {
    const s = this.getSettings()
    return {
      hasUsdaKey: Boolean(s.usdaApiKey),
      hasLmStudioToken: Boolean(s.lmStudioToken),
      lmStudioUrl: s.lmStudioUrl,
      researchModel: s.researchModel,
      autoLookup: s.autoLookup,
    }
  }

  setSettings(input: Partial<Settings>): PublicSettings {
    const next = this.getSettings()
    if (typeof input.usdaApiKey === 'string') next.usdaApiKey = input.usdaApiKey.trim().slice(0, 100)
    if (typeof input.lmStudioToken === 'string') next.lmStudioToken = input.lmStudioToken.trim().slice(0, 300)
    if (typeof input.researchModel === 'string') next.researchModel = input.researchModel.trim().slice(0, 200)
    if (typeof input.autoLookup === 'boolean') next.autoLookup = input.autoLookup
    if (typeof input.lmStudioUrl === 'string') {
      const url = input.lmStudioUrl.trim().replace(/\/+$/, '')
      if (url) {
        try {
          if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('bad protocol')
        } catch {
          throw new ValidationError('LM Studio address must be an http(s) URL')
        }
      }
      next.lmStudioUrl = url || 'http://127.0.0.1:1234'
    }
    this.write(this.settingsPath, next)
    return this.getPublicSettings()
  }
}
