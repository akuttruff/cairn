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
  /** Ounces of water a training day adds to the daily water goal. */
  trainingWater: number
  /** Calories allowed on top of what the macros add up to, every day -- room for the odd extra. */
  calorieBuffer: number
  /** Grams per day, the same on any day type. */
  fiber: number
  /** Ounces per day. */
  water: number
  /** Standard drinks per calendar week (Sunday-start), not per day -- see DayView.alcohol. */
  alcoholWeekly: number
  /**
   * The default weekly plan: sessions of each kind per calendar week
   * (Sunday-start). A week can have its own plan instead -- see
   * DayView.workouts.planIsCustom -- so one week can differ without
   * changing the rest.
   */
  workoutPlan: WorkoutPlan
  /** Minutes of meditation per day. */
  meditationMinutes: number
  /** Dog walks per day. */
  dogWalks: number
  /** Miles in one walk: what a tap logs. */
  walkMiles: number
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
  meditationMinutes: number
  dogWalks: number
  walkMiles: number
}

export interface DayTotals {
  /** Food only; the day's drinks are reported separately (see DayView.alcohol.calories). */
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

/** The icons an activity can carry, by name (see lib/workoutIcons.ts for the drawings). */
export const WORKOUT_ICONS = [
  'flame', 'dumbbell', 'footprints', 'bike', 'sparkles', 'person-standing', 'waves', 'mountain', 'heart-pulse',
  'activity', 'zap', 'target', 'timer', 'trophy', 'medal', 'swords', 'music', 'snowflake', 'sun', 'sailboat',
  'tent', 'volleyball',
] as const
export type WorkoutIcon = (typeof WORKOUT_ICONS)[number]

/**
 * One kind of workout, as set up in Settings. `id` is what sessions and
 * plans are stored under and never changes once logs carry it; `label` and
 * `icon` are how it shows. `training`: logging one ticks the day as a
 * training day (the extra carbs and water apply).
 */
export interface WorkoutKindDef {
  id: string
  label: string
  icon: WorkoutIcon
  training: boolean
}

/** The activities Cairn starts with; Settings can change, add to or remove them. */
export const DEFAULT_WORKOUT_KINDS: WorkoutKindDef[] = [
  { id: 'wod', label: 'WOD', icon: 'flame', training: true },
  { id: 'weightlifting', label: 'Lifting', icon: 'dumbbell', training: true },
  { id: 'run', label: 'Run', icon: 'footprints', training: false },
  { id: 'cycling', label: 'Cycling', icon: 'bike', training: false },
  { id: 'yoga', label: 'Yoga', icon: 'sparkles', training: false },
  { id: 'pilates', label: 'Pilates', icon: 'person-standing', training: false },
]
/** The ids of those, for anything that needs a kind without the settings in hand. */
export const WORKOUT_KINDS: readonly string[] = DEFAULT_WORKOUT_KINDS.map((k) => k.id)

/** A workout kind's id -- one of the kinds in Settings (or one that was, on an old log). */
export type WorkoutKind = string

/** Sessions of each kind to aim for in a week, by kind id; 0 for a kind that isn't in the plan. */
export type WorkoutPlan = Record<WorkoutKind, number>

/**
 * One workout session. Logging a WOD or weightlifting session also ticks
 * the day as a training day (see Store.addWorkout), since that is what the
 * box means; the box can still be unticked by hand.
 */
export interface WorkoutLog {
  id: string
  date: string
  kind: WorkoutKind
  /** How long, when noted; null when just the session was logged. */
  minutes: number | null
  note?: string
  createdAt: number
}

/** One sit. Minutes are the unit: a daily goal of ten is ten, however many sits it took. */
export interface MeditationLog {
  id: string
  date: string
  minutes: number
  note?: string
  createdAt: number
}

/** One walk with the dog. Its miles are kept as logged, so changing the usual length later rewrites nothing. */
export interface DogWalkLog {
  id: string
  date: string
  miles: number
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
    /** What those drinks come to in calories -- reported beside the day, not included in totals.calories. See ALCOHOL_KCAL. */
    calories: number
    /** Standard drinks logged in the calendar week (Sunday-start) containing this day, today included. */
    weekTotal: number
    /** Those, by kind: what the week's drinks were, not just how many. */
    weekByKind: Record<AlcoholKind, number>
    weekGoal: number
    /** The most recent log's id, for a one-tap undo. Null with nothing logged yet. */
    lastLogId: string | null
  }
  workouts: {
    /** This day's sessions, newest first. */
    sessions: WorkoutLog[]
    /** Minutes across them (sessions without a duration add nothing). */
    minutes: number
    /** The Sunday this day's week starts on: the plan below, and the counts, are that week's. */
    weekStart: string
    /** The activities as set up in Settings, in order: what the card offers and how each is labelled. */
    kinds: WorkoutKindDef[]
    /** That week's plan: its own, if it has one, else the default from Settings. */
    plan: WorkoutPlan
    planIsCustom: boolean
    /** Sessions of each kind logged in that week so far. */
    weekByKind: Record<WorkoutKind, number>
    /** Every session in that week, latest day first (newest first within a day). */
    weekSessions: WorkoutLog[]
    /** All of them, against the plan's total. */
    weekTotal: number
    weekGoal: number
    lastLogId: string | null
  }
  meditation: {
    sessions: MeditationLog[]
    minutes: number
    goal: number
    lastLogId: string | null
  }
  /** The day's walks with the dog, newest first, against the walks-per-day goal. */
  dog: {
    walks: DogWalkLog[]
    miles: number
    goal: number
    /** Miles in one walk, from Settings: what the button logs. */
    walkMiles: number
    lastLogId: string | null
  }
  /** The latest body measurement of each kind as of this day (null: none yet), and its change since the reading before. */
  body: Record<BodyMetric, BodyReading | null>
}

