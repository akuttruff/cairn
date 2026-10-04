import { ALCOHOL_KINDS, NUTRIENTS } from '../types.ts'
import type {
  AlcoholKind, DaySummary, DayTotals, DayType, Entry, Goals, Meal, MacroRange, NutrientKey, Nutrients, ResolvedGoals, Scorecard,
  WorkoutKind,
} from '../types.ts'

/**
 * A starting point for Settings, not a fixed target: edit it to fit. The
 * base works out to 1,700 kcal (130*4 + 60*9 + 160*4); a training day's
 * 35 g of fast carbs makes it 1,840.
 */
export const DEFAULT_GOALS: Goals = {
  protein: 130,
  fat: 60,
  carbs: 160,
  trainingCarbs: 35,
  fiber: 30,
  water: 96,
  alcoholWeekly: 7,
  workoutsWeekly: 6,
  /** One sit a day: the user's sessions are always 25 minutes (see MeditationTracker). */
  meditationMinutes: 25,
}

/** The workout kinds that make a day a training day (the carb bump is for these). */
export const TRAINING_KINDS: ReadonlySet<WorkoutKind> = new Set(['wod', 'weightlifting'])

export const UNITS: Record<NutrientKey, string> = {
  calories: 'kcal',
  protein: 'g',
  fat: 'g',
  carbs: 'g',
  fiber: 'g',
}

export const LABELS: Record<NutrientKey, string> = {
  calories: 'Calories',
  protein: 'Protein',
  fat: 'Fat',
  carbs: 'Carbs',
  fiber: 'Fiber',
}

export const emptyNutrients = (): Nutrients =>
  ({ calories: null, protein: null, fat: null, carbs: null, fiber: null })

/** One decimal place: finer than any label or scale is accurate to. */
export const round1 = (n: number): number => Math.round(n * 10) / 10

/** Amounts in `grams` of a food, from its per-100g values. Unknown stays unknown. */
export function scale(per100g: Nutrients, grams: number): Nutrients {
  const out = emptyNutrients()
  for (const key of NUTRIENTS) {
    const v = per100g[key]
    out[key] = v == null ? null : round1((v * grams) / 100)
  }
  return out
}

/**
 * Adds several nutrient sets together -- a meal preset's combined total, say.
 * A key is null only when every one of them left it unknown; otherwise the
 * ones that stated it are summed, same as a day's own totals do.
 */
export function sumNutrients(list: Nutrients[]): Nutrients {
  const out = emptyNutrients()
  for (const key of NUTRIENTS) {
    const known = list.map((n) => n[key]).filter((v): v is number => v != null)
    out[key] = known.length ? round1(known.reduce((a, b) => a + b, 0)) : null
  }
  return out
}

/**
 * Calories in one standard drink: a 12 oz beer at about 5%, a 5 oz glass of
 * wine, a 1.5 oz shot. Close enough to count; nobody logs the ABV. Reported
 * alongside a day's food, not folded into it.
 */
export const ALCOHOL_KCAL: Record<AlcoholKind, number> = { beer: 150, wine: 125, liquor: 100 }

/** What a day's drinks come to, for the record: shown beside the day, never added to its totals. */
export function alcoholCalories(byKind: Record<AlcoholKind, number>): number {
  return ALCOHOL_KINDS.reduce((sum, kind) => sum + byKind[kind] * ALCOHOL_KCAL[kind], 0)
}

/** Sum a day's entries, counting which ones were missing each nutrient. */
export function sumDay(entries: Entry[]): DayTotals {
  const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
  const missing = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
  for (const entry of entries) {
    for (const key of NUTRIENTS) {
      const v = entry.nutrients[key]
      if (v == null) missing[key] += 1
      else totals[key] += v
    }
  }
  for (const key of NUTRIENTS) totals[key] = round1(totals[key])
  return { totals, missing }
}

/**
 * Energy implied by the macros: 4 kcal/g protein, 4 kcal/g carbohydrate,
 * 9 kcal/g fat. Null if any of the three is unknown.
 */
export function macroCalories(n: Nutrients): number | null {
  if (n.protein == null || n.carbs == null || n.fat == null) return null
  return round1(n.protein * 4 + n.carbs * 4 + n.fat * 9)
}

/**
 * Calories implied by whatever of protein/fat/carbs is typed so far, a blank
 * one counted as 0 -- so the total updates as each macro is typed, rather
 * than waiting until all three are filled (contrast macroCalories, which
 * answers "do the stated macros match the stated calories?" and so needs
 * all three before it will say anything). Null only when none are typed.
 */
