import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_GOALS } from '../../src/lib/nutrition.ts'

// ---------------------------------------------------------------------------
// Storage paths and schema
// ---------------------------------------------------------------------------

/** 3 x 32oz bottles, the user's actual daily habit. */
const DEFAULT_WATER_OUNCES = DEFAULT_GOALS.water
const DEFAULT_ALCOHOL_WEEKLY = DEFAULT_GOALS.alcoholWeekly

export function locate(dir?: string) {
  const dataDir = dir || path.resolve(process.cwd(), '.data')
  return {
    dataDir,
    sqlite: path.join(dataDir, 'macros.sqlite'),
    // Pre-SQLite storage, read only to migrate once.
    legacyLog: path.join(dataDir, 'log.json'),
    legacySettings: path.join(dataDir, 'settings.json'),
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, meal TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  name TEXT NOT NULL, brand TEXT, grams REAL,
  amount_quantity REAL, amount_unit TEXT, amount_unit_grams REAL,
  nutrients_calories REAL, nutrients_protein REAL, nutrients_fat REAL, nutrients_carbs REAL, nutrients_fiber REAL,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_unit INTEGER NOT NULL DEFAULT 0,
  per_unit_calories REAL, per_unit_protein REAL, per_unit_fat REAL, per_unit_carbs REAL, per_unit_fiber REAL,
  food_id TEXT, source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')), created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);

CREATE TABLE IF NOT EXISTS foods (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT,
  source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')), source_id TEXT,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_serving INTEGER NOT NULL DEFAULT 0, per_serving_label TEXT, per_serving_grams REAL,
  per_serving_nutrients_calories REAL, per_serving_nutrients_protein REAL, per_serving_nutrients_fat REAL,
  per_serving_nutrients_carbs REAL, per_serving_nutrients_fiber REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS food_servings (
  food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, label TEXT NOT NULL, grams REAL NOT NULL,
  PRIMARY KEY (food_id, position)
);
CREATE TABLE IF NOT EXISTS food_sources (
  food_id TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
  PRIMARY KEY (food_id, position)
);

CREATE TABLE IF NOT EXISTS meal_presets (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meal_preset_items (
  preset_id TEXT NOT NULL REFERENCES meal_presets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, name TEXT NOT NULL, brand TEXT, grams REAL,
  amount_quantity REAL, amount_unit TEXT, amount_unit_grams REAL,
  has_per100g INTEGER NOT NULL DEFAULT 0,
  per100g_calories REAL, per100g_protein REAL, per100g_fat REAL, per100g_carbs REAL, per100g_fiber REAL,
  has_per_unit INTEGER NOT NULL DEFAULT 0,
  per_unit_calories REAL, per_unit_protein REAL, per_unit_fat REAL, per_unit_carbs REAL, per_unit_fiber REAL,
  has_nutrients INTEGER NOT NULL DEFAULT 0,
  nutrients_calories REAL, nutrients_protein REAL, nutrients_fat REAL, nutrients_carbs REAL, nutrients_fiber REAL,
  food_id TEXT, source TEXT NOT NULL CHECK (source IN ('usda','off','custom','web')),
  PRIMARY KEY (preset_id, position)
);

CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY CHECK (id = 1),
  base_protein REAL NOT NULL, base_fat REAL NOT NULL, base_carbs REAL NOT NULL, training_carbs REAL NOT NULL,
  fiber REAL NOT NULL, water_ounces REAL NOT NULL DEFAULT 96, alcohol_weekly REAL NOT NULL DEFAULT 7,
  workouts_weekly REAL NOT NULL DEFAULT 4, meditation_minutes REAL NOT NULL DEFAULT 10,
  calorie_buffer REAL NOT NULL DEFAULT 100, workout_plan TEXT, training_water REAL NOT NULL DEFAULT 32,
  dog_walks REAL NOT NULL DEFAULT 2, walk_miles REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1),
  usda_api_key TEXT NOT NULL DEFAULT '', lm_studio_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:1234',
  lm_studio_token TEXT NOT NULL DEFAULT '', research_model TEXT NOT NULL DEFAULT '', auto_lookup INTEGER NOT NULL DEFAULT 1,
  app_icon TEXT NOT NULL DEFAULT 'ring', charts TEXT, workout_kinds TEXT);

-- No row for a date means a rest day (see getDayType): only the days you
-- tick as training days get a row.
CREATE TABLE IF NOT EXISTS day_types (date TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('training','rest')));

CREATE TABLE IF NOT EXISTS water_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, ounces REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_water_logs_date ON water_logs(date);

CREATE TABLE IF NOT EXISTS alcohol_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alcohol_logs_date ON alcohol_logs(date);

CREATE TABLE IF NOT EXISTS workout_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, kind TEXT NOT NULL, minutes REAL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_logs_date ON workout_logs(date);

-- A week's own workout plan, when it differs from the default (goals.workout_plan).
CREATE TABLE IF NOT EXISTS workout_plans (week_start TEXT PRIMARY KEY, plan TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS meditation_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, minutes REAL NOT NULL, note TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_meditation_logs_date ON meditation_logs(date);

CREATE TABLE IF NOT EXISTS dog_walk_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, miles REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dog_walk_logs_date ON dog_walk_logs(date);

-- Readings from the scale (via Apple Health). One per kind and moment, so re-sending the same week is harmless.
CREATE TABLE IF NOT EXISTS body_measurements (
  metric TEXT NOT NULL, measured_at INTEGER NOT NULL, date TEXT NOT NULL, value REAL NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (metric, measured_at)
);
CREATE INDEX IF NOT EXISTS idx_body_measurements_date ON body_measurements(date);

CREATE TABLE IF NOT EXISTS lookup_cache (
  key TEXT PRIMARY KEY, at INTEGER NOT NULL, result TEXT NOT NULL
);

-- Notes on a week or month, written by the local model; fingerprint is what they were written from.
CREATE TABLE IF NOT EXISTS range_notes (
  key TEXT PRIMARY KEY, start_date TEXT NOT NULL, end_date TEXT NOT NULL, fingerprint TEXT NOT NULL,
  text TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL
);
`

/**
 * Single-process, single-user: WAL buys nothing here and would leave
 * permanent -wal/-shm sidecar files needing the same 0600 treatment as the
 * main file forever. Plain rollback-journal leaves only a transient
 * -journal file, gone once a transaction commits.
 */
export function ensureSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 2000')
  db.exec(SCHEMA)
  migrateSchema(db)
}

/**
 * In-place upgrades for a database created before a given schema addition,
 * gated by SQLite's own PRAGMA user_version so this only does work once.
 * CREATE TABLE IF NOT EXISTS above already handles a brand-new database;
 * this handles the same addition for one that existed before it, since
 * SQLite has no ADD COLUMN IF NOT EXISTS.
 */
function migrateSchema(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version < 1) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'water_ounces')) {
      db.exec(`ALTER TABLE goals ADD COLUMN water_ounces REAL NOT NULL DEFAULT ${DEFAULT_WATER_OUNCES}`)
    }
    db.exec('PRAGMA user_version = 1')
  }
  if (version < 2) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'alcohol_weekly')) {
      db.exec(`ALTER TABLE goals ADD COLUMN alcohol_weekly REAL NOT NULL DEFAULT ${DEFAULT_ALCOHOL_WEEKLY}`)
    }
    db.exec('PRAGMA user_version = 2')
  }
  if (version < 3) {
    // Version 3 once added per-day-type range columns to goals; version 4
    // replaced them, so a database coming through here only needs the
    // day_types table. (A database already at 3 keeps those columns, unused.)
    db.exec("CREATE TABLE IF NOT EXISTS day_types (date TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('training','rest')))")
    db.exec('PRAGMA user_version = 3')
  }
  if (version < 4) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    // One base set of macros plus a training-day carb bump, replacing the
    // per-day-type ranges (whose columns stay behind, unused, like the flat
    // ones before them: SQLite can't drop a column without a rebuild).
    const defaults: [string, number][] = [
      ['base_protein', DEFAULT_GOALS.protein], ['base_fat', DEFAULT_GOALS.fat],
      ['base_carbs', DEFAULT_GOALS.carbs], ['training_carbs', DEFAULT_GOALS.trainingCarbs],
    ]
    for (const [column, value] of defaults) {
      if (!has(column)) db.exec(`ALTER TABLE goals ADD COLUMN ${column} REAL NOT NULL DEFAULT ${value}`)
    }
    db.exec('PRAGMA user_version = 4')
  }
  if (version < 5) {
    // Workout and meditation goals; their log tables come from the schema above.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    if (!has('workouts_weekly')) db.exec(`ALTER TABLE goals ADD COLUMN workouts_weekly REAL NOT NULL DEFAULT 6`)
    if (!has('meditation_minutes')) db.exec(`ALTER TABLE goals ADD COLUMN meditation_minutes REAL NOT NULL DEFAULT ${DEFAULT_GOALS.meditationMinutes}`)
    db.exec('PRAGMA user_version = 5')
  }
  if (version < 6) {
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'calorie_buffer')) {
      db.exec(`ALTER TABLE goals ADD COLUMN calorie_buffer REAL NOT NULL DEFAULT ${DEFAULT_GOALS.calorieBuffer}`)
    }
    db.exec('PRAGMA user_version = 6')
  }
  if (version < 7) {
    // A plan per workout kind replaces the one weekly count (workouts_weekly stays behind, unused).
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'workout_plan')) db.exec('ALTER TABLE goals ADD COLUMN workout_plan TEXT')
    db.exec('CREATE TABLE IF NOT EXISTS workout_plans (week_start TEXT PRIMARY KEY, plan TEXT NOT NULL)')
    db.exec('PRAGMA user_version = 7')
  }
  if (version < 8) {
    // Weeks now start on Sunday: a week's own plan, stored by its Monday, moves to the day before.
    db.exec("UPDATE workout_plans SET week_start = date(week_start, '-1 day') WHERE strftime('%w', week_start) = '1'")
    db.exec('PRAGMA user_version = 8')
  }
  if (version < 9) {
    // The app icon, picked in Settings (see APP_ICONS).
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'app_icon')) db.exec("ALTER TABLE settings ADD COLUMN app_icon TEXT NOT NULL DEFAULT 'ring'")
    db.exec('PRAGMA user_version = 9')
  }
  if (version < 10) {
    // Which daily charts Week and Month show; null means the default set.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'charts')) db.exec('ALTER TABLE settings ADD COLUMN charts TEXT')
    db.exec('PRAGMA user_version = 10')
  }
  if (version < 11) {
    // The extra water a training day asks for.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'training_water')) {
      db.exec(`ALTER TABLE goals ADD COLUMN training_water REAL NOT NULL DEFAULT ${DEFAULT_GOALS.trainingWater}`)
    }
    db.exec('PRAGMA user_version = 11')
  }
  if (version < 12) {
    // Dog walks: how many a day, and how far one is. Their log table comes from the schema above.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    const has = (name: string): boolean => cols.some((c) => c.name === name)
    if (!has('dog_walks')) db.exec(`ALTER TABLE goals ADD COLUMN dog_walks REAL NOT NULL DEFAULT ${DEFAULT_GOALS.dogWalks}`)
    if (!has('walk_miles')) db.exec(`ALTER TABLE goals ADD COLUMN walk_miles REAL NOT NULL DEFAULT ${DEFAULT_GOALS.walkMiles}`)
    db.exec('PRAGMA user_version = 12')
  }
  if (version < 13) {
    // The workout activities, set up in Settings; null means the built-in six.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'workout_kinds')) db.exec('ALTER TABLE settings ADD COLUMN workout_kinds TEXT')
    db.exec('PRAGMA user_version = 13')
  }
  if (version < 14) {
    // The model that writes the week and month notes.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'notes_model')) db.exec("ALTER TABLE settings ADD COLUMN notes_model TEXT NOT NULL DEFAULT ''")
    db.exec('PRAGMA user_version = 14')
  }
  if (version < 15) {
    // The vision model that reads a photographed nutrition label.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'label_model')) db.exec("ALTER TABLE settings ADD COLUMN label_model TEXT NOT NULL DEFAULT ''")
    db.exec('PRAGMA user_version = 15')
  }
  if (version < 16) {
    // The model to use for everything whenever LM Studio has it loaded.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'preferred_model')) db.exec("ALTER TABLE settings ADD COLUMN preferred_model TEXT NOT NULL DEFAULT ''")
    db.exec('PRAGMA user_version = 16')
  }
}
