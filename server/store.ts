import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, StatementSync } from 'node:sqlite'
import { ALCOHOL_KINDS, MEALS, NUTRIENTS, WORKOUT_KINDS } from '../src/types.ts'
import type {
  AlcoholKind, AlcoholLog, Amount, DaySummary, DayType, DayView, Entry, Food, FoodSource, Goals,
  Meal, MealPreset, MealPresetItem, MeditationLog, NewEntry, Nutrients, NutrientKey, PerServing, PublicSettings,
  RangeView, Serving, Settings, SourceLink, WaterLog, WorkoutKind, WorkoutLog, WorkoutPlan,
} from '../src/types.ts'
import {
  addDays, alcoholCalories, blendGoals, DEFAULT_GOALS, daysBetween, isDateString, localDate, resolveGoals, round1, scale,
  scoreDays, scoreMeditation, scoreWater, startOfWeek, streakThrough, sumDay, TRAINING_KINDS,
} from '../src/lib/nutrition.ts'
import { DAY_TYPES } from '../src/types.ts'
import { LOOKUP_MAX, LOOKUP_TTL_MS, normalizeQuery } from './research.ts'
import type { ResearchResult } from './research.ts'
import { multiply } from '../src/lib/units.ts'

/**
 * Everything is kept on the machine running the server, so the log is shared
 * between devices and survives a phone clearing its storage.
 */

export class ValidationError extends Error {}

const MAX_NAME = 200
const BACKUP_KEEP = 20
/** 3 x 32oz bottles, the user's actual daily habit. */
const DEFAULT_WATER_OUNCES = DEFAULT_GOALS.water
const DEFAULT_ALCOHOL_WEEKLY = DEFAULT_GOALS.alcoholWeekly

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

/** How many drinks of each kind, from their log rows. */
function countByKind(rows: { kind: string }[]): Record<AlcoholKind, number> {
  const byKind = Object.fromEntries(ALCOHOL_KINDS.map((k) => [k, 0])) as Record<AlcoholKind, number>
  for (const r of rows) if (r.kind in byKind) byKind[r.kind as AlcoholKind]++
  return byKind
}

/** A goal amount: a finite, non-negative number within reason. */
function cleanGoalNumber(input: unknown, label: string, max = 100_000): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max) {
    throw new ValidationError(`goal ${label} must be a non-negative number`)
  }
  return input
}

function cleanDayType(input: unknown): DayType {
  if (!(DAY_TYPES as readonly string[]).includes(input as string)) {
    throw new ValidationError(`dayType must be one of ${DAY_TYPES.join(', ')}`)
  }
  return input as DayType
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
  base_protein REAL NOT NULL, base_fat REAL NOT NULL, base_carbs REAL NOT NULL, training_carbs REAL NOT NULL,
  fiber REAL NOT NULL, water_ounces REAL NOT NULL DEFAULT 96, alcohol_weekly REAL NOT NULL DEFAULT 7,
  workouts_weekly REAL NOT NULL DEFAULT 4, meditation_minutes REAL NOT NULL DEFAULT 10,
  calorie_buffer REAL NOT NULL DEFAULT 100, workout_plan TEXT);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1),
  usda_api_key TEXT NOT NULL DEFAULT '', lm_studio_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:1234',
  lm_studio_token TEXT NOT NULL DEFAULT '', research_model TEXT NOT NULL DEFAULT '', auto_lookup INTEGER NOT NULL DEFAULT 1);

-- No row for a date means a rest day (see getDayType): only the days you
-- tick as training days get a row.
CREATE TABLE IF NOT EXISTS day_types (date TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('training','rest')));

CREATE TABLE IF NOT EXISTS water_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, ounces REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_logs_date ON water_logs(date);

CREATE TABLE IF NOT EXISTS alcohol_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alcohol_logs_date ON alcohol_logs(date);

CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, minutes REAL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON workout_logs(date);

-- A week's own workout plan, when it differs from the default (goals.workout_plan).
CREATE TABLE IF NOT EXISTS workout_plans (week_start TEXT PRIMARY KEY, plan TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS meditation_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, minutes REAL NOT NULL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meditation_logs_date ON meditation_logs(date);

CREATE TABLE IF NOT EXISTS lookup_cache (
  key TEXT PRIMARY KEY, at INTEGER NOT NULL, result TEXT NOT NULL
);
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
  migrateSchema(db)
}

/**
 * In-place upgrades for a database created before a given schema addition,
 * gated by SQLite's own PRAGMA user_version so this only does work once.
 * CREATE TABLE IF NOT EXISTS above already handles a brand-new database;
 * this handles the same addition for one that existed before it, since
 * SQLite has no ADD COLUMN IF NOT EXISTS.
 */