export function impliedCalories(protein: number | null, fat: number | null, carbs: number | null): number | null {
  if (protein == null && fat == null && carbs == null) return null
  return round1((protein ?? 0) * 4 + (carbs ?? 0) * 4 + (fat ?? 0) * 9)
}

/**
 * Whether the stated calories disagree with the macros by more than a
 * tolerance. Catches a typo in manual entry -- 2500 for 250 -- which would
 * otherwise wreck the day's total without anyone noticing.
 *
 * The tolerance is generous because labels legitimately differ: fiber and
 * sugar alcohols carry fewer calories than other carbohydrate, and rounding
 * on small portions is coarse.
 */
export function calorieMismatch(n: Nutrients, tolerance = 0.25): boolean {
  const derived = macroCalories(n)
  if (derived == null || n.calories == null) return false
  if (derived < 20 && n.calories < 20) return false // too small to judge
  const larger = Math.max(derived, n.calories)
  return Math.abs(derived - n.calories) / larger > tolerance
}

/** Fraction of a goal reached, clamped to [0, 1] for drawing. */
export function progress(total: number, goal: number): number {
  if (!(goal > 0)) return 0
  return Math.min(1, Math.max(0, total / goal))
}

/** Where a total lands against a range: still to go, within it, or past the top. */
export type RangeStatus = 'under' | 'in' | 'over'
export function rangeStatus(total: number, range: MacroRange): RangeStatus {
  if (total > range.max) return 'over'
  if (total < range.min) return 'under'
  return 'in'
}

/**
 * Going past the goal only counts against these -- they're caps, and coming
 * in under is a win. Extra protein, fat or fiber neither turns a bar red
 * nor costs a day its goal.
 */
export const OVER_IS_BAD: ReadonlySet<NutrientKey> = new Set(['calories', 'carbs'])

/**
 * Falling short of the goal counts against these -- they're floors. Fat is
 * one: with single-number goals it can't be a band, and too little fat is
 * the problem worth catching ("don't dip below 60 g").
 */
export const UNDER_IS_BAD: ReadonlySet<NutrientKey> = new Set(['protein', 'fiber', 'fat'])

/** A nutrient's target as a range, fiber included (a single number, so min = max). */
export function goalRangeFor(goals: ResolvedGoals, key: NutrientKey): MacroRange {
  return key === 'fiber' ? { min: goals.fiber, max: goals.fiber } : goals[key]
}

/**
 * Whether a day's total hit its goal. The goals are caps and floors, not
 * targets to land on: calories and carbs are met at or under the goal
 * (coming in under is a win, not a miss); protein, fat and fiber at or over
 * it (going over is fine). Exactly on the line counts.
 */
export function goalMet(total: number, range: MacroRange, kind: NutrientKey): boolean {
  if (OVER_IS_BAD.has(kind) && total > range.max) return false
  if (UNDER_IS_BAD.has(kind) && total < range.min) return false
  return true
}

/**
 * Per nutrient, how many of the logged days met that day's own goal. Days
 * with nothing logged are left out entirely -- a day you forgot to log is
 * not a day you missed your protein.
 */
export function scoreDays(days: DaySummary[]): Scorecard {
  const logged = days.filter((d) => d.entryCount > 0)
  const out = {} as Scorecard
  for (const key of NUTRIENTS) {
    out[key] = {
      met: logged.filter((d) => goalMet(d.totals[key], goalRangeFor(d.goals, key), key)).length,
      of: logged.length,
    }
  }
  return out
}

/** Water is like protein: reaching the goal is what counts, more is fine. */
export function waterMet(ounces: number, goal: number): boolean {
  return goal > 0 && ounces >= goal
}

/**
 * How many days reached the water goal, of the days any water was logged
 * on. A day with no water at all is almost always a day it wasn't logged,
 * not a day of drinking nothing, so it's left out rather than counted as a
 * miss.
 */
export function scoreWater(days: Pick<DaySummary, 'water'>[], goal: number): { met: number; of: number } {
  const logged = days.filter((d) => d.water > 0)
  return { met: logged.filter((d) => waterMet(d.water, goal)).length, of: logged.length }
}

/** Meditation is like water: reaching the day's minutes is what counts, more is fine. */
export function meditationMet(minutes: number, goal: number): boolean {
  return goal > 0 && minutes >= goal
}

