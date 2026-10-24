import { NUTRIENTS, WORKOUT_ICONS, DAY_TYPES } from '../../src/types.ts'
import type { Amount, BodyMetric, DayType, FoodSource, Nutrients, PerServing, SourceLink, WorkoutKindDef, WorkoutPlan } from '../../src/types.ts'

// ---------------------------------------------------------------------------
// Validating what a client sends
// ---------------------------------------------------------------------------

export class ValidationError extends Error {}

export const MAX_NAME = 200

/** A nutrient value is a finite, non-negative number, or null for unknown. */
export function cleanNutrients(input: unknown, label: string): Nutrients {
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

export function cleanName(v: unknown, label = 'name'): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new ValidationError(`${label} is required`)
  return s.slice(0, MAX_NAME)
}

export function cleanGrams(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 10_000) {
    throw new ValidationError('grams must be a positive number')
  }
  return v
}

export const cleanSource = (v: unknown): FoodSource =>
  (v === 'usda' || v === 'off' || v === 'web' ? v : 'custom')

const cleanLabel = (v: unknown, label: string): string => {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new ValidationError(`${label} is required`)
  return s.slice(0, 100)
}

/** 1.5 x "1 cup"; the unit's weight when known. */
export function cleanAmount(input: unknown): Amount {
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

/** A goal amount: a finite, non-negative number within reason. */
export function cleanGoalNumber(input: unknown, label: string, max = 100_000): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 0 || input > max) {
    throw new ValidationError(`goal ${label} must be a non-negative number`)
  }
  return input
}

export function cleanDayType(input: unknown): DayType {
  if (!(DAY_TYPES as readonly string[]).includes(input as string)) {
    throw new ValidationError(`dayType must be one of ${DAY_TYPES.join(', ')}`)
  }
  return input as DayType
}

export function cleanPerServing(input: unknown): PerServing | undefined {
  if (input == null) return undefined
  const ps = input as Partial<PerServing>
  return {
    label: cleanLabel(ps.label, 'perServing.label'),
    grams: ps.grams == null ? null : cleanGrams(ps.grams),
    nutrients: cleanNutrients(ps.nutrients, 'perServing.nutrients'),
  }
}

/** Only http(s) links, so a looked-up food can't carry a javascript: URL into the page. */
export function cleanSources(input: unknown): SourceLink[] | undefined {
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

/** Minutes for a session: a positive number of them, within a day; null when not noted. */
export function cleanMinutes(input: unknown, required: boolean): number | null {
  if (input == null || input === '') {
    if (required) throw new ValidationError('minutes is required')
    return null
  }
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > 24 * 60) {
    throw new ValidationError('minutes must be a positive number of minutes')
  }
  return Math.round(input)
}

/** A plan from a client: whole numbers of sessions, 0-14 a week, for any of the kinds in Settings (the rest are 0). */
export function cleanPlan(input: unknown, kinds: string[]): WorkoutPlan {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('plan must be an object of sessions per kind')
  const src = input as Record<string, unknown>
  for (const k of Object.keys(src)) {
    if (!kinds.includes(k)) throw new ValidationError(`unknown workout kind: ${k}`)
  }
  return Object.fromEntries(kinds.map((k) => {
    const v = src[k] ?? 0
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 14) {
      throw new ValidationError(`${k} must be a whole number of sessions, 0 to 14`)
    }
    return [k, v]
  })) as WorkoutPlan
}

const KIND_ID = /^[a-z0-9][a-z0-9_-]{0,23}$/
const MAX_WORKOUT_KINDS = 20

/**
 * The activities from a client: 1 to 20 of them, each with an id (lower-case
 * letters, digits, - or _; unique), a label, one of the known icons and a
 * training flag. The id is what logs and plans are stored under, so the
 * client keeps it fixed once an activity exists.
 */
export function cleanWorkoutKinds(input: unknown): WorkoutKindDef[] {
  if (!Array.isArray(input) || !input.length || input.length > MAX_WORKOUT_KINDS) {
    throw new ValidationError(`workoutKinds must be a list of 1 to ${MAX_WORKOUT_KINDS} activities`)
  }
  const seen = new Set<string>()
  return input.map((raw, i) => {
    const k = (raw ?? {}) as Record<string, unknown>
    const id = typeof k.id === 'string' ? k.id.trim() : ''
    const label = typeof k.label === 'string' ? k.label.trim().slice(0, 24) : ''
    if (!KIND_ID.test(id)) throw new ValidationError(`activity ${i + 1}: id must be lower-case letters, digits, - or _`)
    if (seen.has(id)) throw new ValidationError(`activity ids must be unique: ${id} appears twice`)
    seen.add(id)
    if (!label) throw new ValidationError(`activity ${id}: a label is required`)
    if (!(WORKOUT_ICONS as readonly string[]).includes(String(k.icon))) {
      throw new ValidationError(`activity ${id}: icon must be one of ${WORKOUT_ICONS.join(', ')}`)
    }
    return { id, label, icon: k.icon as WorkoutKindDef['icon'], training: k.training === true }
  })
}

/** Apple Health's names for the types, and Cairn's own, to the metric they are. */
const BODY_ALIASES: Record<string, BodyMetric> = {
  weight: 'weight', 'body mass': 'weight', bodymass: 'weight',
  bodyfat: 'bodyFat', 'body fat': 'bodyFat', 'body fat percentage': 'bodyFat', 'body fat %': 'bodyFat',
  leanmass: 'leanMass', 'lean mass': 'leanMass', 'lean body mass': 'leanMass',
  bmi: 'bmi', 'body mass index': 'bmi',
}
const LB_PER_KG = 2.20462262

/** One reading from the phone, checked and put in Cairn's units (kg, percent). */
export function cleanBodySample(raw: unknown, i: number): { metric: BodyMetric; value: number; measuredAt: number } {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const label = `sample ${i + 1}`
  const metric = BODY_ALIASES[String(s.type ?? s.metric ?? '').trim().toLowerCase()]
  if (!metric) throw new ValidationError(`${label}: type must be one of Weight, Body Fat Percentage, Lean Body Mass, Body Mass Index`)
  // Shortcuts may send numbers as text, sometimes with a unit or thousands separator attached.
  let value = typeof s.value === 'number' ? s.value : Number.parseFloat(String(s.value ?? '').replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) throw new ValidationError(`${label}: value must be a positive number`)
  const unit = String(s.unit ?? '').trim().toLowerCase()
  if (metric === 'weight' || metric === 'leanMass') {
    if (/^(lb|lbs|pound|pounds)$/.test(unit)) value /= LB_PER_KG
    else if (unit && !/^(kg|kgs|kilogram|kilograms)$/.test(unit)) throw new ValidationError(`${label}: unit must be lb or kg`)
    if (value > 500) throw new ValidationError(`${label}: ${Math.round(value)} kg is not a plausible body weight`)
  }
  if (metric === 'bodyFat') {
    if (value <= 1) value *= 100 // Apple Health keeps a fraction; a percent is also fine
    if (value > 80) throw new ValidationError(`${label}: body fat must be a percent`)
  }
  const when = typeof s.date === 'number' ? s.date : Date.parse(String(s.date ?? ''))
  if (!Number.isFinite(when)) throw new ValidationError(`${label}: date must be ISO 8601, like 2026-10-04T07:12:00-07:00`)
  return { metric, value: Math.round(value * 100) / 100, measuredAt: when }
}

export const cleanNote = (input: unknown): string | undefined =>
  (typeof input === 'string' && input.trim() ? input.trim().slice(0, MAX_NAME) : undefined)
