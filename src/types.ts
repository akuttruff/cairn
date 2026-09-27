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

export type FoodSource = 'usda' | 'off' | 'custom'

export interface Serving {
  label: string
  grams: number
}

/** Something that can be logged: a search result or a saved food. */
export interface Food {
  id: string
  name: string
  brand?: string
  source: FoodSource
  /** The source's own identifier, e.g. a USDA fdcId or a barcode. */
  sourceId?: string
  /** Per 100 g. Null where the source is silent. */
  per100g: Nutrients
  servings?: Serving[]
}

/** One thing eaten on one day. */
export interface Entry {
  id: string
  /** Local calendar date, YYYY-MM-DD, as the person experienced it. */
  date: string
  meal: Meal
  name: string
  brand?: string
  /** Weight eaten; null for a manual entry logged as a whole portion. */
  grams: number | null
  /**
   * Absolute amounts for this portion, snapshotted when logged, so editing a
   * saved food later never rewrites what you already ate.
   */
  nutrients: Nutrients
  /** Kept when known, so changing the weight later rescales correctly. */
  per100g?: Nutrients
  foodId?: string
  source: FoodSource
  createdAt: number
}

export type Goals = Record<NutrientKey, number>

export interface DayTotals {
  totals: Record<NutrientKey, number>
  /** How many entries lacked each nutrient, so a total can say it is partial. */
  missing: Record<NutrientKey, number>
}

export interface DayView extends DayTotals {
  date: string
  entries: Entry[]
  goals: Goals
}

/** What a client sends to log something. The server assigns id and time. */
export interface NewEntry {
  date: string
  meal: Meal
  name: string
  brand?: string
  grams: number | null
  /** Give per100g + grams for a food, or nutrients alone for a portion. */
  per100g?: Nutrients
  nutrients?: Nutrients
  foodId?: string
  source: FoodSource
}

export interface Settings {
  /** Free key from api.data.gov; the shared DEMO_KEY allows 30 searches an hour. */
  usdaApiKey: string
}

/** What the browser may see of the settings: never the key itself. */
export interface PublicSettings {
  hasUsdaKey: boolean
}
