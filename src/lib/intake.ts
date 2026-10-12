import { unitsFor } from './units.ts'
import type { Unit } from './units.ts'
import type { Food } from '../types.ts'

/** How much of something was described: "2", "a cup of", "150 g". */
export interface DescribedAmount {
  quantity: number
  unit: string | null
  grams: number | null
}

/** The short forms labels use for the units people say in full. */
const ALIASES: Record<string, string> = {
  tablespoon: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', teaspoon: 'tsp', tsps: 'tsp', ounce: 'oz', ounces: 'oz',
  gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', lbs: 'lb', milliliter: 'ml', millilitre: 'ml',
}
/** "cups" and "cup", "slices" and "slice", "tablespoons" and "tbsp" are the same unit. */
const stem = (w: string): string => {
  const singular = ALIASES[w] ?? (
    w.endsWith('ies') ? w.slice(0, -3) + 'y'
      : w.endsWith('ses') || w.endsWith('xes') || w.endsWith('ches') ? w.slice(0, -2)
        : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
  return ALIASES[singular] ?? singular
}
/** The unit words in a label or a phrase, stemmed, without the counts. */
const words = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^\d+$/.test(w)).map(stem)

/**
 * The unit and quantity to start a described food at, from the amount as it
 * was said and the units the food can be logged in: a stated weight wins;
 * then a serving whose label names the unit ("cup" in "1 cup, sliced"); then,
 * with no unit, the food's own serving ("2 eggs" of a food served "1 large");
 * failing all that, a weight guess of 100 g a piece, to be corrected by eye.
 */
export function suggestAmount(food: Food, said: DescribedAmount): { unitKey: string; qty: string } {
  const units = unitsFor(food)
  const first = units[0]
  if (!first) return { unitKey: 'g', qty: '100' }
  const qty = (n: number): string => String(Math.round(n * 100) / 100)
  const byWeight = units.find((u) => u.key === 'g')
  if (said.grams != null && byWeight) return { unitKey: 'g', qty: qty(said.grams) }

  const servings = units.filter((u) => u.key !== 'g' && u.key !== 'oz')
  if (said.unit) {
    const want = words(said.unit)
    if (want.includes('g') || want.includes('gram')) return byWeight ? { unitKey: 'g', qty: qty(said.quantity) } : { unitKey: first.key, qty: qty(said.quantity) }
    if (want.includes('oz') || want.includes('ounce')) {
      const oz = units.find((u) => u.key === 'oz')
      if (oz) return { unitKey: 'oz', qty: qty(said.quantity) }
    }
    const named = servings.find((u) => words(u.label).some((w) => want.includes(w)))
    if (named) return { unitKey: named.key, qty: qty(said.quantity) }
  }
  if (servings.length) return { unitKey: servings[0]!.key, qty: qty(said.quantity) }
  // Only weights: a piece is a guess of 100 g, which the row makes easy to fix.
  return { unitKey: byWeight ? 'g' : first.key, qty: qty(said.quantity * 100) }
}

/** The unit a key names, or the food's first. */
export function unitByKey(food: Food, key: string): Unit | undefined {
  const units = unitsFor(food)
  return units.find((u) => u.key === key) ?? units[0]
}
