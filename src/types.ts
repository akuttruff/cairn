/** Shared domain types, used by both the client and the server. */

export const NUTRIENTS = ['calories', 'protein', 'fat', 'carbs', 'fiber'] as const
export type NutrientKey = (typeof NUTRIENTS)[number]

/**
 * Nutrient amounts. `null` means unknown -- the source did not report it --
 * which is not the same as zero. Food databases routinely omit fiber, and
 * counting a missing value as 0 would silently understate the day's total.
 */
export type Nutrients = Record<NutrientKey, number | null>

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type Meal = (typeof MEALS)[number]

/** 'web': found by an online lookup (LM Studio + the deep-research MCP). */
export type FoodSource = 'usda' | 'off' | 'custom' | 'web'

/** A household measure with a known weight: "1 cup, sliced" = 110 g. */
export interface Serving {
  label: string
  grams: number
}

/**
 * Nutrition for one stated serving, as the source published it. The weight
 * is often unknown -- a restaurant says what "1 bowl" contains, not what it
 * weighs -- and is then null rather than guessed.
 */
export interface PerServing {
  label: string
  grams: number | null
  nutrients: Nutrients
}

/** Where a looked-up food's numbers came from, so they can be checked. */
export interface SourceLink {
  title: string
  url: string
}

/** Something that can be logged: a search result or a saved food. */
export interface Food {
  id: string
  name: string
  brand?: string
  source: FoodSource
  /** The source's own identifier, e.g. a USDA fdcId or a barcode. */
  sourceId?: string
  /**
   * Per 100 g. Null nutrients where the source is silent. Absent for a food
   * known only by its serving (see perServing); a food has at least one.
   */
  per100g?: Nutrients
  servings?: Serving[]
  perServing?: PerServing
  /** For looked-up foods: the page the numbers came from, and any caveats. */
  sources?: SourceLink[]
  note?: string
}

/** One thing eaten on one day. */
export interface Entry {
  id: string
  /** Local calendar date, YYYY-MM-DD, as the person experienced it. */
  date: string
  meal: Meal
  name: string
  brand?: string
  /** Weight eaten; null when it isn't known (a portion without a weight). */
  grams: number | null
  /**
   * How much, in the unit it was logged in: 1.5 x "1 cup". Kept so the log
   * reads the way you measured, and edits stay in that unit.
   */
  amount?: Amount
  /**
   * Absolute amounts for this portion, snapshotted when logged, so editing a
   * saved food later never rewrites what you already ate.
   */
  nutrients: Nutrients
  /** Kept when known, so changing the weight later rescales correctly. */
  per100g?: Nutrients
  /** Nutrition of one amount.unit, for a food known only per serving. */
  perUnit?: Nutrients
  foodId?: string
  source: FoodSource
  createdAt: number
}

/** A quantity of a unit: 2 x "1 slice". `unitGrams` is null when unknown. */
export interface Amount {
  quantity: number
  unit: string
  unitGrams: number | null
}

export const DAY_TYPES = ['training', 'rest'] as const
export type DayType = (typeof DAY_TYPES)[number]

/**
 * A target as a band with a bottom and a top. Today's goals are single
 * numbers, so min and max are equal; the shape stays so the bars and charts
 * can draw a band whenever one is wanted again.
 */
export interface MacroRange {
  min: number
  max: number
}

/**
 * What Settings edits: one base set of macros for every day, plus the extra
 * carbs a training day adds on top. Which days are training days is ticked
 * off day by day in Day view. There is no stored calorie goal -- see
 * ResolvedGoals for why, and resolveGoals() in lib/nutrition.ts for the math.
 */
export interface Goals {
  /** Grams per day, every day. */
  protein: number
  fat: number
  carbs: number
  /** Grams of fast carbs a training day adds (before the workout): 35 g is about 140 kcal. */
  trainingCarbs: number
  /** Grams per day, the same on any day type. */
  fiber: number
  /** Ounces per day. */
  water: number
  /** Standard drinks per calendar week (Monday-start), not per day -- see DayView.alcohol. */
  alcoholWeekly: number
}

/**
 * One day's goals, resolved to concrete numbers a day or range view can
 * compare a total against: the base macros, plus the carb bump on a training
 * day. Calories are computed from them (4 kcal/g protein and carbs, 9 kcal/g
 * fat) by resolveGoals(), never stored on their own -- so they can never
 * disagree with what the macros actually add up to, the way a hand-typed
 * calorie goal could. Each is a MacroRange with min = max.
 */
export interface ResolvedGoals {
  calories: MacroRange
  protein: MacroRange
  carbs: MacroRange
  fat: MacroRange
  fiber: number
  water: number
  alcoholWeekly: number
}

export interface DayTotals {
  totals: Record<NutrientKey, number>
  /** How many entries lacked each nutrient, so a total can say it is partial. */
  missing: Record<NutrientKey, number>
}

export const ALCOHOL_KINDS = ['beer', 'wine', 'liquor'] as const
export type AlcoholKind = (typeof ALCOHOL_KINDS)[number]

