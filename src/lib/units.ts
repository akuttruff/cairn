import { NUTRIENTS } from '../types.ts'
import type { Amount, Food, Nutrients } from '../types.ts'
import { emptyNutrients, scale } from './nutrition.ts'

/**
 * The units a food can be logged in, and what a quantity of one amounts to.
 *
 * You measure food in servings -- "2 slices", "1.5 cups", "1 bowl" -- not in
 * grams. A unit either has a known weight (and scales the food's per-100g
 * values) or, for a food a source only describes per serving, carries that
 * serving's nutrition directly.
 */
export interface Unit {
  /** Stable within one food, for a <select>. */
  key: string
  /** As a person says it: "1 cup, sliced", "1 bowl", "g". */
  label: string
  /** Weight of one unit, or null when it isn't known. */
  grams: number | null
  /** Nutrition of one unit when it can't be derived from a weight. */
  nutrients?: Nutrients
}

export const OUNCE_GRAMS = 28.3495

const round1 = (n: number): number => Math.round(n * 10) / 10

/** Every unit this food can be logged in, most natural first. */
export function unitsFor(food: Pick<Food, 'per100g' | 'servings' | 'perServing'>): Unit[] {
  const units: Unit[] = []
  const labels = new Set<string>()
  const add = (unit: Unit): void => {
    const k = unit.label.toLowerCase()
    if (labels.has(k)) return
    labels.add(k)
    units.push(unit)
  }

  const ps = food.perServing
  if (ps) {
    // With a weight and per-100g values the serving is an ordinary measure;
    // otherwise it carries its own nutrition.
    add(ps.grams != null && food.per100g
      ? { key: 'serving', label: ps.label, grams: ps.grams }
      : { key: 'serving', label: ps.label, grams: ps.grams, nutrients: ps.nutrients })
  }
  if (food.per100g) {
    for (const [i, s] of (food.servings ?? []).entries()) add({ key: `s${i}`, label: s.label, grams: s.grams })
    add({ key: 'g', label: 'g', grams: 1 })
    add({ key: 'oz', label: 'oz', grams: OUNCE_GRAMS })
  }
  return units
}

/** Nutrition for `quantity` of `unit`, or null if it can't be worked out. */
export function nutrientsFor(food: Pick<Food, 'per100g'>, unit: Unit, quantity: number): Nutrients | null {
  if (!(quantity > 0)) return null
  if (unit.grams != null && food.per100g && !unit.nutrients) return scale(food.per100g, unit.grams * quantity)
  if (unit.nutrients) return multiply(unit.nutrients, quantity)
  return null
}

/** Each known nutrient times `factor`, to one decimal; unknown stays unknown. */
export function multiply(n: Nutrients, factor: number): Nutrients {
  const out = emptyNutrients()
  for (const key of NUTRIENTS) {
    const v = n[key]
    out[key] = v == null ? null : round1(v * factor)
  }
  return out
}

/** Grams eaten, when the unit's weight is known. */
export function gramsFor(unit: Unit, quantity: number): number | null {
  return unit.grams == null ? null : round1(unit.grams * quantity)
}

const trimNumber = (n: number): string => String(Math.round(n * 100) / 100)

/**
 * How an amount reads: 2 x "1 slice" -> "2 slice", 1.5 x "1 cup, sliced" ->
 * "1.5 cup, sliced", 150 x "g" -> "150 g", 1 x "1 bowl" -> "1 bowl".
 * No pluralising: "2 slice" is clearer than a wrong guess at English.
 */
export function describeAmount(amount: Pick<Amount, 'quantity' | 'unit'>): string {
  const q = trimNumber(amount.quantity)
  const m = /^1\s+(.+)$/.exec(amount.unit.trim())
  if (m) return `${q} ${m[1]}`
  if (/^\d/.test(amount.unit)) return q === '1' ? amount.unit : `${q} × ${amount.unit}`
  return `${q} ${amount.unit}`
}

/** A food's calories for one of its natural units, for list rows. */
export function headline(food: Pick<Food, 'per100g' | 'servings' | 'perServing'>): { label: string; nutrients: Nutrients } | null {
  if (food.perServing) {
    const unit = unitsFor(food)[0]!
    const n = nutrientsFor(food, unit, 1)
    if (n) return { label: food.perServing.label, nutrients: n }
  }
  if (food.per100g) return { label: '100g', nutrients: food.per100g }
  return null
}
