import { describe, it, expect } from 'vitest'
import { OUNCE_GRAMS, describeAmount, gramsFor, headline, multiply, nutrientsFor, unitsFor } from './units.ts'
import type { Food, Nutrients } from '../types.ts'

const n = (calories: number, protein: number | null = null): Nutrients =>
  ({ calories, protein, fat: null, carbs: null, fiber: null })

const apple: Pick<Food, 'per100g' | 'servings'> = {
  per100g: n(52, 0.3),
  servings: [{ label: '1 medium', grams: 182 }, { label: '1 cup, sliced', grams: 110 }],
}

const bowl: Pick<Food, 'per100g' | 'perServing'> = {
  perServing: { label: '1 bowl', grams: null, nutrients: n(660, 50) },
}

describe('unitsFor', () => {
  it('offers household servings first, then g and oz', () => {
    expect(unitsFor(apple).map((u) => u.label)).toEqual(['1 medium', '1 cup, sliced', 'g', 'oz'])
  })

  it('offers a weightless serving on its own, with its nutrition', () => {
    const units = unitsFor(bowl)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ label: '1 bowl', grams: null, nutrients: n(660, 50) })
  })

  it('treats a weighed serving of a per-100g food as an ordinary measure', () => {
    const units = unitsFor({ per100g: n(200), perServing: { label: '1 cup', grams: 163, nutrients: n(326) } })
    expect(units[0]).toEqual({ key: 'serving', label: '1 cup', grams: 163 })
    expect(units.map((u) => u.label)).toEqual(['1 cup', 'g', 'oz'])
  })

  it('lists a label once even if the source repeats it', () => {
    const units = unitsFor({ per100g: n(100), servings: [{ label: '1 cup', grams: 240 }, { label: '1 Cup', grams: 240 }] })
    expect(units.filter((u) => u.label.toLowerCase() === '1 cup')).toHaveLength(1)
  })
})

describe('nutrientsFor', () => {
  it('scales per-100g values by the unit weight', () => {
    const [medium] = unitsFor(apple)
    expect(nutrientsFor(apple, medium!, 2)).toEqual({ ...n(189.3, 1.1) })
  })

  it('multiplies a weightless serving, keeping unknowns unknown', () => {
    const [unit] = unitsFor(bowl)
    expect(nutrientsFor(bowl, unit!, 1.5)).toEqual(n(990, 75))
  })

  it('handles ounces', () => {
    const oz = unitsFor(apple).find((u) => u.label === 'oz')!
    expect(nutrientsFor(apple, oz, 1)!.calories).toBeCloseTo(52 * OUNCE_GRAMS / 100, 1)
  })

  it('refuses a zero or negative quantity', () => {
    expect(nutrientsFor(apple, unitsFor(apple)[0]!, 0)).toBeNull()
  })
})

describe('gramsFor', () => {
  it('knows the weight only when the unit does', () => {
    expect(gramsFor(unitsFor(apple)[0]!, 2)).toBe(364)
    expect(gramsFor(unitsFor(bowl)[0]!, 2)).toBeNull()
  })
})

describe('describeAmount', () => {
  it('reads naturally', () => {
    expect(describeAmount({ quantity: 2, unit: '1 slice' })).toBe('2 slice')
    expect(describeAmount({ quantity: 1.5, unit: '1 cup, sliced' })).toBe('1.5 cup, sliced')
    expect(describeAmount({ quantity: 150, unit: 'g' })).toBe('150 g')
    expect(describeAmount({ quantity: 1, unit: '1 bowl' })).toBe('1 bowl')
    expect(describeAmount({ quantity: 1, unit: '2 cookies (30 g)' })).toBe('2 cookies (30 g)')
    expect(describeAmount({ quantity: 3, unit: '2 cookies (30 g)' })).toBe('3 × 2 cookies (30 g)')
  })
})

describe('multiply', () => {
  it('rounds to one decimal', () => {
    expect(multiply(n(10.33, 1), 3).calories).toBe(31)
  })
})

describe('headline', () => {
  it('shows a serving food per serving, and a weighed food per 100g', () => {
    expect(headline(bowl)).toEqual({ label: '1 bowl', nutrients: n(660, 50) })
    expect(headline(apple)!.label).toBe('100g')
  })
})
