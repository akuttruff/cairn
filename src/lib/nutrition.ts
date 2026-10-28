import { ALCOHOL_KINDS, GOAL_NUTRIENTS, NUTRIENTS } from '../types.ts'
import type {
  AlcoholKind, DaySummary, DayTotals, Entry, GoalKey, Goals, Meal, MacroRange, NutrientKey, Nutrients, ResolvedGoals, Scorecard,
} from '../types.ts'

/** A starting point for Settings, not a fixed target: edit it to fit. */
export const DEFAULT_GOALS: Goals = {
  calories: 1800,
  minCalories: 0,
  protein: 130,
  fat: 60,
  fiber: 30,
  // Every day, whatever the activity: two 32oz bottles and a mug of tea.
  water: 72,
  alcoholWeekly: 7,
  // Lifting twice, yoga four times, pilates once and two WODs a week.
  workoutPlan: { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 },
  /** Two 25-minute sits a day (see SIT_MINUTES in MeditationTracker). */
  meditationMinutes: 50,
  // Two one-mile walks a day.
  dogWalks: 2,
  walkMiles: 1,
}

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

/**
 * Words that mark a logged food as an alcoholic drink. Whole words only, so
 * "gin" doesn't catch "ginger". A false match costs nothing -- see below.
 */
const ALCOHOL_WORDS = new RegExp(
  '\\b(' + [
    'alcoholic', 'wine', 'beer', 'ale', 'lager', 'ipa', 'stout', 'pilsner', 'cider', 'mead', 'sake', 'soju',
    'champagne', 'prosecco', 'cava', 'pinot', 'cabernet', 'merlot', 'malbec', 'syrah', 'zinfandel', 'chardonnay',
    'sauvignon', 'riesling', 'ros[eé]', 'vodka', 'gin', 'rum', 'whiske?y', 'bourbon', 'scotch', 'tequila', 'mezcal',
    'brandy', 'cognac', 'liqueur', 'liquor', 'vermouth', 'aperol', 'cocktail', 'margarita', 'martini', 'negroni',
    'mojito', 'spritz', 'hard seltzer',
  ].join('|') + ')\\b',
  'i',
)

/**
 * Calories that came from alcohol in the food log -- alcohol as a fourth
 * macro, at 7 kcal a gram. Nothing stores grams of alcohol, so it is worked
 * out: for an entry named as an alcoholic drink, whatever part of its
 * calories protein, fat and carbs don't account for. A glass of wine's
 * handful of carbs stays carbs; the rest is the alcohol.
 *
 * Both tests are needed. The name alone would count rum-raisin ice cream;
 * the leftover alone would count any food whose label doesn't add up. With
 * both, a food that merely mentions a drink has next to nothing left over
 * and adds nothing. A drink logged without macros counts in full.
 *
 * These calories are already inside the day's total: this says how much of
 * it they are, and never adds to it. The Alcohol card's drink count plays
 * no part.
 */