function migrateSchema(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version < 1) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'water_ounces')) {
      db.exec(`ALTER TABLE goals ADD COLUMN water_ounces REAL NOT NULL DEFAULT ${DEFAULT_WATER_OUNCES}`)
    }
    db.exec('PRAGMA user_version = 1')
  }
  if (version < 2) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'alcohol_weekly')) {
      db.exec(`ALTER TABLE goals ADD COLUMN alcohol_weekly REAL NOT NULL DEFAULT ${DEFAULT_ALCOHOL_WEEKLY}`)
    }
    db.exec('PRAGMA user_version = 2')
  }
  if (version < 3) {
    // Version 3 once added per-day-type range columns to goals; version 4
    // replaced them, so a database coming through here only needs the
    // day_types table. (A database already at 3 keeps those columns, unused.)
    db.exec("CREATE TABLE IF NOT EXISTS day_types (date TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('training','rest')))")
    db.exec('PRAGMA user_version = 3')
  }
  if (version < 4) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    // One base set of macros plus a training-day carb bump, replacing the
    // per-day-type ranges (whose columns stay behind, unused, like the flat
    // ones before them: SQLite can't drop a column without a rebuild).
    const defaults: [string, number][] = [
      ['base_protein', DEFAULT_GOALS.protein], ['base_fat', DEFAULT_GOALS.fat],
      ['base_carbs', DEFAULT_GOALS.carbs], ['training_carbs', DEFAULT_GOALS.trainingCarbs],
    ]
    for (const [column, value] of defaults) {
      if (!has(column)) db.exec(`ALTER TABLE goals ADD COLUMN ${column} REAL NOT NULL DEFAULT ${value}`)
    }
    db.exec('PRAGMA user_version = 4')
  }
  if (version < 5) {
    // Workout and meditation goals; their log tables come from the schema above.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    if (!has('workouts_weekly')) db.exec(`ALTER TABLE goals ADD COLUMN workouts_weekly REAL NOT NULL DEFAULT 6`)
    if (!has('meditation_minutes')) db.exec(`ALTER TABLE goals ADD COLUMN meditation_minutes REAL NOT NULL DEFAULT ${DEFAULT_GOALS.meditationMinutes}`)
    db.exec('PRAGMA user_version = 5')
  }
  if (version < 6) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'calorie_buffer')) {
      db.exec(`ALTER TABLE goals ADD COLUMN calorie_buffer REAL NOT NULL DEFAULT ${DEFAULT_GOALS.calorieBuffer}`)
    }
    db.exec('PRAGMA user_version = 6')
  }
  if (version < 7) {
    // A plan per workout kind replaces the one weekly count (workouts_weekly stays behind, unused).
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'workout_plan')) db.exec('ALTER TABLE goals ADD COLUMN workout_plan TEXT')
    db.exec('CREATE TABLE IF NOT EXISTS workout_plans (week_start TEXT PRIMARY KEY, plan TEXT NOT NULL)')
    db.exec('PRAGMA user_version = 7')
  }
  if (version < 8) {
    // Weeks now start on Sunday: a week's own plan, stored by its Monday, moves to the day before.
    db.exec("UPDATE workout_plans SET week_start = date(week_start, '-1 day') WHERE strftime('%w', week_start) = '1'")
    db.exec('PRAGMA user_version = 8')
  }
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

function groupBy<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
  const out = new Map<T[K], T[]>()
  for (const r of rows) {
    const list = out.get(r[key])
    if (list) list.push(r)
    else out.set(r[key], [r])
  }
  return out
}

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

interface GoalsRow {
  base_protein: number; base_fat: number; base_carbs: number; training_carbs: number
  fiber: number; water_ounces: number; alcohol_weekly: number; meditation_minutes: number
  calorie_buffer: number; workout_plan: string | null
}
interface DayTypeRow { date: string; type: string }

const GOALS_COLUMNS = 'base_protein,base_fat,base_carbs,training_carbs,fiber,water_ounces,alcohol_weekly,meditation_minutes,calorie_buffer,workout_plan'
const GOALS_PLACEHOLDERS = GOALS_COLUMNS.split(',').map(() => '?').join(',')
const GOALS_ASSIGNMENTS = GOALS_COLUMNS.split(',').map((c) => `${c}=?`).join(', ')

function goalsFromRow(row: GoalsRow): Goals {
  return {
    protein: row.base_protein, fat: row.base_fat, carbs: row.base_carbs, trainingCarbs: row.training_carbs,
    fiber: row.fiber, water: row.water_ounces, alcoholWeekly: row.alcohol_weekly,
    meditationMinutes: row.meditation_minutes, calorieBuffer: row.calorie_buffer,
    workoutPlan: parsePlan(row.workout_plan) ?? DEFAULT_GOALS.workoutPlan,
  }
}

/** In GOALS_COLUMNS order. */
function goalsParams(g: Goals): SQLInputValue[] {
  return [g.protein, g.fat, g.carbs, g.trainingCarbs, g.fiber, g.water, g.alcoholWeekly, g.meditationMinutes, g.calorieBuffer, JSON.stringify(g.workoutPlan)]
}
interface AlcoholLogRow { id: string; date: string; kind: string; created_at: number }
interface WaterLogRow { id: string; date: string; ounces: number; created_at: number }
interface WorkoutLogRow { id: string; date: string; kind: string; minutes: number | null; note: string | null; created_at: number }
interface MeditationLogRow { id: string; date: string; minutes: number; note: string | null; created_at: number }

const workoutFromRow = (r: WorkoutLogRow): WorkoutLog => ({
  id: r.id, date: r.date, kind: r.kind as WorkoutKind, minutes: r.minutes, createdAt: r.created_at,
  ...(r.note ? { note: r.note } : {}),
})
const meditationFromRow = (r: MeditationLogRow): MeditationLog => ({
  id: r.id, date: r.date, minutes: r.minutes, createdAt: r.created_at, ...(r.note ? { note: r.note } : {}),
})

