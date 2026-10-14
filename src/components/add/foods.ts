/** What the server says about saved foods and meals, made safe to render. */
import type { Food, MealPreset } from '../../types.ts'

/**
 * `api.foods()` shaped as declared -- guards against a response that came
 * back partial (a stripped test double, a server hiccup), which would
 * otherwise throw deep inside a render (spreading or mapping `undefined`)
 * rather than failing where it's easy to see why.
 */
export function normalizeFoods(f: { saved?: Food[]; recent?: Food[] } | null | undefined): { saved: Food[]; recent: Food[] } {
  return { saved: f?.saved ?? [], recent: f?.recent ?? [] }
}

/** Ids of every food used by at least one saved meal, for the "in a meal" badge. */
export function mealFoodIds(presets: MealPreset[]): Set<string> {
  const ids = new Set<string>()
  for (const p of presets) for (const item of p.items) if (item.foodId) ids.add(item.foodId)
  return ids
}

export const normalizeMeals = (p: MealPreset[] | null | undefined): MealPreset[] => (Array.isArray(p) ? p : [])
