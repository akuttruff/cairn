import { describe, it, expect } from 'vitest'
import {
  addDays, calorieMismatch, emptyNutrients, isDateString, localDate,
  macroCalories, progress, scale, sumDay,
} from './nutrition.ts'
import type { Entry, Nutrients } from '../types.ts'

const n = (v: Partial<Nutrients>): Nutrients => ({ ...emptyNutrients(), ...v })

const entry = (nutrients: Partial<Nutrients>): Entry => ({
  id: String(Math.random()), date: '2026-09-26', meal: 'lunch', name: 'x',
  grams: 100, nutrients: n(nutrients), source: 'custom', createdAt: 0,
})

// USDA "Bananas, raw", per 100 g.
const BANANA = n({ calories: 89, protein: 1.09, fat: 0.33, carbs: 22.8, fiber: 2.6 })

describe('scale', () => {
  it('scales per-100g values to a portion', () => {
    const medium = scale(BANANA, 118) // a medium banana
    expect(medium.calories).toBe(105)
    expect(medium.carbs).toBe(26.9)
    expect(medium.fiber).toBe(3.1)
  })

  it('keeps unknown values unknown rather than zero', () => {
    const noFiber = scale(n({ calories: 52.9, protein: 9.41 }), 170)
    expect(noFiber.fiber).toBeNull()
    expect(noFiber.protein).toBe(16)
  })

  it('handles a zero-gram portion', () => {
    expect(scale(BANANA, 0).calories).toBe(0)
  })
})

describe('sumDay', () => {
  it('adds up the day', () => {
    const { totals } = sumDay([
      entry({ calories: 105, protein: 1.3, fat: 0.4, carbs: 27, fiber: 3.1 }),
      entry({ calories: 200, protein: 30, fat: 5, carbs: 0, fiber: 0 }),
    ])
    expect(totals).toEqual({ calories: 305, protein: 31.3, fat: 5.4, carbs: 27, fiber: 3.1 })
  })

  it('counts entries missing a nutrient instead of treating them as zero', () => {
    // The point: a yogurt with no fiber data must make the fiber total say
    // "partial", not quietly report too little.
    const { totals, missing } = sumDay([
      entry({ calories: 90, fiber: 5 }),
      entry({ calories: 90 }),
    ])
    expect(totals.fiber).toBe(5)
    expect(missing.fiber).toBe(1)
    expect(missing.calories).toBe(0)
  })

  it('avoids float drift in the total', () => {
    const { totals } = sumDay([entry({ protein: 0.1 }), entry({ protein: 0.2 })])
    expect(totals.protein).toBe(0.3)
  })

  it('is all zeros for an empty day', () => {
    expect(sumDay([]).totals.calories).toBe(0)
  })
})

describe('macroCalories and calorieMismatch', () => {
  it('derives energy at 4/4/9', () => {
    expect(macroCalories(n({ protein: 10, carbs: 20, fat: 5 }))).toBe(165)
  })

  it('is unknown when any macro is unknown', () => {
    expect(macroCalories(n({ protein: 10, carbs: 20 }))).toBeNull()
  })

  it('accepts real food, which never matches 4/4/9 exactly', () => {
    expect(calorieMismatch(BANANA)).toBe(false)
  })

  it('catches a slipped digit in manual entry', () => {
    expect(calorieMismatch(n({ calories: 2500, protein: 20, carbs: 30, fat: 8 }))).toBe(true)
    expect(calorieMismatch(n({ calories: 25, protein: 20, carbs: 30, fat: 8 }))).toBe(true)
  })

  it('does not judge portions too small to be meaningful', () => {
    expect(calorieMismatch(n({ calories: 5, protein: 1, carbs: 2, fat: 0 }))).toBe(false)
  })

  it('has no opinion without enough data', () => {
    expect(calorieMismatch(n({ calories: 300 }))).toBe(false)
  })
})

describe('progress', () => {
  it('is a fraction of the goal, clamped', () => {
    expect(progress(50, 200)).toBe(0.25)
    expect(progress(300, 200)).toBe(1)
    expect(progress(-5, 200)).toBe(0)
  })

  it('does not divide by a zero goal', () => {
    expect(progress(10, 0)).toBe(0)
  })
})

describe('dates', () => {
  it('formats the local calendar date', () => {
    expect(localDate(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05')
  })

  it('steps across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('validates date strings, including impossible dates', () => {
    expect(isDateString('2026-09-26')).toBe(true)
    expect(isDateString('2026-02-30')).toBe(false)
    expect(isDateString('26-9-26')).toBe(false)
    expect(isDateString('../../etc')).toBe(false)
  })
})

describe('mealForHour', () => {
  it('guesses the meal from the time of day', async () => {
    const { mealForHour } = await import('./nutrition.ts')
    expect(mealForHour(7)).toBe('breakfast')
    expect(mealForHour(12)).toBe('lunch')
    expect(mealForHour(16)).toBe('snack')
    expect(mealForHour(19)).toBe('dinner')
    expect(mealForHour(23)).toBe('snack')
    expect(mealForHour(2)).toBe('snack')
  })
})
