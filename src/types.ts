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

/** Water isn't one of the NUTRIENTS: it's not per-food, so it never flows through sumDay's totals/missing. */
export interface Goals extends Record<NutrientKey, number> {
  /** Ounces per day. */
  water: number
}

export interface DayTotals {
  totals: Record<NutrientKey, number>
  /** How many entries lacked each nutrient, so a total can say it is partial. */
  missing: Record<NutrientKey, number>
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
  goals: Goals
  water: {
    /** Total logged for this day. */
    ounces: number
    goal: number
    /** The most recent log's id, for a one-tap undo. Null with nothing logged yet. */
    lastLogId: string | null
  }
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

/** What the browser may see of the settings: never a key or token itself. */
export interface PublicSettings {
  hasUsdaKey: boolean
  hasLmStudioToken: boolean
  lmStudioUrl: string
  researchModel: string
  autoLookup: boolean
}
