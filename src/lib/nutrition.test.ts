import { describe, it, expect } from 'vitest'
import {
  addDays, addMonths, blendGoals, calorieMismatch, daysBetween, emptyNutrients, endOfMonth, goalMet, impliedCalories,
  isDateString, localDate, macroCalories, progress, rangeStatus, resolveGoals, scale, scoreDays, scoreWater, startOfMonth,
  startOfWeek, sumDay, sumNutrients,
} from './nutrition.ts'
import type { DaySummary, Entry, Goals, NutrientKey, Nutrients, ResolvedGoals } from '../types.ts'

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

describe('sumNutrients', () => {
  it('adds several nutrient sets together', () => {
    expect(sumNutrients([n({ calories: 100, protein: 5 }), n({ calories: 50, protein: 2 })]))
      .toEqual(n({ calories: 150, protein: 7 }))
  })

  it('is null for a key only when every item left it unknown', () => {
    expect(sumNutrients([n({ calories: 100, fiber: null }), n({ calories: 50, fiber: 2 })]).fiber).toBe(2)
    expect(sumNutrients([n({ calories: 100 }), n({ calories: 50 })]).fiber).toBeNull()
  })

  it('is all-null for an empty list', () => {
    expect(sumNutrients([])).toEqual(emptyNutrients())
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

describe('impliedCalories', () => {
  it('derives energy at 4/4/9, same as macroCalories, once all three are given', () => {
    expect(impliedCalories(10, 5, 20)).toBe(165)
  })

  it('treats a missing macro as zero rather than refusing to answer', () => {
    expect(impliedCalories(10, null, null)).toBe(40) // protein alone
    expect(impliedCalories(null, 5, null)).toBe(45) // fat alone
    expect(impliedCalories(null, null, 20)).toBe(80) // carbs alone
    expect(impliedCalories(10, 5, null)).toBe(85) // protein + fat, no carbs yet
  })

  it('is null only when nothing has been typed at all', () => {
    expect(impliedCalories(null, null, null)).toBeNull()
  })

  it('treats an explicit zero as typed, not as missing', () => {
    expect(impliedCalories(0, 0, 20)).toBe(80)
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

describe('rangeStatus', () => {
  it('says under, in or over', () => {
    expect(rangeStatus(100, { min: 110, max: 120 })).toBe('under')
    expect(rangeStatus(115, { min: 110, max: 120 })).toBe('in')
    expect(rangeStatus(110, { min: 110, max: 120 })).toBe('in') // the boundary counts as in range
    expect(rangeStatus(120, { min: 110, max: 120 })).toBe('in')
    expect(rangeStatus(125, { min: 110, max: 120 })).toBe('over')
  })
})

const GOALS: Goals = {
  training: { protein: { min: 125, max: 130 }, carbs: { min: 110, max: 120 }, fat: { min: 50, max: 55 } },
  rest: { protein: { min: 115, max: 120 }, carbs: { min: 80, max: 90 }, fat: { min: 50, max: 55 } },
  fiber: 30, water: 96, alcoholWeekly: 7,
}

describe('resolveGoals', () => {
  it("computes calories from the macro range's own ends -- never a separately stated number", () => {
    const resolved = resolveGoals(GOALS, 'training')
    // 125*4 + 110*4 + 50*9 = 500 + 440 + 450 = 1390; 130*4 + 120*4 + 55*9 = 520 + 480 + 495 = 1495.
    expect(resolved.calories).toEqual({ min: 1390, max: 1495 })
    expect(resolved.protein).toEqual({ min: 125, max: 130 })
  })

  it('resolves the other day type from its own macros, and carries the day-type-independent goals through unchanged', () => {
    const resolved = resolveGoals(GOALS, 'rest')
    // 115*4 + 80*4 + 50*9 = 460 + 320 + 450 = 1230; 120*4 + 90*4 + 55*9 = 480 + 360 + 495 = 1335.
    expect(resolved.calories).toEqual({ min: 1230, max: 1335 })
    expect(resolved.fiber).toBe(30)
    expect(resolved.water).toBe(96)
    expect(resolved.alcoholWeekly).toBe(7)
  })
})

describe('goalMet', () => {
  it('treats calories, fat and carbs as caps: at or under the top is a hit, over is a miss', () => {
    const r = { min: 1899, max: 1899 }
    expect(goalMet(1899, r, 'calories')).toBe(true) // exactly on the line counts
    expect(goalMet(1200, r, 'calories')).toBe(true) // well under is still a hit
    expect(goalMet(1900, r, 'calories')).toBe(false)
    expect(goalMet(55, { min: 50, max: 55 }, 'fat')).toBe(true)
    expect(goalMet(55.1, { min: 50, max: 55 }, 'fat')).toBe(false)
    expect(goalMet(0, { min: 110, max: 120 }, 'carbs')).toBe(true)
  })

  it('treats protein and fiber as floors: at or over the bottom is a hit, under is a miss', () => {
    expect(goalMet(130, { min: 130, max: 130 }, 'protein')).toBe(true)
    expect(goalMet(200, { min: 130, max: 130 }, 'protein')).toBe(true)
    expect(goalMet(129.9, { min: 130, max: 130 }, 'protein')).toBe(false)
    expect(goalMet(125, { min: 125, max: 130 }, 'protein')).toBe(true) // the bottom of a real range is enough
    expect(goalMet(60, { min: 30, max: 30 }, 'fiber')).toBe(true)
    expect(goalMet(29, { min: 30, max: 30 }, 'fiber')).toBe(false)
  })
})

describe('scoreDays', () => {
  const training = resolveGoals(GOALS, 'training')
  const rest = resolveGoals(GOALS, 'rest')
  const summary = (dayType: 'training' | 'rest', totals: Partial<Record<NutrientKey, number>>, entryCount = 1): DaySummary => ({
    date: '2026-09-22', entryCount, dayType, goals: dayType === 'training' ? training : rest, water: 0, alcohol: 0,
    totals: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, ...totals },
    missing: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
  })

  it("judges each day against its own day type's goal, never a blend", () => {
    // 1450 kcal: under the training cap (1495), over the rest one (1335).
    const days = [summary('training', { calories: 1450 }), summary('rest', { calories: 1450 })]
    expect(scoreDays(days).calories).toEqual({ met: 1, of: 2 })
  })

  it('leaves unlogged days out of both counts', () => {
    const days = [summary('rest', { protein: 118 }), summary('rest', {}, 0)]
    expect(scoreDays(days).protein).toEqual({ met: 1, of: 1 })
    expect(scoreDays([]).fiber).toEqual({ met: 0, of: 0 })
  })
})

describe('scoreWater', () => {
  it('counts days that reached the goal, of the days any water was logged on', () => {
    const days = [{ water: 96 }, { water: 128 }, { water: 92 }, { water: 0 }]
    // 96 and 128 reach the goal; 92 falls short; the 0 day is left out, not a miss.
    expect(scoreWater(days, 96)).toEqual({ met: 2, of: 3 })
    expect(scoreWater(days, 0)).toEqual({ met: 0, of: 3 }) // no goal set: nothing can be met
  })
})

describe('blendGoals', () => {
  const training = resolveGoals(GOALS, 'training')
  const rest = resolveGoals(GOALS, 'rest')

  it('averages each range across the days given, field by field, to one decimal', () => {
    const blended = blendGoals([training, training, rest]) // 2 training days, 1 rest
    expect(blended.protein.min).toBeCloseTo((125 + 125 + 115) / 3, 1)
    expect(blended.protein.max).toBeCloseTo((130 + 130 + 120) / 3, 1)
    expect(blended.calories.min).toBeCloseTo((1390 + 1390 + 1230) / 3, 1)
  })

  it('carries fiber, water and alcohol through unchanged -- one day is enough to know them', () => {
    const blended = blendGoals([training, rest])
    expect(blended.fiber).toBe(30)
    expect(blended.water).toBe(96)
  })

  it('a single day blends to exactly that day\'s own goals', () => {
    expect(blendGoals([training])).toEqual(training)
  })

  it('refuses an empty list rather than returning something meaningless', () => {
    expect(() => blendGoals([] as ResolvedGoals[])).toThrow()
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

  it('finds the Monday starting the week of any day in it', () => {
    expect(startOfWeek('2026-09-26')).toBe('2026-09-21') // a Saturday
    expect(startOfWeek('2026-09-21')).toBe('2026-09-21') // already a Monday
    expect(startOfWeek('2026-09-20')).toBe('2026-09-14') // a Sunday -- the *previous* Monday
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28') // crosses a month
  })

  it('finds the first and last day of the month', () => {
    expect(startOfMonth('2026-09-26')).toBe('2026-09-01')
    expect(endOfMonth('2026-09-26')).toBe('2026-09-30')
    expect(endOfMonth('2028-02-14')).toBe('2028-02-29') // leap year
  })

  it('steps by whole months, clamping the day instead of overflowing', () => {
    expect(addMonths('2026-09-15', 1)).toBe('2026-10-15')
    expect(addMonths('2026-09-15', -1)).toBe('2026-08-15')
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28') // Feb has no 31st
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29') // leap year
  })

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-09-20', '2026-09-27')).toBe(7)
    expect(daysBetween('2026-09-27', '2026-09-20')).toBe(-7)
    expect(daysBetween('2026-09-26', '2026-09-26')).toBe(0)
    // Across the DST fall-back, where a naive Date subtraction would be off by an hour.
    expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7)
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
