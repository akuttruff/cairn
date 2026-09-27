import { UNITS, addDays, impliedCalories, localDate } from './nutrition.ts'
import type { Meal, NutrientKey } from '../types.ts'

/** Whole numbers for calories, one decimal for grams (dropping a trailing .0). */
export function fmt(key: NutrientKey, v: number | null | undefined): string {
  if (v == null) return '—'
  if (key === 'calories') return String(Math.round(v))
  return String(Math.round(v * 10) / 10)
}

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
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks',
}

/** Nutrient amounts as typed. Blank means unknown, not zero. */
export type NutrientDraft = Record<NutrientKey, string>

export const emptyDraft = (): NutrientDraft => ({ calories: '', protein: '', fat: '', carbs: '', fiber: '' })

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