/** One standard drink (12 oz beer, 5 oz wine, 1.5 oz liquor). No daily goal -- see Goals.alcoholWeekly for the weekly one. */
export interface AlcoholLog {
  id: string
  date: string
  kind: AlcoholKind
  createdAt: number
}

/** One log of water drunk -- a bottle, a glass, whatever amount. */
export interface WaterLog {
  id: string
  date: string
  ounces: number
  createdAt: number
}

export interface DayView extends DayTotals {
  date: string
  entries: Entry[]
  dayType: DayType
  /** This day's goals, resolved from whichever of Goals.training/rest matches dayType -- see ResolvedGoals. */
  goals: ResolvedGoals
  water: {
    /** Total logged for this day. */
    ounces: number
    goal: number
    /** The most recent log's id, for a one-tap undo. Null with nothing logged yet. */
    lastLogId: string | null
  }
  alcohol: {
    /** Standard drinks logged for this day. */
    drinks: number
    byKind: Record<AlcoholKind, number>
    /** Standard drinks logged in the calendar week (Monday-start) containing this day, today included. */
    weekTotal: number
    weekGoal: number
    /** The most recent log's id, for a one-tap undo. Null with nothing logged yet. */
    lastLogId: string | null
  }
}

/** One calendar day's totals within a range view -- a bar in the week/month chart. */
export interface DaySummary extends DayTotals {
  date: string
  /** How many things were logged this day, so an empty day reads as "not logged" rather than "ate nothing". */
  entryCount: number
  dayType: DayType
  /** This day's own goals (training or rest): what its totals are judged against, never a blend. */
  goals: ResolvedGoals
  water: number
  alcohol: number
}

/** Per nutrient, how many of the range's logged days met that day's own goal -- see goalMet() in lib/nutrition.ts. */
export type Scorecard = Record<NutrientKey, { met: number; of: number }>

/**
 * A week or month at a glance: one summary per calendar day, plus totals and
 * averages over it. Macro averages are per day *with an entry* (loggedDays)
 * -- a day you forgot to log shouldn't drag the average down like a real
 * zero-calorie day would. Water and alcohol average over every day in the
 * range instead: whether you drank water is not conditional on having eaten.
 *
 * Training and rest days have different goals, so a range never judges a
 * day against an average: `scorecard` counts, per nutrient, the logged days
 * that met their own day's goal, and each DaySummary carries the goals it
 * was judged by. `goals` is the blend across the range's mix of day types
 * (see blendGoals()) -- a reference for the water card and the like, not a
 * target any one day had.
 */
export interface RangeView {
  start: string
  end: string
  days: DaySummary[]
  goals: ResolvedGoals
  dayTypes: Record<DayType, number>
  scorecard: Scorecard
  totalDays: number
  loggedDays: number
  totals: Record<NutrientKey, number>
  averages: Record<NutrientKey, number>
  /** `met` of `of`: days with any water logged that reached the daily goal -- see scoreWater(). */
  water: { total: number; average: number; met: number; of: number }
  alcohol: { total: number; average: number; byKind: Record<AlcoholKind, number> }
}

/** What a client sends to log something. The server assigns id and time. */
export interface NewEntry {
  date: string
  meal: Meal
  name: string
  brand?: string
  grams: number | null
  /**
   * Give per100g + grams for a food by weight; perUnit + amount for a food
   * known per serving; or nutrients alone for a one-off. `amount` may
   * accompany any of them, to record how it was measured.
   */
  per100g?: Nutrients
  perUnit?: Nutrients
  amount?: Amount
  nutrients?: Nutrients
  foodId?: string
  source: FoodSource
}

/** One food's contribution to a saved meal -- exactly how it will be
 * logged, minus the date and meal-of-day, which are chosen when it's used. */
export type MealPresetItem = Omit<NewEntry, 'date' | 'meal'>

/**
 * A named group of foods -- "Breakfast burrito", "Post-workout shake" --
 * logged together in one action instead of one at a time. Independent of
 * any of its items still being in My foods: deleting a saved food doesn't
 * touch a meal that used it, the same way logging one doesn't.
 */
export interface MealPreset {
  id: string
  name: string
  items: MealPresetItem[]
  createdAt: number
}

export interface Settings {
  /** Free key from api.data.gov; the shared DEMO_KEY allows 30 searches an hour. */
  usdaApiKey: string
  /** LM Studio's server, for online lookups through the deep-research MCP. */
  lmStudioUrl: string
  lmStudioToken: string
  /** Model to research with; blank uses whichever LLM LM Studio has loaded. */
  researchModel: string
  /** Start an online lookup by itself once you stop typing. */
  autoLookup: boolean
}

/** An LLM LM Studio has downloaded, and whether it's loaded right now. */
export interface LmModelOption {
  key: string
  loaded: boolean
}

/** What the browser may see of the settings: never a key or token itself. */
export interface PublicSettings {
  hasUsdaKey: boolean
  hasLmStudioToken: boolean
  lmStudioUrl: string
  researchModel: string
  autoLookup: boolean
}
