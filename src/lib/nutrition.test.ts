import { describe, it, expect } from 'vitest'
import {
  addDays, addMonths, alcoholCalories, alcoholCaloriesLogged, dogWalksMet, scoreDogWalks, blendGoals, calorieMismatch, daysBetween, emptyNutrients, endOfMonth, goalDirection, goalLabel,
  goalMet, goalStatus,
  impliedCalories,
  isDateString, localDate, macroCalories, meditationMet, progress, rangeStatus, resolveGoals, scale, scoreDays, scoreMeditation,
  scoreWater, startOfMonth, startOfWeek, streakThrough, sumDay, sumNutrients,
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
  protein: 130, fat: 60, carbs: 160, trainingCarbs: 35, trainingWater: 32, calorieBuffer: 0, fiber: 30, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1,
  workoutPlan: { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 },
}

describe('resolveGoals', () => {
  it('computes calories from the macros themselves -- never a separately stated number', () => {
    const resolved = resolveGoals(GOALS, 'rest')
    // 130*4 + 160*4 + 60*9 = 520 + 640 + 540 = 1700.
    expect(resolved.calories).toEqual({ min: 1700, max: 1700 })
    expect(resolved.carbs).toEqual({ min: 160, max: 160 })
    expect(resolved.fiber).toBe(30)
    expect(resolved.water).toBe(96)
    expect(resolved.alcoholWeekly).toBe(7)
    expect(resolved.meditationMinutes).toBe(10)
  })

  it('adds the training-day carbs on top of the base, and the calories they bring', () => {
    const resolved = resolveGoals(GOALS, 'training')
    expect(resolved.carbs).toEqual({ min: 195, max: 195 })
    expect(resolved.calories).toEqual({ min: 1840, max: 1840 }) // 1700 + 35*4
    expect(resolved.protein).toEqual({ min: 130, max: 130 }) // unchanged
  })

  it('adds a bottle of water on a training day, and none on a rest day', () => {
    expect(resolveGoals(GOALS, 'rest').water).toBe(96)
    expect(resolveGoals(GOALS, 'training').water).toBe(128) // 96 + 32
  })

  it('adds the calorie buffer on top of what the macros come to, on every day type', () => {
    const buffered = { ...GOALS, calorieBuffer: 100 }
    expect(resolveGoals(buffered, 'rest').calories).toEqual({ min: 1800, max: 1800 }) // 1700 + 100
    expect(resolveGoals(buffered, 'training').calories).toEqual({ min: 1940, max: 1940 }) // 1840 + 100
    expect(resolveGoals(buffered, 'rest').protein).toEqual({ min: 130, max: 130 }) // the macros themselves don't move
  })
})

describe('goalMet', () => {
  it('treats calories and carbs as caps: at or under the top is a hit, over is a miss', () => {
    const r = { min: 1900, max: 2100 }
    expect(goalMet(2100, r, 'calories')).toBe(true) // exactly on the line counts
    expect(goalMet(1200, r, 'calories')).toBe(true) // well under is still a hit
    expect(goalMet(2101, r, 'calories')).toBe(false)
    expect(goalMet(0, { min: 220, max: 237 }, 'carbs')).toBe(true)
    expect(goalMet(237.1, { min: 220, max: 237 }, 'carbs')).toBe(false)
  })

  it('treats fat as a floor, like protein: at or over the goal is a hit, under is a miss', () => {
    const r = { min: 60, max: 60 }
    expect(goalMet(60, r, 'fat')).toBe(true)
    expect(goalMet(80, r, 'fat')).toBe(true)
    expect(goalMet(59.9, r, 'fat')).toBe(false)
  })

  it('says which way each goal points, and where a day stands in those terms', () => {
    const r = { min: 60, max: 60 }
    expect(goalDirection('fat')).toBe('reach')
    expect(goalDirection('carbs')).toBe('stay under')
    expect(goalDirection('protein')).toBe('reach')
    expect(goalLabel('calories', { min: 1800, max: 1800 })).toBe('max 1800')
    expect(goalLabel('fiber', { min: 30, max: 30 })).toBe('min 30')
    expect(goalStatus('carbs', 45, r, 'g')).toEqual({ text: '15 g left', bad: false, met: true })
    expect(goalStatus('carbs', 72, r, 'g')).toEqual({ text: '12 g over', bad: true, met: false })
    expect(goalStatus('fat', 45, r, 'g')).toEqual({ text: '15 g to go', bad: false, met: false })
    expect(goalStatus('protein', 110, { min: 130, max: 130 }, 'g')).toEqual({ text: '20 g to go', bad: false, met: false })
    expect(goalStatus('protein', 150, { min: 130, max: 130 }, 'g')).toEqual({ text: 'Goal met', bad: false, met: true })
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
    workouts: 0, workoutMinutes: 0, meditationMinutes: 0, dogWalks: 0, dogMiles: 0,
    totals: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, ...totals },
    missing: { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 },
  })

  it("judges each day against its own day type's goal, never a blend", () => {
    // 1800 kcal: under the training cap (1840), over the rest one (1700).
    const days = [summary('training', { calories: 1800 }), summary('rest', { calories: 1800 })]
    expect(scoreDays(days).calories).toEqual({ met: 1, of: 2 })
  })

  it('leaves unlogged days out of both counts', () => {
    const days = [summary('rest', { protein: 135 }), summary('rest', {}, 0)]
    expect(scoreDays(days).protein).toEqual({ met: 1, of: 1 })
    expect(scoreDays([]).fiber).toEqual({ met: 0, of: 0 })
  })
})