/** Days that reached the meditation goal, of the days any was logged -- the same reasoning as scoreWater. */
export function scoreMeditation(days: Pick<DaySummary, 'meditationMinutes'>[], goal: number): { met: number; of: number } {
  const logged = days.filter((d) => d.meditationMinutes > 0)
  return { met: logged.filter((d) => meditationMet(d.meditationMinutes, goal)).length, of: logged.length }
}

/**
 * How many days in a row, counting back from `through` (the range's end,
 * or today if that comes first -- days still ahead can't break a streak),
 * had something logged. Zero when the most recent day didn't.
 */
export function streakThrough<T extends { date: string }>(days: T[], logged: (d: T) => boolean, through: string): number {
  let n = 0
  for (let i = days.length - 1; i >= 0; i--) {
    const d = days[i]!
    if (d.date > through) continue
    if (!logged(d)) break
    n++
  }
  return n
}

/**
 * A day's goals, calories included -- but calories are never stored on
 * their own (see Goals and ResolvedGoals). They're computed here from the
 * macros, at 4 kcal/g for protein and carbs and 9 for fat, so a calorie
 * target can never disagree with what the macros it's made of actually add
 * up to. A training day is the base plus its extra carbs.
 */
export function resolveGoals(goals: Goals, dayType: DayType): ResolvedGoals {
  const carbs = goals.carbs + (dayType === 'training' ? goals.trainingCarbs : 0)
  const exact = (n: number): MacroRange => ({ min: n, max: n })
  return {
    calories: exact(round1(goals.protein * 4 + carbs * 4 + goals.fat * 9)),
    protein: exact(goals.protein), carbs: exact(carbs), fat: exact(goals.fat),
    fiber: goals.fiber, water: goals.water, alcoholWeekly: goals.alcoholWeekly,
    workoutsWeekly: goals.workoutsWeekly, meditationMinutes: goals.meditationMinutes,
  }
}

/**
 * One reference goal for a week or month that mixed training and rest days:
 * each range field is the plain average of that field across every day's
 * own resolved goal. Not a strict target -- a week of training days and one
 * of rest days should read differently -- but a fair single line for a
 * chart, and for comparing the period's averages against.
 */
export function blendGoals(perDay: ResolvedGoals[]): ResolvedGoals {
  const first = perDay[0]
  if (!first) throw new Error('blendGoals needs at least one day')
  const avg = (pick: (g: ResolvedGoals) => MacroRange): MacroRange => ({
    min: round1(perDay.reduce((sum, g) => sum + pick(g).min, 0) / perDay.length),
    max: round1(perDay.reduce((sum, g) => sum + pick(g).max, 0) / perDay.length),
  })
  return {
    calories: avg((g) => g.calories), protein: avg((g) => g.protein), carbs: avg((g) => g.carbs), fat: avg((g) => g.fat),
    // These don't vary by day type, so every day's copy already agrees.
    fiber: first.fiber, water: first.water, alcoholWeekly: first.alcoholWeekly,
    workoutsWeekly: first.workoutsWeekly, meditationMinutes: first.meditationMinutes,
  }
}

/** Local calendar date for a moment, YYYY-MM-DD, in the device's timezone. */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Shift a YYYY-MM-DD date by whole days, staying in local calendar terms. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return localDate(new Date(y!, m! - 1, d! + days))
}

export const isDateString = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s

/** First day (Monday) of the calendar week containing `date`. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  // getDay() is 0 = Sunday..6 = Saturday; shift so Monday is 0 and Sunday is 6.
  const dow = (new Date(y!, m! - 1, d!).getDay() + 6) % 7
  return addDays(date, -dow)
}

/** First day of the calendar month containing `date`. */
export function startOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return localDate(new Date(y!, m! - 1, 1))
}

/** Last day of the calendar month containing `date`. */
export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  return localDate(new Date(y!, m!, 0)) // day 0 of next month = last day of this one
}

/**
 * Shift a date by whole calendar months, clamping the day so e.g. Jan 31
 * minus one month lands on Feb 28 (or 29), not overflowing into March.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const lastDayOfTarget = new Date(y!, m! - 1 + months + 1, 0).getDate()
  return localDate(new Date(y!, m! - 1 + months, Math.min(d!, lastDayOfTarget)))
}

/** Whole calendar days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const ms = Date.UTC(by!, bm! - 1, bd!) - Date.UTC(ay!, am! - 1, ad!)
  return Math.round(ms / 86_400_000)
}

/** The meal you are most likely logging at a given hour. */
export function mealForHour(hour: number): Meal {
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 22) return 'dinner'
  return 'snack'
}
