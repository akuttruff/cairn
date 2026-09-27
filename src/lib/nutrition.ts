import { NUTRIENTS } from '../types.ts'
import type { DayTotals, Entry, Meal, NutrientKey, Nutrients } from '../types.ts'

export const DEFAULT_GOALS = {
  calories: 2000,
  protein: 150,
  fat: 65,
  carbs: 200,
  fiber: 30,
} as const

export const UNITS: Record<NutrientKey, string> = {
  calories: 'kcal',
  protein: 'g',
  fat: 'g',
  carbs: 'g',
  fiber: 'g',
}

export const LABELS: Record<NutrientKey, string> = {
  calories: 'Calories',
  protein: 'Protein',
  fat: 'Fat',
  carbs: 'Carbs',
  fiber: 'Fiber',
}

export const emptyNutrients = (): Nutrients =>
  ({ calories: null, protein: null, fat: null, carbs: null, fiber: null })

/** One decimal place: finer than any label or scale is accurate to. */
const round1 = (n: number): number => Math.round(n * 10) / 10

/** Amounts in `grams` of a food, from its per-100g values. Unknown stays unknown. */
export function scale(per100g: Nutrients, grams: number): Nutrients {
  const out = emptyNutrients()
  for (const key of NUTRIENTS) {
    const v = per100g[key]
    out[key] = v == null ? null : round1((v * grams) / 100)
  }
  return out
}

/**
 * Adds several nutrient sets together -- a meal preset's combined total, say.
 * A key is null only when every one of them left it unknown; otherwise the
 * ones that stated it are summed, same as a day's own totals do.
 */
export function sumNutrients(list: Nutrients[]): Nutrients {
  const out = emptyNutrients()
  for (const key of NUTRIENTS) {
    const known = list.map((n) => n[key]).filter((v): v is number => v != null)
    out[key] = known.length ? round1(known.reduce((a, b) => a + b, 0)) : null
  }
  return out
}

/** Sum a day's entries, counting which ones were missing each nutrient. */
export function sumDay(entries: Entry[]): DayTotals {
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
  const missing = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
  for (const entry of entries) {
    for (const key of NUTRIENTS) {
      const v = entry.nutrients[key]
      if (v == null) missing[key] += 1
      else totals[key] += v
    }
  }
  for (const key of NUTRIENTS) totals[key] = round1(totals[key])
  return { totals, missing }
}

/**
 * Energy implied by the macros: 4 kcal/g protein, 4 kcal/g carbohydrate,
 * 9 kcal/g fat. Null if any of the three is unknown.
 */
export function macroCalories(n: Nutrients): number | null {
  if (n.protein == null || n.carbs == null || n.fat == null) return null
  return round1(n.protein * 4 + n.carbs * 4 + n.fat * 9)
}

/**
 * Calories implied by whatever of protein/fat/carbs is typed so far, a blank
 * one counted as 0 -- so the total updates as each macro is typed, rather
 * than waiting until all three are filled (contrast macroCalories, which
 * answers "do the stated macros match the stated calories?" and so needs
 * all three before it will say anything). Null only when none are typed.
 */
export function impliedCalories(protein: number | null, fat: number | null, carbs: number | null): number | null {
  if (protein == null && fat == null && carbs == null) return null
  return round1((protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9)
}

/**
 * Whether the stated calories disagree with the macros by more than a
 * tolerance. Catches a typo in manual entry -- 2500 for 250 -- which would
 * otherwise wreck the day's total without anyone noticing.
 *
 * The tolerance is generous because labels legitimately differ: fiber and
 * sugar alcohols carry fewer calories than other carbohydrate, and rounding
 * on small portions is coarse.
 */
export function calorieMismatch(n: Nutrients, tolerance = 0.25): boolean {
  const derived = macroCalories(n)
  if (derived == null || n.calories == null) return false
  if (derived < 20 && n.calories < 20) return false // too small to judge
  const larger = Math.max(derived, n.calories)
  return Math.abs(derived - n.calories) / larger > tolerance
}

/** Fraction of a goal reached, clamped to [0, 1] for drawing. */
export function progress(total: number, goal: number): number {
  if (!(goal > 0)) return 0
  return Math.min(1, Math.max(0, total / goal))
}

/** Local calendar date for a moment, YYYY-MM-DD, in the device's timezone. */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a YYYY-MM-DD date by whole days, staying in local calendar terms. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y!, m! - 1, d! + days))
}

export const isDateString = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s

/** The meal you are most likely logging at a given hour. */
export function mealForHour(hour: number): Meal {
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}
