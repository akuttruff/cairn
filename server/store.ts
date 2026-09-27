import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, StatementSync } from 'node:sqlite'
import { MEALS, NUTRIENTS } from '../src/types.ts'
import type {
  Amount, DayView, Entry, Food, FoodSource, Goals, Meal, MealPreset, MealPresetItem, NewEntry, Nutrients,
  PerServing, PublicSettings, Serving, Settings, SourceLink,
} from '../src/types.ts'
import { DEFAULT_GOALS, isDateString, scale, sumDay } from '../src/lib/nutrition.ts'
import { multiply } from '../src/lib/units.ts'

/**
 * Everything is kept on the machine running the server, so the log is shared
 * between devices and survives a phone clearing its storage.
 */

export class ValidationError extends Error {}

const MAX_NAME = 200
const BACKUP_KEEP = 20

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

// ---------------------------------------------------------------------------
// Storage paths and schema
// ---------------------------------------------------------------------------

function locate(dir?: string) {
  const dataDir = dir || path.resolve(process.cwd(), '.data')
  return {
    dataDir,
    sqlite: path.join(dataDir, 'macros.sqlite'),
    // Pre-SQLite storage, read only to migrate once.
    legacyLog: path.join(dataDir, 'log.json'),
    legacySettings: path.join(dataDir, 'settings.json'),
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  name TEXT NOT NULL, brand TEXT, grams REAL,
  amount_quantity REAL, amount_unit TEXT, amount_unit_grams REAL,
  nutrients_calories REAL, nutrients_protein REAL, nutrients_fat REAL, nutrients_carbs REAL, nutrients_fiber REAL,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_unit INTEGER NOT NULL DEFAULT 0,
  per_unit_calories REAL, per_unit_protein REAL, per_unit_fat REAL, per_unit_carbs REAL, per_unit_fiber REAL,
  food_id TEXT, source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT,
  source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')), source_id TEXT,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_serving INTEGER NOT NULL DEFAULT 0, per_serving_label TEXT, per_serving_grams REAL,
  per_serving_nutrients_calories REAL, per_serving_nutrients_protein REAL, per_serving_nutrients_fat REAL,
  per_serving_nutrients_carbs REAL, per_serving_nutrients_fiber REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS food_servings (
  food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, label TEXT NOT NULL, grams REAL NOT NULL,
  PRIMARY KEY (food_id, position)
);
CREATE TABLE IF NOT EXISTS food_sources (
  food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
  PRIMARY KEY (food_id, position)
);

CREATE TABLE IF NOT EXISTS meal_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_preset_items (
  preset_id TEXT NOT NULL REFERENCES meal_presets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, name TEXT NOT NULL, brand TEXT, grams REAL,
  amount_quantity REAL, amount_unit TEXT, amount_unit_grams REAL,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_unit INTEGER NOT NULL DEFAULT 0,
  per_unit_calories REAL, per_unit_protein REAL, per_unit_fat REAL, per_unit_carbs REAL, per_unit_fiber REAL,
  has_nutrients INTEGER NOT NULL DEFAULT 0,
  nutrients_calories REAL, nutrients_protein REAL, nutrients_fat REAL, nutrients_carbs REAL, nutrients_fiber REAL,
  food_id TEXT, source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')),
  PRIMARY KEY (preset_id, position)
);

CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY CHECK (id = 1),
  calories REAL NOT NULL, protein REAL NOT NULL, fat REAL NOT NULL, carbs REAL NOT NULL, fiber REAL NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1),
  usda_api_key TEXT NOT NULL DEFAULT '', lm_studio_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:1234',
  lm_studio_token TEXT NOT NULL DEFAULT '', research_model TEXT NOT NULL DEFAULT '', auto_lookup INTEGER NOT NULL DEFAULT 1);
