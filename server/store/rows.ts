import type { SQLInputValue } from 'node:sqlite'
import { ALCOHOL_KINDS, APP_ICONS, CHARTABLE, DEFAULT_CHARTS, DEFAULT_WORKOUT_KINDS } from '../../src/types.ts'
import type {
  AlcoholKind, AppIcon, ChartKey, DogWalkLog, Entry, Equipment, Food, FoodSource, Goals, Meal, MealPresetItem, MeditationLog,
  Nutrients, Serving, Settings, SourceLink, WorkoutKind, WorkoutKindDef, WorkoutLog, WorkoutPlan,
} from '../../src/types.ts'
import { DEFAULT_GOALS } from '../../src/lib/nutrition.ts'
import { cleanWorkoutKinds } from './clean.ts'
import { cleanEquipment, NO_EQUIPMENT } from '../../src/lib/training/schema.ts'

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

export function groupBy<T, K extends keyof T>(rows: T[], key: K): Map<T[K], T[]> {
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

export interface EntryRow {
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

export function entryFromRow(row: EntryRow): Entry {
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
export function entryColumnParams(e: Entry): SQLInputValue[] {
  return [
    e.date, e.meal, e.name, e.brand ?? null, e.grams,
    e.amount?.quantity ?? null, e.amount?.unit ?? null, e.amount?.unitGrams ?? null,
    ...nutrientValues(e.nutrients),
    e.per100g ? 1 : 0, ...nutrientValues(e.per100g ?? NO_NUTRIENTS),
    e.perUnit ? 1 : 0, ...nutrientValues(e.perUnit ?? NO_NUTRIENTS),
    e.foodId ?? null, e.source, e.createdAt,
  ]
}

export interface FoodRow {
  id: string; name: string; brand: string | null; source: string; source_id: string | null
  has_per100g: number
  per100g_calories: number | null; per100g_protein: number | null; per100g_fat: number | null
  per100g_carbs: number | null; per100g_fiber: number | null
  has_per_serving: number; per_serving_label: string | null; per_serving_grams: number | null
  per_serving_nutrients_calories: number | null; per_serving_nutrients_protein: number | null
  per_serving_nutrients_fat: number | null; per_serving_nutrients_carbs: number | null; per_serving_nutrients_fiber: number | null
  note: string | null
}

export function foodFromRow(row: FoodRow, servings: Serving[], sources: SourceLink[]): Food {
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

export function foodColumnParams(f: Food): SQLInputValue[] {
  const ps = f.perServing
  return [
    f.name, f.brand ?? null, f.source, f.sourceId ?? null,
    f.per100g ? 1 : 0, ...nutrientValues(f.per100g ?? NO_NUTRIENTS),
    ps ? 1 : 0, ps?.label ?? null, ps?.grams ?? null, ...nutrientValues(ps?.nutrients ?? NO_NUTRIENTS),
    f.note ?? null,
  ]
}

export interface PresetItemRow {
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

export function presetItemFromRow(row: PresetItemRow): MealPresetItem {
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

export function presetItemColumnParams(item: MealPresetItem): SQLInputValue[] {
  return [
    item.name, item.brand ?? null, item.grams,
    item.amount?.quantity ?? null, item.amount?.unit ?? null, item.amount?.unitGrams ?? null,
    item.per100g ? 1 : 0, ...nutrientValues(item.per100g ?? NO_NUTRIENTS),
    item.perUnit ? 1 : 0, ...nutrientValues(item.perUnit ?? NO_NUTRIENTS),
    item.nutrients ? 1 : 0, ...nutrientValues(item.nutrients ?? NO_NUTRIENTS),
    item.foodId ?? null, item.source,
  ]
}

export interface GoalsRow {
  max_calories: number; base_protein: number; base_fat: number
  fiber: number; water_ounces: number; alcohol_weekly: number; meditation_minutes: number
  workout_plan: string | null
  dog_walks: number; walk_miles: number
}

export const GOALS_COLUMNS = 'max_calories,base_protein,base_fat,fiber,water_ounces,alcohol_weekly,meditation_minutes,workout_plan,dog_walks,walk_miles'
export const GOALS_PLACEHOLDERS = GOALS_COLUMNS.split(',').map(() => '?').join(',')
export const GOALS_ASSIGNMENTS = GOALS_COLUMNS.split(',').map((c) => `${c}=?`).join(', ')

export function goalsFromRow(row: GoalsRow, kinds: string[]): Goals {
  return {
    calories: row.max_calories, protein: row.base_protein, fat: row.base_fat,
    fiber: row.fiber, water: row.water_ounces, alcoholWeekly: row.alcohol_weekly,
    meditationMinutes: row.meditation_minutes,
    // Every kind in Settings gets an entry; the built-in plan only where the stored one has none.
    workoutPlan: parsePlan(row.workout_plan ?? JSON.stringify(DEFAULT_GOALS.workoutPlan), kinds) ?? zeroByKind(kinds),
    dogWalks: row.dog_walks, walkMiles: row.walk_miles,
  }
}

/** In GOALS_COLUMNS order. */
export function goalsParams(g: Goals): SQLInputValue[] {
  return [g.calories, g.protein, g.fat, g.fiber, g.water, g.alcoholWeekly, g.meditationMinutes, JSON.stringify(g.workoutPlan), g.dogWalks, g.walkMiles]
}
export interface AlcoholLogRow { id: string; date: string; kind: string; created_at: number }
export interface WaterLogRow { id: string; date: string; ounces: number; drink: string; created_at: number }
export interface WorkoutLogRow { id: string; date: string; kind: string; minutes: number | null; note: string | null; created_at: number }
export interface MeditationLogRow { id: string; date: string; minutes: number; note: string | null; created_at: number }
export interface DogWalkLogRow { id: string; date: string; miles: number; created_at: number }
export const dogWalkFromRow = (r: DogWalkLogRow): DogWalkLog => ({ id: r.id, date: r.date, miles: r.miles, createdAt: r.created_at })

export const workoutFromRow = (r: WorkoutLogRow): WorkoutLog => ({
  id: r.id, date: r.date, kind: r.kind as WorkoutKind, minutes: r.minutes, createdAt: r.created_at,
  ...(r.note ? { note: r.note } : {}),
})
export const meditationFromRow = (r: MeditationLogRow): MeditationLog => ({
  id: r.id, date: r.date, minutes: r.minutes, createdAt: r.created_at, ...(r.note ? { note: r.note } : {}),
})

/** How many drinks of each kind, from their log rows. */
export function countByKind(rows: { kind: string }[]): Record<AlcoholKind, number> {
  const byKind = Object.fromEntries(ALCOHOL_KINDS.map((k) => [k, 0])) as Record<AlcoholKind, number>
  for (const r of rows) if (r.kind in byKind) byKind[r.kind as AlcoholKind]++
  return byKind
}

/**
 * A stored plan, one entry per kind now in Settings; a missing or corrupt
 * one reads as none. A kind added since starts at 0; one removed since is
 * left out, its count kept in the row in case it comes back.
 */
export function parsePlan(raw: string | null, kinds: string[]): WorkoutPlan | undefined {
  if (!raw) return undefined
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(kinds.map((k) => [k, typeof obj[k] === 'number' ? obj[k] : 0])) as WorkoutPlan
  } catch {
    return undefined
  }
}

export const planTotal = (plan: WorkoutPlan): number => Object.values(plan).reduce((sum, n) => sum + n, 0)
export const zeroByKind = (kinds: string[]): Record<WorkoutKind, number> => Object.fromEntries(kinds.map((k) => [k, 0])) as Record<WorkoutKind, number>

/** The stored activities; never set, or unreadable, is the built-in six. */
function parseWorkoutKinds(raw: string | null): WorkoutKindDef[] {
  if (raw == null) return DEFAULT_WORKOUT_KINDS.map((k) => ({ ...k }))
  try {
    return cleanWorkoutKinds(JSON.parse(raw))
  } catch {
    return DEFAULT_WORKOUT_KINDS.map((k) => ({ ...k }))
  }
}

export interface BodyRow { metric: string; measured_at: number; date: string; value: number }

export interface SettingsRow {
  usda_api_key: string; lm_studio_url: string; lm_studio_token: string; research_model: string; auto_lookup: number
  app_icon: string; charts: string | null; workout_kinds: string | null; notes_model: string | null; label_model: string | null
  preferred_model: string | null; equipment: string | null; training_model: string | null; plan_chat_model: string | null
}
export function settingsFromRow(row: SettingsRow): Settings {
  return {
    usdaApiKey: row.usda_api_key, lmStudioUrl: row.lm_studio_url, lmStudioToken: row.lm_studio_token,
    researchModel: row.research_model, notesModel: row.notes_model ?? '', labelModel: row.label_model ?? '',
    preferredModel: row.preferred_model ?? '', autoLookup: row.auto_lookup === 1,
    appIcon: (APP_ICONS as readonly string[]).includes(row.app_icon) ? row.app_icon as AppIcon : 'ring',
    charts: parseCharts(row.charts),
    workoutKinds: parseWorkoutKinds(row.workout_kinds),
    trainingModel: row.training_model ?? '',
    planChatModel: row.plan_chat_model ?? '',
    equipment: parseEquipment(row.equipment),
  }
}

function parseEquipment(raw: string | null): Equipment {
  if (!raw) return { ...NO_EQUIPMENT }
  try { return cleanEquipment(JSON.parse(raw)) } catch { return { ...NO_EQUIPMENT } }
}

/** The stored chart list, in CHARTABLE order; never set, or unreadable, is the default. An empty list is a real choice of none. */
function parseCharts(raw: string | null): ChartKey[] {
  if (raw == null) return [...DEFAULT_CHARTS]
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return [...DEFAULT_CHARTS]
    return CHARTABLE.filter((k) => list.includes(k))
  } catch {
    return [...DEFAULT_CHARTS]
  }
}