describe('alcoholCaloriesLogged', () => {
  const food = (name: string, calories: number | null, protein: number | null, fat: number | null, carbs: number | null) =>
    ({ name, nutrients: { calories, protein, fat, carbs, fiber: null } })

  it("counts the part of a drink's calories that protein, fat and carbs don't explain", () => {
    // Two glasses of white wine: 241 kcal, of which 0.2 g protein and 7.6 g carbs explain 31.2.
    expect(alcoholCaloriesLogged([food('Alcoholic beverage, wine, table, white', 241, 0.2, 0, 7.6)])).toBe(209.8)
    // Beer keeps its carbs as carbs: 153 kcal less 1.6 g protein and 12.6 g carbs.
    expect(alcoholCaloriesLogged([food('Beer, regular', 153, 1.6, 0, 12.6)])).toBe(96.2)
  })

  it('counts a drink logged without macros in full, and one without calories not at all', () => {
    expect(alcoholCaloriesLogged([food('Kentucky Straight Bourbon Whiskey', 251, null, null, null)])).toBe(251)
    expect(alcoholCaloriesLogged([food('Red wine', null, 0, 0, 4)])).toBe(0)
  })

  it('adds up every drink in the day and ignores ordinary food', () => {
    expect(alcoholCaloriesLogged([
      food('Oats', 190, 6.5, 3.4, 33),
      food('Alcoholic beverage, distilled, rum, 80 proof', 128, 0, 0, 0),
      food('Pinot noir', 125, 0.1, 0, 3.8),
    ])).toBe(237.4)
    expect(alcoholCaloriesLogged([])).toBe(0)
  })

  it('adds nothing for a food that only mentions a drink, or one that only fails to add up', () => {
    // Named for a drink, but its macros account for all of it (and then some).
    expect(alcoholCaloriesLogged([food('Rum raisin ice cream', 250, 4, 14, 28)])).toBe(0)
    expect(alcoholCaloriesLogged([food('Ginger ale', 124, 0, 0, 32)])).toBe(0)
    expect(alcoholCaloriesLogged([food('Non-alcoholic beer', 60, 0.8, 0, 14.2)])).toBe(0)
    // Calories the macros don't explain, but nothing says it's a drink: "gin" is not "ginger".
    expect(alcoholCaloriesLogged([food('Ginger chews', 300, 0, 0, 20)])).toBe(0)
  })
})

describe('alcoholCalories', () => {
  it('counts standard drinks at 150 for beer, 125 for wine and 100 for liquor', () => {
    expect(alcoholCalories({ beer: 1, wine: 2, liquor: 1 })).toBe(500)
    expect(alcoholCalories({ beer: 0, wine: 0, liquor: 0 })).toBe(0)
  })

})