export function alcoholCaloriesLogged(entries: Pick<Entry, 'name' | 'nutrients'>[]): number {
  let sum = 0
  for (const { name, nutrients: n } of entries) {
    if (n.calories == null || !ALCOHOL_WORDS.test(name)) continue
    const fromMacros = (n.protein ?? 0) * 4 + (n.carbs ?? 0) * 4 + (n.fat ?? 0) * 9
    sum += Math.max(0, n.calories - fromMacros)
  }
  return round1(sum)
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
 * Caps: the goal is to stay under them, and coming in under is a win.
 * Going past turns the bar red and costs the day its goal.
 */
export const OVER_IS_BAD: ReadonlySet<NutrientKey> = new Set(['calories'])

/** Floors: the goal is to reach them, and going over is fine. */
export const UNDER_IS_BAD: ReadonlySet<NutrientKey> = new Set(['protein', 'fat', 'fiber'])

/** Which way a nutrient's goal points, in words: "stay under" a cap, "in range" a calorie range, "reach" a floor. */
export const goalDirection = (key: NutrientKey, range?: MacroRange | null): string =>
  (OVER_IS_BAD.has(key) ? (range && range.min > 0 ? 'in range' : 'stay under') : 'reach')

/** The goal as it reads beside a total: "max 1800", "1500–1800", "min 130". */
export function goalLabel(key: NutrientKey, range: MacroRange): string {
  const n = (v: number): string => String(Math.round(v * 10) / 10)
  if (OVER_IS_BAD.has(key)) return range.min > 0 ? `${n(range.min)}–${n(range.max)}` : `max ${n(range.max)}`
  return `min ${n(range.min)}`
}

/**
 * Where a day's total stands against its goal, in words that follow the
 * goal's direction: a cap has some "left" or is "over"; a floor has some
 * "to go" until it's "Goal met". A calorie range is "to go" below its
 * bottom, then "left" up to its top. `bad` only for a cap that's been passed.
 */
export function goalStatus(key: NutrientKey, total: number, range: MacroRange, unit = ''): { text: string; bad: boolean; met: boolean } {
  const amount = (v: number): string => `${Math.round(v)}${unit ? ` ${unit}` : ''}`
  if (OVER_IS_BAD.has(key)) {
    if (total > range.max) return { text: `${amount(total - range.max)} over`, bad: true, met: false }
    if (total < range.min) return { text: `${amount(range.min - total)} to go`, bad: false, met: false }
    return { text: `${amount(range.max - total)} left`, bad: false, met: true }
  }
  return total >= range.min
    ? { text: 'Goal met', bad: false, met: true }
    : { text: `${amount(range.min - total)} to go`, bad: false, met: false }
}

/** A nutrient's target as a range, fiber included (a single number, so min = max); null for carbs, which have none. */
export function goalRangeFor(goals: ResolvedGoals, key: NutrientKey): MacroRange | null {
  if (key === 'carbs') return null
  return key === 'fiber' ? { min: goals.fiber, max: goals.fiber } : goals[key]
}

/** Whether a nutrient has a goal at all. */
export const hasGoal = (key: NutrientKey): key is GoalKey => key !== 'carbs'

/**
 * Whether a day's total hit its goal. Calories are met within their range
 * (at or under the cap, when there's no minimum); protein, fat and fiber at
 * or over their floors (going over is fine). Exactly on the line counts.
 */
export function goalMet(total: number, range: MacroRange, kind: NutrientKey): boolean {
  if (OVER_IS_BAD.has(kind) && (total > range.max || total < range.min)) return false
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
  for (const key of GOAL_NUTRIENTS) {
    out[key] = {
      met: logged.filter((d) => goalMet(d.totals[key], goalRangeFor(d.goals, key)!, key)).length,
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
export function scoreWater(days: (Pick<DaySummary, 'water'> & { goals?: { water: number } })[], goal: number): { met: number; of: number } {
  const logged = days.filter((d) => d.water > 0)
  // Each day against its own goal when it carries one.
  return { met: logged.filter((d) => waterMet(d.water, d.goals?.water ?? goal)).length, of: logged.length }
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

/** The dog's day is done once she's had the day's walks; an extra one is fine. */
export function dogWalksMet(walks: number, goal: number): boolean {
  return goal > 0 && walks >= goal
}

/** Days with every walk, of the days any walk was logged -- the same reasoning as scoreMeditation. */
export function scoreDogWalks(days: Pick<DaySummary, 'dogWalks'>[], goal: number): { met: number; of: number } {
  const logged = days.filter((d) => d.dogWalks > 0)
  return { met: logged.filter((d) => dogWalksMet(d.dogWalks, goal)).length, of: logged.length }
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

/** The goals as the day and range views judge totals against them. */
export function resolveGoals(goals: Goals): ResolvedGoals {
  const exact = (n: number): MacroRange => ({ min: n, max: n })
  return {
    calories: { min: Math.min(goals.minCalories ?? 0, goals.calories), max: goals.calories }, protein: exact(goals.protein), fat: exact(goals.fat),
    fiber: goals.fiber, water: goals.water, alcoholWeekly: goals.alcoholWeekly,
    meditationMinutes: goals.meditationMinutes,
    dogWalks: goals.dogWalks, walkMiles: goals.walkMiles,
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

/** First day (Sunday) of the calendar week containing `date`. Weeks run Sunday to Saturday. */
export function startOfWeek(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  // getDay() is 0 = Sunday..6 = Saturday: exactly the days since the week began.
  return addDays(date, -new Date(y!, m! - 1, d!).getDay())
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
