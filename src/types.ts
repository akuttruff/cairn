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
  /** Calories allowed on top of what the macros add up to, every day -- room for the odd extra. */
  calorieBuffer: number
  /** Grams per day, the same on any day type. */
  fiber: number
  /** Ounces per day, the same on any day type; tea counts toward it. */
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

/** What a water log was: plain water, or a mug of tea (which counts toward the water goal). */
export const DRINKS = ['water', 'tea'] as const
export type Drink = (typeof DRINKS)[number]

/** One log of water drunk -- a bottle, a mug of tea, whatever amount. */
export interface WaterLog {
  id: string
  date: string
  ounces: number
  drink: Drink
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
 * training day (the extra carbs apply).
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
    /** Total logged for this day, tea included. */
    ounces: number
    goal: number
    /** The part of `ounces` that was tea. */
    tea: number
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
    /** Sessions the active training schema has on this day, by title (see the Train tab). */
    planned: string[]
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
 * Body measurements, as Apple Health carries them (an iOS Shortcut posts
 * them to /api/body). Stored in kg and percent; shown in lb.
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
  /** Used for every job, in place of the three above, whenever LM Studio has it loaded; blank never overrides. */
  preferredModel: string
  /** Start an online lookup by itself once you stop typing. */
  autoLookup: boolean
  appIcon: AppIcon
  /** The daily charts to show in Week and Month, of CHARTABLE. */
  charts: ChartKey[]
  /** The workout activities, in the order the cards show them. */
  workoutKinds: WorkoutKindDef[]
  /** Model that writes the next training schema; blank uses the research model's choice. */
  trainingModel: string
  /** Model the training coach chats with; blank uses the research model's choice. */
  planChatModel: string
  equipment: Equipment
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
  preferredModel: string
  autoLookup: boolean
  appIcon: AppIcon
  /** The daily charts to show in Week and Month, of CHARTABLE. */
  charts: ChartKey[]
  /** The workout activities, in the order the cards show them. */
  workoutKinds: WorkoutKindDef[]
  trainingModel: string
  planChatModel: string
  equipment: Equipment
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

// ---------------------------------------------------------------------------
// Training schemas (see docs/training-schema.md)
// ---------------------------------------------------------------------------

/** Gear a home gym can have; the WOD bank only offers what this list allows. */
export const GEAR = [
  'barbell', 'plates', 'bumpers', 'rack', 'dumbbells', 'kettlebells', 'pullup-bar', 'rings', 'bands',
  'ab-mat', 'jump-rope', 'bike', 'rower', 'box',
] as const
export type Gear = (typeof GEAR)[number]

/** What's on hand to train with. Dumbbell and kettlebell weights are per bell, in lb. */
export interface Equipment {
  /** Everything on hand, wherever it is (with places, what they hold together). */
  gear: Gear[]
  dumbbells: number[]
  kettlebells: number[]
  /** Where it is, when it's in more than one room: a WOD is only offered if one place has all it needs. */
  places?: Place[]
}

/** One room's gear: a garage with the barbell and rings, a living room with the bike and dumbbells. */
export interface Place {
  name: string
  gear: Gear[]
  dumbbells: number[]
  kettlebells: number[]
}

/** One planned set. `pct` is of the item's lift PR; `test` expands to a ladder of singles (see resolve.ts). */
export interface SetTarget {
  reps?: number | 'max'
  seconds?: number
  pct?: number
  weight?: number
  /** 'ladder' works up to a PR attempt; 'single' stops at a sure single, for lifts that can't be bailed on iron plates. */
  test?: 'ladder' | 'single'
}

export interface Prescription {
  sets: SetTarget[]
  note?: string
}

/** A compact week-by-week rule: what the model writes instead of spelling out every week. */
export interface Progression {
  phases: { weeks: [number, number]; sets: number; reps: number; startPct: number; stepPct: number }[]
  deload?: { sets: number; reps: number; pct: number }
  test?: 'ladder' | 'single'
}

/** "A WOD from the bank goes here": what fits, not which one. */
export interface WodSlot {
  maxMinutes: number
  minMinutes?: number
  /** Allowed focuses; a WOD with any part outside them (core aside) doesn't fit. Omitted allows anything. */
  focus?: WodFocus[]
  /** Swap jumping and running for the bike (the ankle rule). */
  lowImpact?: boolean
}

export interface TrainingItem {
  id: string
  name: string
  lift?: string
  notes?: string
  /** Only in these weeks (inclusive); the item is absent the rest of the time. */
  onlyWeeks?: [number, number]
  /** Nice to do, not part of what makes the day done. */
  optional?: boolean
  // Exactly one of the following says what the item is.
  /** The same sets every week the item is on. */
  sets?: Prescription
  weeks?: Record<string, Prescription>
  progression?: Progression
  wod?: WodSlot
  check?: true
  minutes?: Record<string, number>
}

export interface TrainingSession {
  id: string
  title: string
  /** A workout activity from Settings; logging the session fills that activity's dot. */
  kind: string
  /** Nice to do, not part of what makes the day done (yoga, say). */
  optional?: boolean
  items: TrainingItem[]
}

export interface TrainingSchema {
  schemaVersion: 1
  name: string
  /** The Monday the first week starts. */
  startDate: string
  /** 0 when the schema opens with an intro week, else 1. */
  firstWeek: 0 | 1
  /** The last week's number. */
  weeks: number
  deloadWeeks: number[]
  testWeek?: number
  /** The schema this one was generated from. */
  basedOn?: string
  /** Free text: the targets, and for a generated schema, why it changed what it did. */
  goals?: string
  lifts: { id: string; name: string; increment: number }[]
  days: { weekday: number; sessions: TrainingSession[] }[]
  /** WODs written for this schema, in addition to the bank. */
  wods?: Wod[]
  /** Bank WODs this schema leaves out. */
  hiddenWods?: string[]
}

export type SchemaStatus = 'draft' | 'active' | 'done'

export interface SchemaSummary {
  id: string
  name: string
  status: SchemaStatus
  startDate: string
  endDate: string
  weeks: number
  firstWeek: 0 | 1
  basedOn: string | null
  createdAt: number
  /** A draft that rewrites the active schema from this week on, rather than following it. */
  rewriteFrom: number | null
}

export interface Lift {
  id: string
  name: string
  increment: number
  pr: number | null
  prDate: string | null
}

export interface SetLog {
  id: string
  reps: number | null
  weight: number | null
  seconds: number | null
  done: boolean
}

/** A set as the plan has it today, with today's PR applied, and what was logged against it. */
export interface ResolvedSet {
  index: number
  reps: number | 'max' | null
  seconds: number | null
  weight: number | null
  /** The last set of a test ladder: the PR attempt. */
  attempt?: boolean
  log: SetLog | null
}

export interface ResolvedItem {
  id: string
  name: string
  lift?: string
  notes?: string
  type: 'sets' | 'check' | 'minutes' | 'wod'
  optional?: boolean
  note?: string
  sets?: ResolvedSet[]
  minutes?: number
  done: boolean
  wod?: { slot: WodSlot; chosen: string | null; picks: WodView[] }
}

export interface ResolvedSession {
  id: string
  title: string
  kind: string
  optional?: boolean
  items: ResolvedItem[]
  done: boolean
}

export interface TrainingDay {
  date: string
  schema: SchemaSummary | null
  /** The draft generated from the active schema, waiting to be reviewed. */
  draft: SchemaSummary | null
  week: number | null
  deload: boolean
  test: boolean
  /** This calendar week repeats an earlier week of the schema. */
  repeat: boolean
  sessions: ResolvedSession[]
  /** One-off changes from the coach that touch this day: a session moved here or away, lighter weights, a stand-in. */
  adjustments: { id: string; text: string }[]
  /** The calendar week, Monday to Sunday, around `date`. */
  strip: { date: string; sessions: { id: string; title: string; kind: string; done: boolean; started: boolean; optional?: boolean }[] }[]
  lifts: Lift[]
}

/** A whole schema laid out week by week, for the overview and the draft review. */
export interface SchemaOverview {
  summary: SchemaSummary
  schema: TrainingSchema
  /** For each item with a lift, the top set of each week at today's PRs: "5×5 @ 95". */
  lifts: { itemId: string; name: string; lift: string; weeks: { week: number; text: string; top: number | null }[] }[]
}

export interface ProgressSeries {
  lifts: { id: string; name: string; pr: number | null; points: { date: string; weight: number; reps: number; e1rm: number }[]; prs: { date: string; weight: number }[] }[]
  baselines: { itemId: string; name: string; unit: 'reps' | 's'; points: { date: string; value: number }[] }[]
}

export interface GenerateStatus {
  status: 'idle' | 'running' | 'done' | 'error'
  startedAt: number | null
  draftId: string | null
  error: string | null
}

// --- the WOD bank ------------------------------------------------------------

export const WOD_FOCUSES = ['upper', 'legs', 'full', 'bike', 'core'] as const
export type WodFocus = (typeof WOD_FOCUSES)[number]

export interface WodPart {
  /** A movement id from lib/training/movements.ts. */
  move: string
  /** Reps, calories, metres or seconds, as the movement counts; omitted in a ladder, which takes the scheme's. */
  amount?: number
  /** lb: the barbell's total, or each dumbbell or kettlebell. */
  weight?: number
}

export interface Wod {
  id: string
  name: string
  format: 'rft' | 'amrap' | 'emom' | 'chipper' | 'ladder' | 'intervals'
  /** About how long it takes. */
  minutes: number
  rounds?: number
  /** A ladder's reps per round, e.g. 21-15-9. */
  scheme?: number[]
  /** Spelled out for the formats a name can't carry (intervals). */
  text?: string
  parts: WodPart[]
  notes?: string
}

/** A WOD as it will be done with the gear at hand: substitutions made, weights matched to what's there. */
export interface WodView {
  id: string
  name: string
  minutes: number
  heading: string
  lines: string[]
  swaps: string[]
  focus: WodFocus[]
  /** Where it's done, when the gear is in more than one place. */
  place?: string
}

// --- the coach: talking about the plan, and changing it ------------------------

/**
 * A change the coach can propose. The first five are one-off, dated changes
 * laid over the schema; the next six change the schema itself from a week on;
 * `rewrite` has the training model write the rest of the schema afresh.
 */
export type PlanEdit =
  | { op: 'move'; sessionId: string; from: string; to: string }
  | { op: 'skip'; date: string; sessionId?: string }
  | { op: 'load'; from: string; to: string; factor: number; lifts?: string[] }
  | { op: 'swap'; from: string; to: string; itemId: string; item: TrainingItem }
  | { op: 'equipment'; from: string; to: string; equipment: Equipment }
  | { op: 'replaceItem'; itemId: string; item: TrainingItem; fromWeek?: number }
  | { op: 'addItem'; sessionId: string; item: TrainingItem; fromWeek?: number }
  | { op: 'removeItem'; itemId: string; fromWeek?: number }
  | { op: 'addSession'; weekday: number; session: TrainingSession; fromWeek?: number }
  | { op: 'removeSession'; sessionId: string; fromWeek?: number }
  | { op: 'moveSession'; sessionId: string; toWeekday: number; fromWeek?: number }
  | { op: 'setOptional'; sessionId?: string; itemId?: string; optional: boolean; fromWeek?: number }
  | { op: 'rewrite'; instruction: string; fromWeek: number }
  | { op: 'removeWorkout'; workoutId: string }
  | { op: 'unlogSession'; date: string; sessionId: string }
  | { op: 'logSession'; date: string; sessionId: string }
  | { op: 'addWod'; wod: Wod }
  | { op: 'hideWod'; wodId: string }
  | { op: 'showWod'; wodId: string }
  | { op: 'setPlaces'; places: Place[] }

export const OVERRIDE_OPS = ['move', 'skip', 'load', 'swap', 'equipment'] as const
/** Changes to what was logged, not to the plan: a workout removed, a session unticked or ticked off. */
export const RECORD_OPS = ['removeWorkout', 'unlogSession', 'logSession'] as const
/** Changes to the WOD bank (kept in the schema) and to where the gear is (a setting). */
export const BANK_OPS = ['addWod', 'hideWod', 'showWod', 'setPlaces'] as const
export const REVISION_OPS = ['replaceItem', 'addItem', 'removeItem', 'addSession', 'removeSession', 'moveSession', 'setOptional'] as const

export interface PlanProposal {
  edits: PlanEdit[]
  /** What the edits would do, worked out by resolving the days before and after: "Fri Nov 6 → Sat Nov 7: Olympic lifts". */
  preview: string[]
}

export interface CoachMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  proposal: PlanProposal | null
  status: 'proposed' | 'applied' | 'declined' | 'undone' | null
  /** Anything worth saying about the proposal: why it couldn't be made, or that a rewrite is being written. */
  note: string | null
  /** How the reply was made: which model, how long, how fast. */
  stats: CoachStats | null
  /** A screenshot came with the message; it's served from /api/training/chat/:id/image. */
  image: boolean
  createdAt: number
}

export interface CoachStats {
  model: string
  seconds: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  tokensPerSecond: number
  firstTokenSeconds: number
}

/** What the coach is doing while it answers, for the page to show. */
export interface CoachStatus {
  phase: 'loading' | 'reading' | 'thinking' | 'writing' | 'checking' | 'retrying'
  /** 0..1 while loading the model or reading the plan. */
  progress: number | null
  tokens: number
  model: string | null
  startedAt: number
}