/** Minutes for a session: a positive number of them, within a day; null when not noted. */
function cleanMinutes(input: unknown, required: boolean): number | null {
  if (input == null || input === '') {
    if (required) throw new ValidationError('minutes is required')
    return null
  }
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > 24 * 60) {
    throw new ValidationError('minutes must be a positive number of minutes')
  }
  return Math.round(input)
}
/** A stored plan, every kind present; a missing or corrupt one reads as none. */
function parsePlan(raw: string | null): WorkoutPlan | undefined {
  if (!raw) return undefined
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(WORKOUT_KINDS.map((k) => [k, typeof obj[k] === 'number' ? obj[k] : 0])) as WorkoutPlan
  } catch {
    return undefined
  }
}

/** A plan from a client: whole numbers of sessions, 0-14 a week, for any kinds given (the rest are 0). */
function cleanPlan(input: unknown): WorkoutPlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('plan must be an object of sessions per kind')
  const src = input as Record<string, unknown>
  for (const k of Object.keys(src)) {
    if (!(WORKOUT_KINDS as readonly string[]).includes(k)) throw new ValidationError(`unknown workout kind: ${k}`)
  }
  return Object.fromEntries(WORKOUT_KINDS.map((k) => {
    const v = src[k] ?? 0
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 14) {
      throw new ValidationError(`${k} must be a whole number of sessions, 0 to 14`)
    }
    return [k, v]
  })) as WorkoutPlan
}

const planTotal = (plan: WorkoutPlan): number => WORKOUT_KINDS.reduce((sum, k) => sum + plan[k], 0)
const zeroByKind = (): Record<WorkoutKind, number> => Object.fromEntries(WORKOUT_KINDS.map((k) => [k, 0])) as Record<WorkoutKind, number>

