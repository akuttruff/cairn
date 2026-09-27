import { UNITS, addDays, localDate } from './nutrition.ts'
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
