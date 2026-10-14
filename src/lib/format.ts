import { UNITS, addDays, impliedCalories, localDate } from './nutrition.ts'
import { NUTRIENTS } from '../types.ts'
import type { Meal, NutrientKey, Nutrients } from '../types.ts'

/** Whole numbers throughout: calories to the nearest, macros always rounded
 *  up (so 12.1 g reads as 13 g). The tiny allowance keeps float noise in a
 *  sum, like 12.000000001, from tipping a whole number up by one. */
export function fmt(key: NutrientKey, v: number | null | undefined): string {
  if (v == null) return '—'
  if (key === 'calories') return String(Math.round(v))
  return String(Math.ceil(v - 1e-9))
}

/** A weight in grams, to one decimal (dropping a trailing .0). */
export const fmtGrams = (v: number): string => String(Math.round(v * 10) / 10)

export const withUnit = (key: NutrientKey, v: number | null | undefined): string =>
  v == null ? '—' : `${fmt(key, v)}${key === 'calories' ? ' kcal' : ` ${UNITS[key]}`}`

/** Parse a user-typed number; blank or junk is null, never NaN. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks/Supplements',
}

/** Nutrient amounts as typed. Blank means unknown, not zero. */
export type NutrientDraft = Record<NutrientKey, string>

export const emptyDraft = (): NutrientDraft => ({ calories: '', protein: '', fat: '', carbs: '', fiber: '' })

/** Existing numbers, as they'd be typed: unknown ones blank. */
export function draftOf(n: Nutrients): NutrientDraft {
  const d = emptyDraft()
  for (const k of NUTRIENTS) d[k] = n[k] == null ? '' : String(n[k])
  return d
}

/** The draft's numbers, unknown where blank or unreadable. */
export function nutrientsOf(draft: NutrientDraft): Nutrients {
  const out = {} as Nutrients
  for (const k of NUTRIENTS) out[k] = parseNum(draft[k])
  return out
}

/** Something was typed that isn't a number -- which nutrientsOf would silently turn into "unknown". */
export const draftHasJunk = (draft: NutrientDraft): boolean =>
  NUTRIENTS.some((k) => draft[k].trim() !== '' && parseNum(draft[k]) == null)

/**
 * Applies an edit to a nutrient draft, keeping Calories tracking
 * protein/fat/carbs (4/4/9 kcal/g) live as you type them -- like a
 * nutrition label's own math -- until you type a Calories value of your
 * own, which is kept exactly as typed (a real label can differ: fiber and
 * sugar alcohols carry fewer calories, and this app's own tolerance already
 * expects that -- see calorieMismatch).
 *
 * A direct edit to Calories -- including clearing it -- is always taken
 * verbatim and never overwritten in that same edit: recomputing a cleared
 * field back to its implied value at once would fight anyone who clears it
 * meaning to type a different number next, turning "650" into "665650".
 * Clearing it does hand control back to the macros, so the *next* edit to
 * protein, fat or carbs recomputes it live, same as starting blank.
 */
export function withAutoCalories(
  prev: NutrientDraft,
  next: NutrientDraft,
  caloriesIsAuto: boolean,
): { draft: NutrientDraft; caloriesIsAuto: boolean } {
  const caloriesEdited = next.calories !== prev.calories
  if (caloriesEdited) return { draft: next, caloriesIsAuto: next.calories.trim() === '' }
  if (!caloriesIsAuto) return { draft: next, caloriesIsAuto: false }
  const implied = impliedCalories(parseNum(next.protein), parseNum(next.fat), parseNum(next.carbs))
  return { draft: { ...next, calories: implied == null ? '' : String(Math.round(implied)) }, caloriesIsAuto: true }
}

/** "Today", "Yesterday", or a short weekday + date. */
export function dayLabel(date: string, today = localDate()): string {
  if (date === today) return 'Today'
  if (date === addDays(today, -1)) return 'Yesterday'
  if (date === addDays(today, 1)) return 'Tomorrow'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

const parseLocal = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

/** "Sep 20 – Sep 26, 2026". The year always shows, so a week spanning a
 *  year boundary (or just far from today) is never ambiguous. */
export function weekLabel(start: string, end: string): string {
  const from = parseLocal(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const to = parseLocal(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${from} – ${to}`
}

/** "September 2026". `date` is any day within the month. */
export function monthLabel(date: string): string {
  return parseLocal(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** "1 mile", "1.5 miles". */
export const milesLabel = (miles: number): string => `${Number(miles.toFixed(1))} ${miles === 1 ? 'mile' : 'miles'}`