describe('scoreWater', () => {
  it('counts days that reached the goal, of the days any water was logged on', () => {
    const days = [{ water: 96 }, { water: 128 }, { water: 92 }, { water: 0 }]
    // 96 and 128 reach the goal; 92 falls short; the 0 day is left out, not a miss.
    expect(scoreWater(days, 96)).toEqual({ met: 2, of: 3 })
    expect(scoreWater(days, 0)).toEqual({ met: 0, of: 3 }) // no goal set: nothing can be met
  })

  it("judges each day against its own goal when it has one: 96 oz misses a training day's 128", () => {
    const days = [{ water: 96, goals: { water: 96 } }, { water: 96, goals: { water: 128 } }, { water: 128, goals: { water: 128 } }]
    expect(scoreWater(days, 96)).toEqual({ met: 2, of: 3 })
  })
})

describe('meditation', () => {
  it('meets the goal at or over the minutes, and scores only the days any was logged, like water', () => {
    expect(meditationMet(10, 10)).toBe(true)
    expect(meditationMet(25, 10)).toBe(true)
    expect(meditationMet(9, 10)).toBe(false)
    expect(meditationMet(30, 0)).toBe(false) // no goal set
    const days = [{ meditationMinutes: 10 }, { meditationMinutes: 5 }, { meditationMinutes: 0 }, { meditationMinutes: 20 }]
    expect(scoreMeditation(days, 10)).toEqual({ met: 2, of: 3 })
  })
})

describe('streakThrough', () => {
  const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']
    .map((date, i) => ({ date, minutes: [5, 0, 10, 10, 10, 0, 0][i]! }))
  const sat = (d: { minutes: number }): boolean => d.minutes > 0

  it('counts consecutive logged days back from a date, stopping at the first gap', () => {
    expect(streakThrough(days, sat, '2026-10-02')).toBe(3) // the 30th, 1st and 2nd; the 29th is the gap
  })

  it("ignores days after the date -- days still ahead in the week can't break a streak", () => {
    // Midweek: the 3rd and 4th are empty because they haven't happened yet.
    expect(streakThrough(days, sat, '2026-10-01')).toBe(2)
  })

  it('is zero when the most recent day had nothing', () => {
    expect(streakThrough(days, sat, '2026-10-03')).toBe(0)
  })
})

describe('blendGoals', () => {
  const training = resolveGoals(GOALS, 'training')
  const rest = resolveGoals(GOALS, 'rest')

  it('averages each goal across the days given, field by field, to one decimal', () => {
    const blended = blendGoals([training, training, rest]) // 2 training days, 1 rest
    expect(blended.carbs.min).toBeCloseTo((195 + 195 + 160) / 3, 1)
    expect(blended.calories.min).toBeCloseTo((1840 + 1840 + 1700) / 3, 1)
    expect(blended.protein.min).toBe(130) // the same every day
  })

  it('carries fiber through unchanged, and averages water, which a training day raises', () => {
    const blended = blendGoals([training, rest])
    expect(blended.fiber).toBe(30)
    expect(blended.water).toBe(112) // (128 + 96) / 2
  })

  it('a single day blends to exactly that day\'s own goals', () => {
    expect(blendGoals([training])).toEqual(training)
  })

  it('refuses an empty list rather than returning something meaningless', () => {
    expect(() => blendGoals([] as ResolvedGoals[])).toThrow('blendGoals needs at least one day')
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

  it('finds the Sunday starting the week of any day in it', () => {
    expect(startOfWeek('2026-09-26')).toBe('2026-09-20') // a Saturday: the last day of its week
    expect(startOfWeek('2026-09-20')).toBe('2026-09-20') // already a Sunday
    expect(startOfWeek('2026-09-21')).toBe('2026-09-20') // a Monday -- the Sunday just before
    expect(startOfWeek('2026-10-01')).toBe('2026-09-27') // crosses a month
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

describe('dog walks', () => {
  it('counts a day done once it has every walk, extra ones included', () => {
    expect(dogWalksMet(2, 2)).toBe(true)
    expect(dogWalksMet(3, 2)).toBe(true)
    expect(dogWalksMet(1, 2)).toBe(false)
    expect(dogWalksMet(0, 0)).toBe(false)
  })

  it('scores only the days with any walk, like meditation', () => {
    expect(scoreDogWalks([{ dogWalks: 2 }, { dogWalks: 1 }, { dogWalks: 0 }], 2)).toEqual({ met: 1, of: 2 })
  })
})