/**
 * Body measurements, as Apple Health carries them from the scale (Withings
 * syncs there; an iOS Shortcut posts them to /api/body). Stored in kg and
 * percent; shown in lb.
 */
export const BODY_METRICS = ['weight', 'bodyFat', 'leanMass', 'bmi'] as const
export type BodyMetric = (typeof BODY_METRICS)[number]

export interface BodyReading {
  /** kg for weight and lean mass, percent for body fat, plain for BMI. */
  value: number
  /** When it was measured (ms), and the local day that falls on. */
  measuredAt: number
  date: string
  /** Since the previous reading of the same kind; null for the first. */
  change: number | null
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
  /** Sessions and minutes that day. */
  workouts: number
  workoutMinutes: number
  meditationMinutes: number
  dogWalks: number
  dogMiles: number
}

/** Per nutrient, how many of the range's logged days met that day's own goal -- see goalMet() in lib/nutrition.ts. */
export type Scorecard = Record<NutrientKey, { met: number; of: number }>

/**
 * A week or month at a glance: one summary per calendar day, plus totals and
 * averages over it. Averages and scores cover only *finished* days
 * (averagedDays): today is still being logged and the days ahead haven't
 * happened, so neither should drag an average down or count as a miss (on
 * the range's first day, today stands in). Macro averages are further per
 * finished day *with an entry* -- a day you forgot to log shouldn't count
 * like a real zero-calorie day. Water, drinks and meditation average over
 * every finished day: whether you drank water is not conditional on eating.
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
  /** Which daily charts to draw, from Settings. */
  charts: ChartKey[]
  totalDays: number
  loggedDays: number
  /** The finished days that averages and scores are over -- see above. */
  averagedDays: number
  totals: Record<NutrientKey, number>
  averages: Record<NutrientKey, number>
  /** `met` of `of`: days with any water logged that reached the daily goal -- see scoreWater(). */
  water: { total: number; average: number; met: number; of: number }
  /** `calories`: what the range's drinks come to, reported beside the food totals, not in them. */
  alcohol: { total: number; average: number; calories: number; byKind: Record<AlcoholKind, number> }
  /**
   * Sessions over the range, the days that had one, the minutes noted, and
   * the count of each kind against its goal. Goals come from each week's own
   * plan, prorated by how many of that week's days fall in the range (a
   * month starting midweek gets part of that week's plan), rounded.
   */
  workouts: {
    sessions: number; days: number; minutes: number
    /** The activities as set up in Settings, in order. */
    kinds: WorkoutKindDef[]
    byKind: Record<WorkoutKind, number>
    goalByKind: Record<WorkoutKind, number>
    goal: number
  }
  /** `met` of `of`: days with any meditation logged that reached the daily minutes -- like water. `streak`: consecutive days ending at the range's end (or today, if earlier) with any logged. */
  meditation: { total: number; average: number; days: number; met: number; of: number; streak: number }
  /** Walks and miles over the range; `met` of `of` and `streak` as for meditation. */
  dog: { walks: number; miles: number; days: number; met: number; of: number; streak: number }
  /** Per kind: the first and last reading in the range, and the change between them; null with none in range. */
  body: Record<BodyMetric, { first: number; last: number; change: number; count: number } | null>
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