`

/**
 * Single-process, single-user: WAL buys nothing here and would leave
 * permanent -wal/-shm sidecar files needing the same 0600 treatment as the
 * main file forever. Plain rollback-journal leaves only a transient
 * -journal file, gone once a transaction commits.
 */
function ensureSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 2000')
  db.exec(SCHEMA)
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

function nutrientValues(n: Nutrients): (number | null)[] {
  return [n.calories, n.protein, n.fat, n.carbs, n.fiber]
}
function nutrientsFrom(calories: number | null, protein: number | null, fat: number | null, carbs: number | null, fiber: number | null): Nutrients {
  return { calories, protein, fat, carbs, fiber }
}
const NO_NUTRIENTS: Nutrients = { calories: null, protein: null, fat: null, carbs: null, fiber: null }

interface EntryRow {
  id: string; date: string; meal: string; name: string; brand: string | null; grams: number | null
  amount_quantity: number | null; amount_unit: string | null; amount_unit_grams: number | null
  nutrients_calories: number | null; nutrients_protein: number | null; nutrients_fat: number | null
  nutrients_carbs: number | null; nutrients_fiber: number | null
  has_per100g: number
  per100g_calories: number | null; per100g_protein: number | null; per100g_fat: number | null
  per100g_carbs: number | null; per100g_fiber: number | null
  has_per_unit: number
  per_unit_calories: number | null; per_unit_protein: number | null; per_unit_fat: number | null
  per_unit_carbs: number | null; per_unit_fiber: number | null
  food_id: string | null; source: string; created_at: number
}

function entryFromRow(row: EntryRow): Entry {
  const entry: Entry = {
    id: row.id, date: row.date, meal: row.meal as Meal, name: row.name, grams: row.grams,
    nutrients: nutrientsFrom(row.nutrients_calories, row.nutrients_protein, row.nutrients_fat, row.nutrients_carbs, row.nutrients_fiber),
    source: row.source as FoodSource, createdAt: row.created_at,
  }
  if (row.brand != null) entry.brand = row.brand
  if (row.amount_quantity != null) entry.amount = { quantity: row.amount_quantity, unit: row.amount_unit!, unitGrams: row.amount_unit_grams }
  if (row.has_per100g) {
    entry.per100g = nutrientsFrom(row.per100g_calories, row.per100g_protein, row.per100g_fat, row.per100g_carbs, row.per100g_fiber)
  }
  if (row.has_per_unit) {
    entry.perUnit = nutrientsFrom(row.per_unit_calories, row.per_unit_protein, row.per_unit_fat, row.per_unit_carbs, row.per_unit_fiber)
  }
  if (row.food_id != null) entry.foodId = row.food_id
  return entry
}

/** date, meal, name, brand, grams, amount x3, nutrients x5, per100g flag+x5, perUnit flag+x5, foodId, source, createdAt. */
function entryColumnParams(e: Entry): SQLInputValue[] {
  return [
    e.date, e.meal, e.name, e.brand ?? null, e.grams,
    e.amount?.quantity ?? null, e.amount?.unit ?? null, e.amount?.unitGrams ?? null,
    ...nutrientValues(e.nutrients),
    e.per100g ? 1 : 0, ...nutrientValues(e.per100g ?? NO_NUTRIENTS),
    e.perUnit ? 1 : 0, ...nutrientValues(e.perUnit ?? NO_NUTRIENTS),
    e.foodId ?? null, e.source, e.createdAt,
  ]
}

interface FoodRow {
  id: string; name: string; brand: string | null; source: string; source_id: string | null
  has_per100g: number
  per100g_calories: number | null; per100g_protein: number | null; per100g_fat: number | null
  per100g_carbs: number | null; per100g_fiber: number | null
  has_per_serving: number; per_serving_label: string | null; per_serving_grams: number | null
  per_serving_nutrients_calories: number | null; per_serving_nutrients_protein: number | null
  per_serving_nutrients_fat: number | null; per_serving_nutrients_carbs: number | null; per_serving_nutrients_fiber: number | null
  note: string | null
}

function foodFromRow(row: FoodRow, servings: Serving[], sources: SourceLink[]): Food {
  const food: Food = { id: row.id, name: row.name, source: row.source as FoodSource }
  if (row.brand != null) food.brand = row.brand
  if (row.source_id != null) food.sourceId = row.source_id
  if (row.has_per100g) {
    food.per100g = nutrientsFrom(row.per100g_calories, row.per100g_protein, row.per100g_fat, row.per100g_carbs, row.per100g_fiber)
  }
  if (row.has_per_serving) {
    food.perServing = {
      label: row.per_serving_label!, grams: row.per_serving_grams,
      nutrients: nutrientsFrom(
        row.per_serving_nutrients_calories, row.per_serving_nutrients_protein, row.per_serving_nutrients_fat,
        row.per_serving_nutrients_carbs, row.per_serving_nutrients_fiber,
      ),
    }
  }
  if (servings.length) food.servings = servings
  if (sources.length) food.sources = sources
  if (row.note != null) food.note = row.note
  return food
}

function foodColumnParams(f: Food): SQLInputValue[] {
  const ps = f.perServing
  return [
    f.name, f.brand ?? null, f.source, f.sourceId ?? null,
    f.per100g ? 1 : 0, ...nutrientValues(f.per100g ?? NO_NUTRIENTS),
    ps ? 1 : 0, ps?.label ?? null, ps?.grams ?? null, ...nutrientValues(ps?.nutrients ?? NO_NUTRIENTS),
    f.note ?? null,
  ]
}

interface PresetItemRow {
  name: string; brand: string | null; grams: number | null
  amount_quantity: number | null; amount_unit: string | null; amount_unit_grams: number | null
  has_per100g: number
  per100g_calories: number | null; per100g_protein: number | null; per100g_fat: number | null
  per100g_carbs: number | null; per100g_fiber: number | null
  has_per_unit: number
  per_unit_calories: number | null; per_unit_protein: number | null; per_unit_fat: number | null
  per_unit_carbs: number | null; per_unit_fiber: number | null
  has_nutrients: number
  nutrients_calories: number | null; nutrients_protein: number | null; nutrients_fat: number | null
  nutrients_carbs: number | null; nutrients_fiber: number | null
  food_id: string | null; source: string
}

function presetItemFromRow(row: PresetItemRow): MealPresetItem {
  const item: MealPresetItem = { name: row.name, grams: row.grams, source: row.source as FoodSource }
  if (row.brand != null) item.brand = row.brand
  if (row.amount_quantity != null) item.amount = { quantity: row.amount_quantity, unit: row.amount_unit!, unitGrams: row.amount_unit_grams }
  if (row.has_per100g) {
    item.per100g = nutrientsFrom(row.per100g_calories, row.per100g_protein, row.per100g_fat, row.per100g_carbs, row.per100g_fiber)
  }
  if (row.has_per_unit) {
    item.perUnit = nutrientsFrom(row.per_unit_calories, row.per_unit_protein, row.per_unit_fat, row.per_unit_carbs, row.per_unit_fiber)
  }
  if (row.has_nutrients) {
    item.nutrients = nutrientsFrom(row.nutrients_calories, row.nutrients_protein, row.nutrients_fat, row.nutrients_carbs, row.nutrients_fiber)
  }
  if (row.food_id != null) item.foodId = row.food_id
  return item
}

function presetItemColumnParams(item: MealPresetItem): SQLInputValue[] {
  return [
    item.name, item.brand ?? null, item.grams,
    item.amount?.quantity ?? null, item.amount?.unit ?? null, item.amount?.unitGrams ?? null,
    item.per100g ? 1 : 0, ...nutrientValues(item.per100g ?? NO_NUTRIENTS),
    item.perUnit ? 1 : 0, ...nutrientValues(item.perUnit ?? NO_NUTRIENTS),
    item.nutrients ? 1 : 0, ...nutrientValues(item.nutrients ?? NO_NUTRIENTS),
    item.foodId ?? null, item.source,
  ]
}

interface GoalsRow { calories: number; protein: number; fat: number; carbs: number; fiber: number }
interface SettingsRow {
  usda_api_key: string; lm_studio_url: string; lm_studio_token: string; research_model: string; auto_lookup: number
}
function settingsFromRow(row: SettingsRow): Settings {
  return {
    usdaApiKey: row.usda_api_key, lmStudioUrl: row.lm_studio_url, lmStudioToken: row.lm_studio_token,
    researchModel: row.research_model, autoLookup: row.auto_lookup === 1,
  }
}

// ---------------------------------------------------------------------------
// Migration from JSON
// ---------------------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

interface LegacyLog {
  entries: Record<string, Entry[]>
  foods: Food[]
  mealPresets: MealPreset[]
  goals: Goals
}

/**
 * One-time import from the old log.json/settings.json, the first time this
 * data dir is opened after the SQLite switch. Builds the database at a temp
 * path and only renames it into place on success, so a crash mid-import
 * never leaves a half-built file at the real path -- which would otherwise
 * stop the migration from ever being retried.
 */
function migrateFromJson(paths: ReturnType<typeof locate>): void {
  const raw = readJson<Partial<LegacyLog>>(paths.legacyLog, {})
  const log: LegacyLog = {
    entries: raw.entries ?? {},
    foods: raw.foods ?? [],
    mealPresets: raw.mealPresets ?? [],
    goals: { ...DEFAULT_GOALS, ...raw.goals },
  }
  const rawSettings = readJson<Partial<Settings>>(paths.legacySettings, {})
  const settings: Settings = {
    usdaApiKey: typeof rawSettings.usdaApiKey === 'string' ? rawSettings.usdaApiKey : '',
    lmStudioUrl: typeof rawSettings.lmStudioUrl === 'string' && rawSettings.lmStudioUrl ? rawSettings.lmStudioUrl : 'http://127.0.0.1:1234',
    lmStudioToken: typeof rawSettings.lmStudioToken === 'string' ? rawSettings.lmStudioToken : '',
    researchModel: typeof rawSettings.researchModel === 'string' ? rawSettings.researchModel : '',
    autoLookup: typeof rawSettings.autoLookup === 'boolean' ? rawSettings.autoLookup : true,
  }

  const tmp = `${paths.sqlite}.${process.pid}.tmp`
  try { fs.rmSync(tmp, { force: true }) } catch { /* nothing there yet */ }

  const db = new DatabaseSync(tmp)
  try {
    ensureSchema(db)
    const insertEntry = db.prepare(
      `INSERT INTO entries (id,date,meal,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        food_id,source,created_at) VALUES (${Array(29).fill('?').join(',')})`,
    )
    const insertFood = db.prepare(
      `INSERT INTO foods (id,name,brand,source,source_id,has_per100g,per100g_calories,per100g_protein,per100g_fat,
        per100g_carbs,per100g_fiber,has_per_serving,per_serving_label,per_serving_grams,
        per_serving_nutrients_calories,per_serving_nutrients_protein,per_serving_nutrients_fat,
        per_serving_nutrients_carbs,per_serving_nutrients_fiber,note) VALUES (${Array(20).fill('?').join(',')})`,
    )
    const insertServing = db.prepare('INSERT INTO food_servings (food_id,position,label,grams) VALUES (?,?,?,?)')
    const insertSource = db.prepare('INSERT INTO food_sources (food_id,position,title,url) VALUES (?,?,?,?)')
    const insertPreset = db.prepare('INSERT INTO meal_presets (id,name,created_at) VALUES (?,?,?)')
    const insertItem = db.prepare(
      `INSERT INTO meal_preset_items (preset_id,position,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        has_nutrients,nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        food_id,source) VALUES (${Array(28).fill('?').join(',')})`,
    )

    db.exec('BEGIN')
    for (const list of Object.values(log.entries)) {
      for (const e of list) {
        insertEntry.run(e.id, ...entryColumnParams(e))
      }
    }
    for (const f of log.foods) {
      insertFood.run(f.id, ...foodColumnParams(f))
      ;(f.servings ?? []).forEach((s, i) => insertServing.run(f.id, i, s.label, s.grams))
      ;(f.sources ?? []).forEach((s, i) => insertSource.run(f.id, i, s.title, s.url))
    }
    for (const p of log.mealPresets) {
      insertPreset.run(p.id, p.name, p.createdAt)
      p.items.forEach((item, i) => insertItem.run(p.id, i, ...presetItemColumnParams(item)))
    }
    db.prepare('INSERT INTO goals (id,calories,protein,fat,carbs,fiber) VALUES (1,?,?,?,?,?)')
      .run(log.goals.calories, log.goals.protein, log.goals.fat, log.goals.carbs, log.goals.fiber)
    db.prepare('INSERT INTO settings (id,usda_api_key,lm_studio_url,lm_studio_token,research_model,auto_lookup) VALUES (1,?,?,?,?,?)')
      .run(settings.usdaApiKey, settings.lmStudioUrl, settings.lmStudioToken, settings.researchModel, settings.autoLookup ? 1 : 0)
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* nothing to roll back */ }
    db.close()
    try { fs.rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw err
  }
  db.close()
  fs.renameSync(tmp, paths.sqlite)

  const entryCount = Object.values(log.entries).reduce((n, list) => n + list.length, 0)
  console.log(
    `[macros] migrated ${entryCount} entries, ${log.foods.length} foods, ${log.mealPresets.length} meal presets ` +
    'from log.json/settings.json to macros.sqlite',
  )
  for (const legacy of [paths.legacyLog, paths.legacySettings]) {
    if (fs.existsSync(legacy)) {
      try { fs.renameSync(legacy, `${legacy}.migrated`) } catch { /* best effort */ }
    }
  }
}

// ---------------------------------------------------------------------------

export interface StoreOptions {
  dir?: string
}

interface Stmts {
  selectEntry: StatementSync
  selectEntriesByDate: StatementSync
  selectAllEntries: StatementSync
  insertEntry: StatementSync
  updateEntry: StatementSync
  deleteEntry: StatementSync
  selectAllFoods: StatementSync
  selectFoodServings: StatementSync
  selectFoodSources: StatementSync
  upsertFood: StatementSync
  deleteFoodServings: StatementSync
  deleteFoodSources: StatementSync
  insertFoodServing: StatementSync
  insertFoodSource: StatementSync
  deleteFood: StatementSync
  selectAllPresets: StatementSync
  selectPresetById: StatementSync
  selectPresetItems: StatementSync
  upsertPreset: StatementSync
  deletePresetItems: StatementSync
  insertPresetItem: StatementSync
  deletePreset: StatementSync
  selectGoals: StatementSync
  updateGoals: StatementSync
  selectSettings: StatementSync
  updateSettings: StatementSync
}

export class Store {
  readonly dataDir: string
  private paths: ReturnType<typeof locate>
  private db: DatabaseSync
  private stmts: Stmts

  constructor(options: StoreOptions = {}) {
    this.paths = locate(options.dir)
    this.dataDir = this.paths.dataDir
    // 0700: this is a record of everything you eat.
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(this.dataDir, 0o700) } catch { /* not ours to change */ }

    const hasLegacyJson = fs.existsSync(this.paths.legacyLog) || fs.existsSync(this.paths.legacySettings)
    if (!fs.existsSync(this.paths.sqlite) && hasLegacyJson) {
      migrateFromJson(this.paths)
    }

    this.db = new DatabaseSync(this.paths.sqlite)
    ensureSchema(this.db)
    try { fs.chmodSync(this.paths.sqlite, 0o600) } catch { /* not ours to change */ }

    this.stmts = {
      selectEntry: this.db.prepare('SELECT * FROM entries WHERE id = ?'),
      selectEntriesByDate: this.db.prepare('SELECT * FROM entries WHERE date = ?'),
      selectAllEntries: this.db.prepare('SELECT * FROM entries ORDER BY created_at DESC'),
      insertEntry: this.db.prepare(
        `INSERT INTO entries (id,date,meal,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
          nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
          has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
          has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
          food_id,source,created_at) VALUES (${Array(29).fill('?').join(',')})`,
      ),
      updateEntry: this.db.prepare(
        `UPDATE entries SET date=?,meal=?,name=?,brand=?,grams=?,amount_quantity=?,amount_unit=?,amount_unit_grams=?,
          nutrients_calories=?,nutrients_protein=?,nutrients_fat=?,nutrients_carbs=?,nutrients_fiber=?,
          has_per100g=?,per100g_calories=?,per100g_protein=?,per100g_fat=?,per100g_carbs=?,per100g_fiber=?,
          has_per_unit=?,per_unit_calories=?,per_unit_protein=?,per_unit_fat=?,per_unit_carbs=?,per_unit_fiber=?,
          food_id=?,source=?,created_at=? WHERE id=?`,
      ),
      deleteEntry: this.db.prepare('DELETE FROM entries WHERE id = ?'),
      selectAllFoods: this.db.prepare('SELECT * FROM foods'),
      selectFoodServings: this.db.prepare('SELECT * FROM food_servings WHERE food_id = ? ORDER BY position'),
      selectFoodSources: this.db.prepare('SELECT * FROM food_sources WHERE food_id = ? ORDER BY position'),
      upsertFood: this.db.prepare(
        `INSERT INTO foods (id,name,brand,source,source_id,has_per100g,per100g_calories,per100g_protein,per100g_fat,
          per100g_carbs,per100g_fiber,has_per_serving,per_serving_label,per_serving_grams,
          per_serving_nutrients_calories,per_serving_nutrients_protein,per_serving_nutrients_fat,
          per_serving_nutrients_carbs,per_serving_nutrients_fiber,note) VALUES (${Array(20).fill('?').join(',')})
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, source=excluded.source,
          source_id=excluded.source_id, has_per100g=excluded.has_per100g,
          per100g_calories=excluded.per100g_calories, per100g_protein=excluded.per100g_protein,
          per100g_fat=excluded.per100g_fat, per100g_carbs=excluded.per100g_carbs, per100g_fiber=excluded.per100g_fiber,
          has_per_serving=excluded.has_per_serving, per_serving_label=excluded.per_serving_label,
          per_serving_grams=excluded.per_serving_grams,
          per_serving_nutrients_calories=excluded.per_serving_nutrients_calories,
          per_serving_nutrients_protein=excluded.per_serving_nutrients_protein,
          per_serving_nutrients_fat=excluded.per_serving_nutrients_fat,
          per_serving_nutrients_carbs=excluded.per_serving_nutrients_carbs,
          per_serving_nutrients_fiber=excluded.per_serving_nutrients_fiber, note=excluded.note`,
      ),
      deleteFoodServings: this.db.prepare('DELETE FROM food_servings WHERE food_id = ?'),
      deleteFoodSources: this.db.prepare('DELETE FROM food_sources WHERE food_id = ?'),
      insertFoodServing: this.db.prepare('INSERT INTO food_servings (food_id,position,label,grams) VALUES (?,?,?,?)'),
      insertFoodSource: this.db.prepare('INSERT INTO food_sources (food_id,position,title,url) VALUES (?,?,?,?)'),
      deleteFood: this.db.prepare('DELETE FROM foods WHERE id = ?'),
      selectAllPresets: this.db.prepare('SELECT * FROM meal_presets'),
      selectPresetById: this.db.prepare('SELECT * FROM meal_presets WHERE id = ?'),
      selectPresetItems: this.db.prepare('SELECT * FROM meal_preset_items WHERE preset_id = ? ORDER BY position'),
      upsertPreset: this.db.prepare(
        `INSERT INTO meal_presets (id,name,created_at) VALUES (?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, created_at=excluded.created_at`,
      ),
      deletePresetItems: this.db.prepare('DELETE FROM meal_preset_items WHERE preset_id = ?'),
      insertPresetItem: this.db.prepare(
        `INSERT INTO meal_preset_items (preset_id,position,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
          has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
          has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
          has_nutrients,nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
          food_id,source) VALUES (${Array(28).fill('?').join(',')})`,
      ),
      deletePreset: this.db.prepare('DELETE FROM meal_presets WHERE id = ?'),
      selectGoals: this.db.prepare('SELECT * FROM goals WHERE id = 1'),
      updateGoals: this.db.prepare('UPDATE goals SET calories=?, protein=?, fat=?, carbs=?, fiber=? WHERE id=1'),
      selectSettings: this.db.prepare('SELECT * FROM settings WHERE id = 1'),
      updateSettings: this.db.prepare(
        'UPDATE settings SET usda_api_key=?, lm_studio_url=?, lm_studio_token=?, research_model=?, auto_lookup=? WHERE id=1',
      ),
    }

    if (!this.stmts.selectGoals.get()) {
      this.db.prepare('INSERT INTO goals (id,calories,protein,fat,carbs,fiber) VALUES (1,?,?,?,?,?)')
        .run(DEFAULT_GOALS.calories, DEFAULT_GOALS.protein, DEFAULT_GOALS.fat, DEFAULT_GOALS.carbs, DEFAULT_GOALS.fiber)
    }
    if (!this.stmts.selectSettings.get()) {
      this.db.prepare('INSERT INTO settings (id,usda_api_key,lm_studio_url,lm_studio_token,research_model,auto_lookup) VALUES (1,?,?,?,?,?)')
        .run('', 'http://127.0.0.1:1234', '', '', 1)
    }

    this.backupOncePerDay()
  }

  /**
   * A whole-file snapshot once per calendar day, not per write: every
   * mutating method here already touches only the row(s) it names by
   * primary key, so there's no "the whole document got swapped for
   * something smaller" failure mode left to guard against on every write --
   * only user error or a bad migration, which this covers.
   */
  private backupOncePerDay(): void {
    const today = new Date().toISOString().slice(0, 10)
    const backupDir = path.join(this.dataDir, 'backups')
    const name = `macros.${today}.sqlite`
    if (fs.existsSync(path.join(backupDir, name))) return
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    fs.copyFileSync(this.paths.sqlite, path.join(backupDir, name))
    try { fs.chmodSync(path.join(backupDir, name), 0o600) } catch { /* best effort */ }
    const kept = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite')).sort()
    for (const old of kept.slice(0, Math.max(0, kept.length - BACKUP_KEEP))) {
      try { fs.unlinkSync(path.join(backupDir, old)) } catch { /* already gone */ }
    }
  }

  // --- days and entries ------------------------------------------------------

  getDay(date: string): DayView {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const rows = this.stmts.selectEntriesByDate.all(date) as unknown as EntryRow[]
    const entries = rows.map(entryFromRow)
      .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.createdAt - b.createdAt)
    const goals = this.getGoals()
    return { date, entries, goals, ...sumDay(entries) }
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
    this.stmts.insertEntry.run(entry.id, ...entryColumnParams(entry))
    return entry
  }

  /**
   * Change the amount, meal or name. A new quantity rescales in the unit the
   * entry was logged in; a new weight rescales from per100g.
   */
  updateEntry(id: string, patch: {
    grams?: number; quantity?: number; meal?: string; name?: string; nutrients?: Nutrients; perUnit?: Nutrients
  }): Entry {
    const row = this.stmts.selectEntry.get(id) as unknown as EntryRow | undefined
    if (!row) throw new ValidationError('no such entry')
    const entry = entryFromRow(row)

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

    this.stmts.updateEntry.run(...entryColumnParams(entry), entry.id)
    return entry
  }

  deleteEntry(id: string): void {
    const result = this.stmts.deleteEntry.run(id)
    if (result.changes === 0) throw new ValidationError('no such entry')
  }

  // --- foods -------------------------------------------------------------------

  private loadFood(row: FoodRow): Food {
    const servings = (this.stmts.selectFoodServings.all(row.id) as unknown as { label: string; grams: number }[])
      .map((s) => ({ label: s.label, grams: s.grams }))
    const sources = (this.stmts.selectFoodSources.all(row.id) as unknown as { title: string; url: string }[])
      .map((s) => ({ title: s.title, url: s.url }))
    return foodFromRow(row, servings, sources)
  }

  listFoods(): Food[] {
    const rows = this.stmts.selectAllFoods.all() as unknown as FoodRow[]
    return rows.map((r) => this.loadFood(r)).sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Foods logged recently, most recent first, one per food. The honest
   * "frequent foods" list: what you actually eat, not what you remembered
   * to save.
   */
  recentFoods(limit = 20): Food[] {
    const all = (this.stmts.selectAllEntries.all() as unknown as EntryRow[]).map(entryFromRow)
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

    this.db.exec('BEGIN')
    try {
      this.stmts.upsertFood.run(food.id, ...foodColumnParams(food))
      this.stmts.deleteFoodServings.run(food.id)
      this.stmts.deleteFoodSources.run(food.id)
      ;(food.servings ?? []).forEach((s, i) => this.stmts.insertFoodServing.run(food.id, i, s.label, s.grams))
      ;(food.sources ?? []).forEach((s, i) => this.stmts.insertFoodSource.run(food.id, i, s.title, s.url))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return food
  }

  deleteFood(id: string): void {
    const result = this.stmts.deleteFood.run(id) // cascades servings/sources
    if (result.changes === 0) throw new ValidationError('no such food')
  }

  // --- meal presets --------------------------------------------------------

  private loadPreset(row: { id: string; name: string; created_at: number }): MealPreset {
    const items = (this.stmts.selectPresetItems.all(row.id) as unknown as PresetItemRow[]).map(presetItemFromRow)
    return { id: row.id, name: row.name, items, createdAt: row.created_at }
  }

  listPresets(): MealPreset[] {
    const rows = this.stmts.selectAllPresets.all() as unknown as { id: string; name: string; created_at: number }[]
    return rows.map((r) => this.loadPreset(r)).sort((a, b) => a.name.localeCompare(b.name))
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

    this.db.exec('BEGIN')
    try {
      this.stmts.upsertPreset.run(preset.id, preset.name, preset.createdAt)
      this.stmts.deletePresetItems.run(preset.id)
      preset.items.forEach((item, i) => this.stmts.insertPresetItem.run(preset.id, i, ...presetItemColumnParams(item)))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return preset
  }

  deletePreset(id: string): void {
    const result = this.stmts.deletePreset.run(id) // cascades items
    if (result.changes === 0) throw new ValidationError('no such meal')
  }

  /**
   * Logs every food in a saved meal to one date and meal-of-day, in one
   * action. date/meal are checked once upfront, common to every item, so a
   * bad one can't log the first few foods and then fail partway through.
   */
  applyPreset(id: string, date: string, meal: string): Entry[] {
    const row = this.stmts.selectPresetById.get(id) as unknown as { id: string; name: string; created_at: number } | undefined
    if (!row) throw new ValidationError('no such meal')
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(meal as Meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    const preset = this.loadPreset(row)
    return preset.items.map((item) => this.addEntry({ ...item, date, meal: meal as Meal }))
  }

  // --- goals and settings -----------------------------------------------------

  getGoals(): Goals {
    const row = this.stmts.selectGoals.get() as unknown as GoalsRow
    return { calories: row.calories, protein: row.protein, fat: row.fat, carbs: row.carbs, fiber: row.fiber }
  }

  setGoals(input: Partial<Goals>): Goals {
    const next = this.getGoals()
    for (const key of NUTRIENTS) {
      const v = (input as Record<string, unknown>)[key]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100_000) {
        throw new ValidationError(`goal ${key} must be a non-negative number`)
      }
      next[key] = v
    }
    this.stmts.updateGoals.run(next.calories, next.protein, next.fat, next.carbs, next.fiber)
    return next
  }

  getSettings(): Settings {
    const row = this.stmts.selectSettings.get() as unknown as SettingsRow
    return settingsFromRow(row)
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
    this.stmts.updateSettings.run(next.usdaApiKey, next.lmStudioUrl, next.lmStudioToken, next.researchModel, next.autoLookup ? 1 : 0)
    return this.getPublicSettings()
  }
}