const cleanNote = (input: unknown): string | undefined =>
  (typeof input === 'string' && input.trim() ? input.trim().slice(0, MAX_NAME) : undefined)
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
  // Goals predate this file's shape by years (calories/protein/fat/carbs as
  // flat numbers, no training/rest split) -- nothing left to carry over from
  // it, so a legacy log's own goals are never read, only the fresher fields.
  const raw = readJson<Partial<Omit<LegacyLog, 'goals'>>>(paths.legacyLog, {})
  const log: LegacyLog = {
    entries: raw.entries ?? {},
    foods: raw.foods ?? [],
    mealPresets: raw.mealPresets ?? [],
    goals: DEFAULT_GOALS,
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
    db.prepare(`INSERT INTO goals (id,${GOALS_COLUMNS}) VALUES (1,${GOALS_PLACEHOLDERS})`)
      .run(...goalsParams(log.goals))
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
  selectEntriesBetween: StatementSync
  selectRecentPerFood: StatementSync
  selectAllFoodServings: StatementSync
  selectAllFoodSources: StatementSync
  selectAllPresetItems: StatementSync
  selectAllLookups: StatementSync
  updateLookupResult: StatementSync
  insertEntry: StatementSync
  updateEntry: StatementSync
  deleteEntry: StatementSync
  selectAllFoods: StatementSync
  selectFood: StatementSync
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
  selectDayType: StatementSync
  selectDayTypesBetween: StatementSync
  upsertDayType: StatementSync
  selectSettings: StatementSync
  updateSettings: StatementSync
  selectWaterByDate: StatementSync
  selectWaterBetween: StatementSync
  insertWater: StatementSync
  deleteWater: StatementSync
  selectAlcoholByDate: StatementSync
  selectAlcoholBetween: StatementSync
  insertAlcohol: StatementSync
  deleteAlcohol: StatementSync
  selectWorkoutsByDate: StatementSync
  selectWorkoutsBetween: StatementSync
  insertWorkout: StatementSync
  deleteWorkout: StatementSync
  selectWeekPlan: StatementSync
  upsertWeekPlan: StatementSync
  deleteWeekPlan: StatementSync
  selectMeditationByDate: StatementSync
  selectMeditationBetween: StatementSync
  insertMeditation: StatementSync
  deleteMeditation: StatementSync
  selectLookup: StatementSync
  upsertLookup: StatementSync
  pruneLookups: StatementSync
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
      selectEntriesBetween: this.db.prepare('SELECT * FROM entries WHERE date >= ? AND date <= ?'),
      // The latest entry of each distinct food that can be logged again (it
      // has a per-100g or per-serving basis) -- deduplicated in SQL so this
      // never reads the whole log, however long it gets.
      selectRecentPerFood: this.db.prepare(`
        SELECT * FROM (
          SELECT *, rowid AS rid, ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(food_id, ''), name || '|' || COALESCE(brand, ''))
            ORDER BY created_at DESC, rowid DESC
          ) AS rn
          FROM entries
          WHERE has_per100g = 1 OR (has_per_unit = 1 AND amount_quantity IS NOT NULL)
        ) WHERE rn = 1 ORDER BY created_at DESC, rid DESC LIMIT ?`),
      selectAllFoodServings: this.db.prepare('SELECT * FROM food_servings ORDER BY food_id, position'),
      selectAllFoodSources: this.db.prepare('SELECT * FROM food_sources ORDER BY food_id, position'),
      selectAllPresetItems: this.db.prepare('SELECT * FROM meal_preset_items ORDER BY preset_id, position'),
      selectAllLookups: this.db.prepare('SELECT key, result FROM lookup_cache'),
      updateLookupResult: this.db.prepare('UPDATE lookup_cache SET result = ? WHERE key = ?'),
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
      selectFood: this.db.prepare('SELECT * FROM foods WHERE id = ?'),
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
      updateGoals: this.db.prepare(`UPDATE goals SET ${GOALS_ASSIGNMENTS} WHERE id=1`),
      selectDayType: this.db.prepare('SELECT * FROM day_types WHERE date = ?'),
      selectDayTypesBetween: this.db.prepare('SELECT * FROM day_types WHERE date >= ? AND date <= ?'),
      upsertDayType: this.db.prepare(
        'INSERT INTO day_types (date, type) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET type=excluded.type',
      ),
      selectSettings: this.db.prepare('SELECT * FROM settings WHERE id = 1'),
      updateSettings: this.db.prepare(
        'UPDATE settings SET usda_api_key=?, lm_studio_url=?, lm_studio_token=?, research_model=?, auto_lookup=? WHERE id=1',
      ),
      selectWaterByDate: this.db.prepare('SELECT * FROM water_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
      selectWaterBetween: this.db.prepare('SELECT * FROM water_logs WHERE date >= ? AND date <= ?'),
      insertWater: this.db.prepare('INSERT INTO water_logs (id,date,ounces,created_at) VALUES (?,?,?,?)'),
      deleteWater: this.db.prepare('DELETE FROM water_logs WHERE id = ?'),
      selectAlcoholByDate: this.db.prepare('SELECT * FROM alcohol_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
      selectAlcoholBetween: this.db.prepare('SELECT * FROM alcohol_logs WHERE date >= ? AND date <= ?'),
      insertAlcohol: this.db.prepare('INSERT INTO alcohol_logs (id,date,kind,created_at) VALUES (?,?,?,?)'),
      deleteAlcohol: this.db.prepare('DELETE FROM alcohol_logs WHERE id = ?'),
      selectWorkoutsByDate: this.db.prepare('SELECT * FROM workout_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
      selectWorkoutsBetween: this.db.prepare('SELECT * FROM workout_logs WHERE date >= ? AND date <= ?'),
      insertWorkout: this.db.prepare('INSERT INTO workout_logs (id,date,kind,minutes,note,created_at) VALUES (?,?,?,?,?,?)'),
      deleteWorkout: this.db.prepare('DELETE FROM workout_logs WHERE id = ?'),
      selectWeekPlan: this.db.prepare('SELECT plan FROM workout_plans WHERE week_start = ?'),
      upsertWeekPlan: this.db.prepare('INSERT INTO workout_plans (week_start, plan) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET plan=excluded.plan'),
      deleteWeekPlan: this.db.prepare('DELETE FROM workout_plans WHERE week_start = ?'),
      selectMeditationByDate: this.db.prepare('SELECT * FROM meditation_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
      selectMeditationBetween: this.db.prepare('SELECT * FROM meditation_logs WHERE date >= ? AND date <= ?'),
      insertMeditation: this.db.prepare('INSERT INTO meditation_logs (id,date,minutes,note,created_at) VALUES (?,?,?,?,?)'),
      deleteMeditation: this.db.prepare('DELETE FROM meditation_logs WHERE id = ?'),
      selectLookup: this.db.prepare('SELECT at, result FROM lookup_cache WHERE key = ?'),
      upsertLookup: this.db.prepare(
        'INSERT INTO lookup_cache (key,at,result) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at, result=excluded.result',
      ),
      pruneLookups: this.db.prepare(
        `DELETE FROM lookup_cache WHERE at < ? OR key NOT IN (SELECT key FROM lookup_cache ORDER BY at DESC LIMIT ${LOOKUP_MAX})`,
      ),
    }

    if (!this.stmts.selectGoals.get()) {
      this.db.prepare(`INSERT INTO goals (id,${GOALS_COLUMNS}) VALUES (1,${GOALS_PLACEHOLDERS})`)
        .run(...goalsParams(DEFAULT_GOALS))
    }
    if (!this.stmts.selectSettings.get()) {
      this.db.prepare('INSERT INTO settings (id,usda_api_key,lm_studio_url,lm_studio_token,research_model,auto_lookup) VALUES (1,?,?,?,?,?)')
        .run('', 'http://127.0.0.1:1234', '', '', 1)
    }

    this.importLegacyLookups()
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

  // --- online lookup cache ---------------------------------------------------

  /**
   * Finished online lookups, each a couple of minutes of the model's time.
   * Kept in the database rather than in a per-process file so every running
   * copy of the app shares one cache instead of overwriting each other's.
   */
  getLookup(key: string): ResearchResult | undefined {
    const row = this.stmts.selectLookup.get(key) as unknown as { at: number; result: string } | undefined
    if (!row || Date.now() - row.at > LOOKUP_TTL_MS) return undefined
    try {
      return JSON.parse(row.result) as ResearchResult
    } catch {
      return undefined
    }
  }

  setLookup(key: string, result: ResearchResult): void {
    this.stmts.upsertLookup.run(key, Date.now(), JSON.stringify(result))
    this.stmts.pruneLookups.run(Date.now() - LOOKUP_TTL_MS)
  }

  /** One-time import of the old lookups.json cache, re-keyed the new way; renamed, not deleted. */
  private importLegacyLookups(): void {
    const file = path.join(this.dataDir, 'lookups.json')
    if (!fs.existsSync(file)) return
    let saved: Record<string, { at: number; result: ResearchResult }>
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return
    }
    this.db.exec('BEGIN')
    try {
      for (const [k, v] of Object.entries(saved)) {
        // Empty answers are no longer cached at all, and old ones shouldn't be replayed.
        if (Date.now() - v.at < LOOKUP_TTL_MS && v.result?.foods?.length) {
          this.stmts.upsertLookup.run(normalizeQuery(k), v.at, JSON.stringify(v.result))
        }
      }
      this.stmts.pruneLookups.run(Date.now() - LOOKUP_TTL_MS)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      return
    }
    try { fs.renameSync(file, `${file}.migrated`) } catch { /* best effort */ }
  }

  // --- days and entries ------------------------------------------------------

  getDay(date: string): DayView {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const rows = this.stmts.selectEntriesByDate.all(date) as unknown as EntryRow[]
    const entries = rows.map(entryFromRow)
      .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.createdAt - b.createdAt)
    const dayType = this.getDayType(date)
    const goals = resolveGoals(this.getGoals(), dayType)
    const water = this.getWater(date, goals.water)
    // The drinks' calories are reported (alcohol.calories) but kept out of
    // the day's totals and goals: food is judged on its own.
    const alcohol = this.getAlcohol(date, goals.alcoholWeekly)
    const workouts = this.getWorkouts(date)
    const meditation = this.getMeditation(date, goals.meditationMinutes)
    return { date, entries, dayType, goals, water, alcohol, workouts, meditation, ...sumDay(entries) }
  }

  /**
   * A week or month at a glance: one summary per calendar day (including
   * empty ones, so a chart has a bar for every day) plus range-wide totals
   * and averages. See RangeView for how the averages are scoped.
   */
  getRange(start: string, end: string): RangeView {
    if (!isDateString(start)) throw new ValidationError('start must be YYYY-MM-DD')
    if (!isDateString(end)) throw new ValidationError('end must be YYYY-MM-DD')
    const span = daysBetween(start, end)
    if (span < 0) throw new ValidationError('end must not be before start')
    if (span >= 366) throw new ValidationError('range is too long (max 366 days)')

    const entriesByDate = groupBy(
      (this.stmts.selectEntriesBetween.all(start, end) as unknown as EntryRow[]).map(entryFromRow), 'date',
    )
    const waterByDate = groupBy(this.stmts.selectWaterBetween.all(start, end) as unknown as WaterLogRow[], 'date')
    const alcoholRows = this.stmts.selectAlcoholBetween.all(start, end) as unknown as AlcoholLogRow[]
    const alcoholByDate = groupBy(alcoholRows, 'date')
    const workoutRows = this.stmts.selectWorkoutsBetween.all(start, end) as unknown as WorkoutLogRow[]
    const workoutsByDate = groupBy(workoutRows, 'date')
    const meditationByDate = groupBy(this.stmts.selectMeditationBetween.all(start, end) as unknown as MeditationLogRow[], 'date')
    const dayTypeByDate = new Map(
      (this.stmts.selectDayTypesBetween.all(start, end) as unknown as DayTypeRow[]).map((r) => [r.date, r.type]),
    )

    const goals = this.getGoals()
    const days: DaySummary[] = []
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const dayEntries = entriesByDate.get(date) ?? []
      const water = (waterByDate.get(date) ?? []).reduce((sum, r) => sum + r.ounces, 0)
      const dayType: DayType = dayTypeByDate.get(date) === 'training' ? 'training' : 'rest'
      const drinks = alcoholByDate.get(date) ?? []
      const sessions = workoutsByDate.get(date) ?? []
      days.push({
        date, entryCount: dayEntries.length, dayType, goals: resolveGoals(goals, dayType), water,
        alcohol: drinks.length,
        workouts: sessions.length,
        workoutMinutes: sessions.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
        meditationMinutes: (meditationByDate.get(date) ?? []).reduce((sum, r) => sum + r.minutes, 0),
        ...sumDay(dayEntries),
      })
    }
    const dayTypes: Record<DayType, number> = {
      training: days.filter((d) => d.dayType === 'training').length,
      rest: days.filter((d) => d.dayType === 'rest').length,
    }

    const totalDays = days.length
    const loggedDays = days.filter((d) => d.entryCount > 0).length
    const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
    for (const d of days) for (const key of NUTRIENTS) totals[key] += d.totals[key]
    for (const key of NUTRIENTS) totals[key] = round1(totals[key])

    // Averages and scores count finished days only: today is still being
    // logged (a half-eaten day would drag the calories down and count as a
    // protein miss), and the days still ahead haven't happened. Before any
    // day in the range has finished -- the 1st of a month -- today stands in.
    const today = localDate()
    const finished = days.filter((d) => d.date < today)
    const basis = finished.length ? finished : days.filter((d) => d.date === today)
    const per = (sum: number): number => (basis.length ? round1(sum / basis.length) : 0)
    const loggedBasis = basis.filter((d) => d.entryCount > 0)
    const averages = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
    if (loggedBasis.length) {
      for (const key of NUTRIENTS) averages[key] = round1(loggedBasis.reduce((s, d) => s + d.totals[key], 0) / loggedBasis.length)
    }

    const waterTotal = days.reduce((sum, d) => sum + d.water, 0)
    const alcoholTotal = days.reduce((sum, d) => sum + d.alcohol, 0)
    const byKind = countByKind(alcoholRows)

    const workoutsByKind = zeroByKind()
    for (const r of workoutRows) if (r.kind in workoutsByKind) workoutsByKind[r.kind as WorkoutKind]++
    // Each day carries a seventh of its own week's plan, so a range that cuts a week
    // (a month starting midweek) gets that share of it; whole weeks come out exact.
    const plans = new Map<string, WorkoutPlan>()
    const goalShare = zeroByKind()
    for (const d of days) {
      const week = startOfWeek(d.date)
      if (!plans.has(week)) plans.set(week, this.planForWeek(week).plan)
      for (const k of WORKOUT_KINDS) goalShare[k] += plans.get(week)![k] / 7
    }
    const goalByKind = Object.fromEntries(WORKOUT_KINDS.map((k) => [k, Math.round(goalShare[k])])) as Record<WorkoutKind, number>
    const meditationTotal = days.reduce((sum, d) => sum + d.meditationMinutes, 0)
    // A streak runs up to today at the latest -- the days still ahead can't have broken it -- and a
    // today with nothing logged yet doesn't break it either: it counts back from yesterday until it does.
    const lastDay = end < today ? end : today
    const todayStarted = days.some((d) => d.date === today && d.meditationMinutes > 0)
    const through = lastDay === today && !todayStarted ? addDays(today, -1) : lastDay

    return {
      start, end, days, goals: blendGoals(days.map((d) => d.goals)), dayTypes, scorecard: scoreDays(basis),
      totalDays, loggedDays, averagedDays: basis.length, totals, averages,
      water: { total: round1(waterTotal), average: per(basis.reduce((s, d) => s + d.water, 0)), ...scoreWater(basis, goals.water) },
      alcohol: { total: alcoholTotal, average: per(basis.reduce((s, d) => s + d.alcohol, 0)), calories: alcoholCalories(byKind), byKind },
      workouts: {
        sessions: workoutRows.length,
        days: days.filter((d) => d.workouts > 0).length,
        minutes: days.reduce((sum, d) => sum + d.workoutMinutes, 0),
        byKind: workoutsByKind,
        goalByKind,
        goal: WORKOUT_KINDS.reduce((sum, k) => sum + goalByKind[k], 0),
      },
      meditation: {
        total: meditationTotal,
        average: per(basis.reduce((s, d) => s + d.meditationMinutes, 0)),
        days: days.filter((d) => d.meditationMinutes > 0).length,
        ...scoreMeditation(basis, goals.meditationMinutes),
        streak: streakThrough(days, (d) => d.meditationMinutes > 0, through),
      },
    }
  }

  /** This day's sessions, plus its calendar week (Sunday-start): each kind's count against that week's plan. */
  private getWorkouts(date: string): DayView['workouts'] {
    const sessions = (this.stmts.selectWorkoutsByDate.all(date) as unknown as WorkoutLogRow[]).map(workoutFromRow)
    const weekStart = startOfWeek(date)
    const weekRows = this.stmts.selectWorkoutsBetween.all(weekStart, addDays(weekStart, 6)) as unknown as WorkoutLogRow[]
    const weekByKind = zeroByKind()
    for (const r of weekRows) if (r.kind in weekByKind) weekByKind[r.kind as WorkoutKind]++
    const { plan, custom } = this.planForWeek(weekStart)
    return {
      sessions, minutes: sessions.reduce((sum, s) => sum + (s.minutes ?? 0), 0),
      weekStart, plan, planIsCustom: custom, weekByKind,
      weekTotal: weekRows.length, weekGoal: planTotal(plan), lastLogId: sessions[0]?.id ?? null,
    }
  }

  /** A week's own plan if it has one, else the default from Settings. */
  planForWeek(weekStart: string): { plan: WorkoutPlan; custom: boolean } {
    const row = this.stmts.selectWeekPlan.get(weekStart) as { plan: string } | undefined
    const own = row ? parsePlan(row.plan) : undefined
    return own ? { plan: own, custom: true } : { plan: this.getGoals().workoutPlan, custom: false }
  }

  /** Give one week (by its Sunday) its own plan; other weeks keep theirs, or the default. */
  setWeekPlan(weekStart: string, plan: unknown): WorkoutPlan {
    if (!isDateString(weekStart) || startOfWeek(weekStart) !== weekStart) throw new ValidationError('weekStart must be a Sunday, YYYY-MM-DD')
    const clean = cleanPlan(plan)
    this.stmts.upsertWeekPlan.run(weekStart, JSON.stringify(clean))
    return clean
  }

  /** Put a week back on the default plan. */
  clearWeekPlan(weekStart: string): void {
    if (!isDateString(weekStart)) throw new ValidationError('weekStart must be YYYY-MM-DD')
    this.stmts.deleteWeekPlan.run(weekStart)
  }

  private getMeditation(date: string, goal: number): DayView['meditation'] {
    const sessions = (this.stmts.selectMeditationByDate.all(date) as unknown as MeditationLogRow[]).map(meditationFromRow)
    return { sessions, minutes: sessions.reduce((sum, s) => sum + s.minutes, 0), goal, lastLogId: sessions[0]?.id ?? null }
  }

  /**
   * One workout session. A WOD or weightlifting session is what a training
   * day is, so logging one ticks the day as training -- the extra carbs
   * apply without a second tap. Other kinds (a ride, yoga) leave the day
   * type alone, and the box in Day view can still be changed by hand.
   */
  addWorkout(input: { date?: unknown; kind?: unknown; minutes?: unknown; note?: unknown }): WorkoutLog {
    const { date, kind } = input
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (typeof kind !== 'string' || !(WORKOUT_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError(`kind must be one of ${WORKOUT_KINDS.join(', ')}`)
    }
    const note = cleanNote(input.note)
    const log: WorkoutLog = {
      id: randomUUID(), date, kind: kind as WorkoutKind, minutes: cleanMinutes(input.minutes, false), createdAt: Date.now(),
      ...(note ? { note } : {}),
    }
    this.stmts.insertWorkout.run(log.id, log.date, log.kind, log.minutes, log.note ?? null, log.createdAt)
    if (TRAINING_KINDS.has(log.kind)) this.stmts.upsertDayType.run(date, 'training')
    return log
  }

  deleteWorkout(id: string): void {
    const result = this.stmts.deleteWorkout.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  /** One sit, in minutes. */
  addMeditation(input: { date?: unknown; minutes?: unknown; note?: unknown }): MeditationLog {
    const { date } = input
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const note = cleanNote(input.note)
    const log: MeditationLog = {
      id: randomUUID(), date, minutes: cleanMinutes(input.minutes, true)!, createdAt: Date.now(), ...(note ? { note } : {}),
    }
    this.stmts.insertMeditation.run(log.id, log.date, log.minutes, log.note ?? null, log.createdAt)
    return log
  }

  deleteMeditation(id: string): void {
    const result = this.stmts.deleteMeditation.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  private getWater(date: string, goal: number): DayView['water'] {
    const rows = this.stmts.selectWaterByDate.all(date) as unknown as WaterLogRow[]
    const ounces = rows.reduce((sum, r) => sum + r.ounces, 0)
    return { ounces, goal, lastLogId: rows[0]?.id ?? null }
  }

  /** This day's drinks, plus the calendar week's (Sunday-start, today included) against its own goal. */
  private getAlcohol(date: string, weekGoal: number): DayView['alcohol'] {
    const rows = this.stmts.selectAlcoholByDate.all(date) as unknown as AlcoholLogRow[]
    const byKind = Object.fromEntries(ALCOHOL_KINDS.map((k) => [k, 0])) as Record<AlcoholKind, number>
    for (const r of rows) if (r.kind in byKind) byKind[r.kind as AlcoholKind]++
    const weekStart = startOfWeek(date)
    const weekEnd = addDays(weekStart, 6)
    const weekTotal = (this.stmts.selectAlcoholBetween.all(weekStart, weekEnd) as unknown as AlcoholLogRow[]).length
    return { drinks: rows.length, byKind, calories: alcoholCalories(byKind), weekTotal, weekGoal, lastLogId: rows[0]?.id ?? null }
  }

  /** One standard drink for one day. Just a record -- there is no goal to hit. */
  addAlcohol(date: string, kind: string): AlcoholLog {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!(ALCOHOL_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError(`kind must be one of ${ALCOHOL_KINDS.join(', ')}`)
    }
    const log: AlcoholLog = { id: randomUUID(), date, kind: kind as AlcoholKind, createdAt: Date.now() }
    this.stmts.insertAlcohol.run(log.id, log.date, log.kind, log.createdAt)
    return log
  }

  deleteAlcohol(id: string): void {
    const result = this.stmts.deleteAlcohol.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  /** One water log for one day -- a bottle, a glass, whatever amount was drunk. */
  addWater(date: string, ounces: number): WaterLog {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (typeof ounces !== 'number' || !Number.isFinite(ounces) || ounces <= 0 || ounces > 200) {
      throw new ValidationError('ounces must be a positive number')
    }
    const log: WaterLog = { id: randomUUID(), date, ounces, createdAt: Date.now() }
    this.stmts.insertWater.run(log.id, log.date, log.ounces, log.createdAt)
    return log
  }

  deleteWater(id: string): void {
    const result = this.stmts.deleteWater.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
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
    // Corrected numbers are for the portion as it was logged, so apply them
    // before any amount change in the same patch rescales from the new basis.
    const corrected = patch.nutrients === undefined ? [] : this.correctNutrients(entry, patch.nutrients)
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

    this.stmts.updateEntry.run(...entryColumnParams(entry), entry.id)
    if (corrected.length && entry.foodId) this.correctSavedFood(entry, corrected)
    return entry
  }

  /**
   * Fix numbers on an entry -- fiber a database left out, a value a lookup got
   * wrong -- whatever its source. Only the ones that actually differ change,
   * and the per-100g / per-serving basis they came from is corrected too, so
   * a later weight or quantity edit scales the corrected numbers rather than
   * quietly restoring the published ones. Returns which nutrients changed.
   */
  private correctNutrients(entry: Entry, input: unknown): NutrientKey[] {
    const edited = cleanNutrients(input, 'nutrients')
    const changed = NUTRIENTS.filter((k) => edited[k] !== entry.nutrients[k])
    const quantity = entry.amount?.quantity
    for (const k of changed) {
      const v = edited[k]
      entry.nutrients = { ...entry.nutrients, [k]: v }
      if (entry.per100g && entry.grams != null && entry.grams > 0) {
        entry.per100g = { ...entry.per100g, [k]: v == null ? null : (v * 100) / entry.grams }
      }
      if (entry.perUnit && quantity != null && quantity > 0) {
        entry.perUnit = { ...entry.perUnit, [k]: v == null ? null : v / quantity }
      }
    }
    return changed
  }

  /** The saved food an entry was logged from gets the same correction, so future logs have it. */
  private correctSavedFood(entry: Entry, changed: NutrientKey[]): void {
    const row = this.stmts.selectFood.get(entry.foodId!) as unknown as FoodRow | undefined
    if (!row) return
    const food = this.loadFood(row)
    let touched = false
    if (food.per100g && entry.per100g) {
      food.per100g = { ...food.per100g }
      for (const k of changed) food.per100g[k] = entry.per100g[k]
      touched = true
    }
    if (food.perServing && entry.perUnit) {
      food.perServing = { ...food.perServing, nutrients: { ...food.perServing.nutrients } }
      for (const k of changed) food.perServing.nutrients[k] = entry.perUnit[k]
      touched = true
    }
    if (touched) this.writeFood(food)
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
    const servings = groupBy(this.stmts.selectAllFoodServings.all() as unknown as { food_id: string; label: string; grams: number }[], 'food_id')
    const sources = groupBy(this.stmts.selectAllFoodSources.all() as unknown as { food_id: string; title: string; url: string }[], 'food_id')
    return rows
      .map((r) => foodFromRow(
        r,
        (servings.get(r.id) ?? []).map((x) => ({ label: x.label, grams: x.grams })),
        (sources.get(r.id) ?? []).map((x) => ({ title: x.title, url: x.url })),
      ))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Foods logged recently, most recent first, one per food. The honest
   * "frequent foods" list: what you actually eat, not what you remembered
   * to save.
   */
  recentFoods(limit = 20): Food[] {
    const latest = (this.stmts.selectRecentPerFood.all(limit) as unknown as EntryRow[]).map(entryFromRow)
    const out: Food[] = []
    for (const e of latest) {
      const key = e.foodId || `${e.name}|${e.brand ?? ''}`
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

    this.writeFood(food)
    return food
  }

  private writeFood(food: Food): void {
    this.db.exec('BEGIN')
    try {
      this.stmts.upsertFood.run(food.id, ...foodColumnParams(food))
      this.stmts.deleteFoodServings.run(food.id)
      this.stmts.deleteFoodSources.run(food.id)
      ;(food.servings ?? []).forEach((s, i) => this.stmts.insertFoodServing.run(food.id, i, s.label, s.grams))
      ;(food.sources ?? []).forEach((s, i) => this.stmts.insertFoodSource.run(food.id, i, s.title, s.url))
      this.syncCachedLookups(food)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * A cached online lookup that found this food shows the saved copy from
   * now on, so a correction (fiber filled in, a wrong value fixed) isn't
   * undone by picking the same food from a repeat lookup. The cache's age
   * is left alone: this isn't a fresh lookup.
   */
  private syncCachedLookups(food: Food): void {
    for (const row of this.stmts.selectAllLookups.all() as unknown as { key: string; result: string }[]) {
      if (!row.result.includes(JSON.stringify(food.id))) continue
      let result: ResearchResult
      try { result = JSON.parse(row.result) as ResearchResult } catch { continue }
      if (!result.foods.some((f) => f.id === food.id)) continue
      result.foods = result.foods.map((f) => (f.id === food.id ? food : f))
      this.stmts.updateLookupResult.run(JSON.stringify(result), row.key)
    }
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
    const items = groupBy(this.stmts.selectAllPresetItems.all() as unknown as (PresetItemRow & { preset_id: string })[], 'preset_id')
    return rows
      .map((r) => ({ id: r.id, name: r.name, items: (items.get(r.id) ?? []).map(presetItemFromRow), createdAt: r.created_at }))
      .sort((a, b) => a.name.localeCompare(b.name))
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
    // All or nothing: a food that fails validation partway must not leave
    // the ones before it logged.
    this.db.exec('BEGIN')
    try {
      const entries = preset.items.map((item) => this.addEntry({ ...item, date, meal: meal as Meal }))
      this.db.exec('COMMIT')
      return entries
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // --- goals and settings -----------------------------------------------------

  getGoals(): Goals {
    return goalsFromRow(this.stmts.selectGoals.get() as unknown as GoalsRow)
  }

  /** Change any of the goals; fields left out stay as they were. */
  setGoals(input: Partial<Goals>): Goals {
    const next = this.getGoals()
    if (input.protein !== undefined) next.protein = cleanGoalNumber(input.protein, 'protein')
    if (input.fat !== undefined) next.fat = cleanGoalNumber(input.fat, 'fat')
    if (input.carbs !== undefined) next.carbs = cleanGoalNumber(input.carbs, 'carbs')
    if (input.trainingCarbs !== undefined) next.trainingCarbs = cleanGoalNumber(input.trainingCarbs, 'trainingCarbs')
    if (input.calorieBuffer !== undefined) next.calorieBuffer = cleanGoalNumber(input.calorieBuffer, 'calorieBuffer', 2000)
    if (input.fiber !== undefined) next.fiber = cleanGoalNumber(input.fiber, 'fiber', 1000)
    if (input.water !== undefined) next.water = cleanGoalNumber(input.water, 'water', 1000)
    if (input.alcoholWeekly !== undefined) next.alcoholWeekly = cleanGoalNumber(input.alcoholWeekly, 'alcoholWeekly', 1000)
    if (input.workoutPlan !== undefined) next.workoutPlan = cleanPlan(input.workoutPlan)
    if (input.meditationMinutes !== undefined) next.meditationMinutes = cleanGoalNumber(input.meditationMinutes, 'meditationMinutes', 1440)
    this.stmts.updateGoals.run(...goalsParams(next))
    return next
  }

  /**
   * No row for a date means it was never marked -- a rest day. Training is
   * the thing you tick off (the "Training day" box in Day view), so a day
   * nobody touched can't claim the higher targets by default.
   */
  getDayType(date: string): DayType {
    const row = this.stmts.selectDayType.get(date) as unknown as DayTypeRow | undefined
    return row?.type === 'training' ? 'training' : 'rest'
  }

  setDayType(date: string, type: unknown): DayType {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const clean = cleanDayType(type)
    this.stmts.upsertDayType.run(date, clean)
    return clean
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