/**
 * The app's icon, chosen in Settings. All of them stay in /icons; the one
 * picked is what /icon.svg and the home-screen PNGs serve. A phone keeps
 * the icon it saw when the app was added to its home screen.
 */
export const APP_ICONS = ['ring', 'stack', 'pillars', 'line', 'dawn', 'paper'] as const
export type AppIcon = (typeof APP_ICONS)[number]

/** What the Week and Month views can chart per day; Settings picks which. Shown in this order. */
export const CHARTABLE = ['calories', 'protein', 'fat', 'carbs', 'fiber', 'water'] as const
export type ChartKey = (typeof CHARTABLE)[number]
export const DEFAULT_CHARTS: ChartKey[] = ['calories', 'protein', 'fiber', 'water']

export interface Settings {
  /** Free key from api.data.gov; the shared DEMO_KEY allows 30 searches an hour. */
  usdaApiKey: string
  /** LM Studio's server, for online lookups through the deep-research MCP. */
  lmStudioUrl: string
  lmStudioToken: string
  /** Model to research with; blank uses whichever LLM LM Studio has loaded. */
  researchModel: string
  /** Model that writes the week and month notes; blank uses the research model's choice. */
  notesModel: string
  /** Vision model that reads a photographed nutrition label; blank uses whichever vision model is loaded. */
  labelModel: string
  /** Start an online lookup by itself once you stop typing. */
  autoLookup: boolean
  appIcon: AppIcon
  /** The daily charts to show in Week and Month, of CHARTABLE. */
  charts: ChartKey[]
  /** The workout activities, in the order the cards show them. */
  workoutKinds: WorkoutKindDef[]
}

/** An LLM LM Studio has downloaded, whether it's loaded right now, and whether it can see images. */
export interface LmModelOption {
  key: string
  loaded: boolean
  vision: boolean
}

/** What the browser may see of the settings: never a key or token itself. */
export interface PublicSettings {
  hasUsdaKey: boolean
  hasLmStudioToken: boolean
  lmStudioUrl: string
  researchModel: string
  notesModel: string
  labelModel: string
  autoLookup: boolean
  appIcon: AppIcon
  /** The daily charts to show in Week and Month, of CHARTABLE. */
  charts: ChartKey[]
  /** The workout activities, in the order the cards show them. */
  workoutKinds: WorkoutKindDef[]
}

/**
 * What a vision model read off a photographed nutrition label: the fields
 * of the Manual tab, filled in as far as the photo allowed. Null where the
 * label did not say (a label rarely names the product), never a guess.
 */
export interface LabelReading {
  name: string | null
  brand: string | null
  serving: { label: string; grams: number | null }
  nutrients: Nutrients
  /** Anything worth a second look: a value that was hard to read, a serving stated per container. */
  note?: string
  model: string
}

/**
 * Notes on a week or month, written by the local model from that range's
 * numbers. `stale` says the range's data has changed since they were written.
 */
export interface RangeNotes {
  start: string
  end: string
  text: string
  model: string
  /** When they were written, ms since the epoch. */
  at: number
  stale: boolean
}
