import { describe, it, expect } from 'vitest'
import { suggestAmount } from './intake.ts'
import type { Food } from '../types.ts'

const egg: Food = { id: 'web:egg', name: 'Egg, large', source: 'web', per100g: { calories: 143, protein: 12.6, fat: 9.5, carbs: 0.7, fiber: 0 }, servings: [{ label: '1 large', grams: 50 }] }
const rice: Food = { id: 'usda:rice', name: 'Rice, white, cooked', source: 'usda', per100g: { calories: 130, protein: 2.7, fat: 0.3, carbs: 28, fiber: 0.4 }, servings: [{ label: '1 cup', grams: 158 }, { label: '1 tbsp', grams: 10 }] }
const bowl: Food = { id: 'web:bowl', name: 'Chicken Burrito Bowl', source: 'web', perServing: { label: '1 bowl', grams: null, nutrients: { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null } } }
const plain: Food = { id: 'usda:chicken', name: 'Chicken breast', source: 'usda', per100g: { calories: 165, protein: 31, fat: 3.6, carbs: 0, fiber: 0 } }

describe('suggestAmount', () => {
  it('uses a stated weight', () => {
    expect(suggestAmount(plain, { quantity: 150, unit: 'g', grams: 150 })).toEqual({ unitKey: 'g', qty: '150' })
    expect(suggestAmount(rice, { quantity: 1, unit: 'cup', grams: 200 })).toEqual({ unitKey: 'g', qty: '200' })
  })

  it('matches the unit said to one of the food\u2019s servings, plurals and all', () => {
    expect(suggestAmount(rice, { quantity: 2, unit: 'cups', grams: null })).toEqual({ unitKey: 's0', qty: '2' })
    expect(suggestAmount(rice, { quantity: 3, unit: 'tablespoons', grams: null })).toEqual({ unitKey: 's1', qty: '3' })
  })

  it('counts pieces in the food\u2019s own serving when no unit was said', () => {
    expect(suggestAmount(egg, { quantity: 2, unit: null, grams: null })).toEqual({ unitKey: 's0', qty: '2' })
    expect(suggestAmount(bowl, { quantity: 1, unit: null, grams: null })).toEqual({ unitKey: 'serving', qty: '1' })
    expect(suggestAmount(bowl, { quantity: 0.5, unit: 'bowl', grams: null })).toEqual({ unitKey: 'serving', qty: '0.5' })
  })

  it('takes ounces and grams by name', () => {
    expect(suggestAmount(plain, { quantity: 4, unit: 'oz', grams: null })).toEqual({ unitKey: 'oz', qty: '4' })
    expect(suggestAmount(plain, { quantity: 80, unit: 'grams', grams: null })).toEqual({ unitKey: 'g', qty: '80' })
  })

  it('guesses 100 g a piece for a food known only by weight, for you to correct', () => {
    expect(suggestAmount(plain, { quantity: 2, unit: null, grams: null })).toEqual({ unitKey: 'g', qty: '200' })
    expect(suggestAmount(plain, { quantity: 1, unit: 'handful', grams: null })).toEqual({ unitKey: 'g', qty: '100' })
  })
})
