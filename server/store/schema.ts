import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_GOALS } from '../../src/lib/nutrition.ts'

// ---------------------------------------------------------------------------
// Storage paths and schema
// ---------------------------------------------------------------------------

/** Two 32oz bottles and a mug of tea, every day. */
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
  base_protein REAL NOT NULL, base_fat REAL NOT NULL, base_carbs REAL NOT NULL DEFAULT 0, training_carbs REAL NOT NULL DEFAULT 0,
  fiber REAL NOT NULL, water_ounces REAL NOT NULL DEFAULT 72, alcohol_weekly REAL NOT NULL DEFAULT 7,
  workouts_weekly REAL NOT NULL DEFAULT 4, meditation_minutes REAL NOT NULL DEFAULT 10,
  calorie_buffer REAL NOT NULL DEFAULT 100, workout_plan TEXT, training_water REAL NOT NULL DEFAULT 32,
  dog_walks REAL NOT NULL DEFAULT 2, walk_miles REAL NOT NULL DEFAULT 1, max_calories REAL NOT NULL DEFAULT 1800, min_calories REAL NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1),
  usda_api_key TEXT NOT NULL DEFAULT '', lm_studio_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:1234',
  lm_studio_token TEXT NOT NULL DEFAULT '', research_model TEXT NOT NULL DEFAULT '', auto_lookup INTEGER NOT NULL DEFAULT 1,
  app_icon TEXT NOT NULL DEFAULT 'ring', charts TEXT, workout_kinds TEXT);

-- Training days, as they were once ticked; nothing reads it since goals stopped varying by day (version 22).
CREATE TABLE IF NOT EXISTS day_types (date TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('training','rest')));

CREATE TABLE IF NOT EXISTS water_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, ounces REAL NOT NULL, created_at INTEGER NOT NULL,
  drink TEXT NOT NULL DEFAULT 'water' CHECK (drink IN ('water','tea'))
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

-- Training schemas (docs/training-schema.md): the plan as JSON, and which one is being followed.
CREATE TABLE IF NOT EXISTS training_schemas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','done')), based_on TEXT,
  repeats TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, activated_at INTEGER
);
-- PRs, which every schema's percentages are taken of; kept across schemas, with their history.
CREATE TABLE IF NOT EXISTS lifts (id TEXT PRIMARY KEY, name TEXT NOT NULL, increment REAL NOT NULL, pr REAL, pr_date TEXT);
CREATE TABLE IF NOT EXISTS lift_prs (lift_id TEXT NOT NULL, date TEXT NOT NULL, weight REAL NOT NULL, created_at INTEGER NOT NULL);
-- One row per planned set (or check, minutes or WOD item at set 0) that was done.
CREATE TABLE IF NOT EXISTS set_logs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, schema_id TEXT NOT NULL, item_id TEXT NOT NULL, set_index INTEGER NOT NULL,
  reps REAL, weight REAL, seconds REAL, created_at INTEGER NOT NULL, UNIQUE (date, item_id, set_index)
);
CREATE INDEX IF NOT EXISTS idx_set_logs_schema ON set_logs(schema_id, date);
-- A session's link to the workout log it filled in, and the WOD picked for it.
CREATE TABLE IF NOT EXISTS session_logs (
  date TEXT NOT NULL, schema_id TEXT NOT NULL, session_id TEXT NOT NULL, workout_log_id TEXT, wod_id TEXT,
  PRIMARY KEY (date, session_id)
);

-- The coach's one-off changes, laid over a schema for a range of dates; each from the chat message that proposed it.
CREATE TABLE IF NOT EXISTS schema_overrides (
  id TEXT PRIMARY KEY, schema_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL,
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, message_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schema_overrides ON schema_overrides(schema_id, from_date);
-- A schema's body before each lasting change to it, newest last; undo puts the last one back.
CREATE TABLE IF NOT EXISTS schema_revisions (
  id TEXT PRIMARY KEY, schema_id TEXT NOT NULL, body TEXT NOT NULL, reason TEXT NOT NULL, message_id TEXT, created_at INTEGER NOT NULL
);
-- Talking to the coach about a schema: what was said, and the change proposed with it.
CREATE TABLE IF NOT EXISTS training_chat (
  id TEXT PRIMARY KEY, schema_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('user','assistant')), text TEXT NOT NULL,
  proposal TEXT, status TEXT, note TEXT, created_at INTEGER NOT NULL, stats TEXT, image TEXT
);
CREATE INDEX IF NOT EXISTS idx_training_chat ON training_chat(schema_id, created_at);

-- A day's record before the coach changed it (a workout removed, a session ticked or unticked), to undo to.
CREATE TABLE IF NOT EXISTS record_snapshots (message_id TEXT NOT NULL, date TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (message_id, date));

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
      ['base_carbs', 160], ['training_carbs', 35],
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
      db.exec('ALTER TABLE goals ADD COLUMN calorie_buffer REAL NOT NULL DEFAULT 100')
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
    // The extra water a training day asked for (no longer read: the water goal is the same every day).
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'training_water')) {
      db.exec(`ALTER TABLE goals ADD COLUMN training_water REAL NOT NULL DEFAULT 32`)
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
  if (version < 17) {
    // Mugs of tea count toward the water goal, logged apart from plain water.
    const cols = db.prepare('PRAGMA table_info(water_logs)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'drink')) {
      db.exec("ALTER TABLE water_logs ADD COLUMN drink TEXT NOT NULL DEFAULT 'water' CHECK (drink IN ('water','tea'))")
    }
    db.exec('PRAGMA user_version = 17')
  }
  if (version < 18) {
    // Training schemas: their tables come from the schema above; the gear on hand and the model that plans are settings.
    const cols = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'equipment')) db.exec('ALTER TABLE settings ADD COLUMN equipment TEXT')
    if (!cols.some((c) => c.name === 'training_model')) db.exec("ALTER TABLE settings ADD COLUMN training_model TEXT NOT NULL DEFAULT ''")
    db.exec('PRAGMA user_version = 18')
  }
  if (version < 19) {
    // The coach: its tables come from the schema above; its model is a setting, and a draft can be a rewrite of the active schema.
    const settings = db.prepare('PRAGMA table_info(settings)').all() as { name: string }[]
    if (!settings.some((c) => c.name === 'plan_chat_model')) db.exec("ALTER TABLE settings ADD COLUMN plan_chat_model TEXT NOT NULL DEFAULT ''")
    const schemas = db.prepare('PRAGMA table_info(training_schemas)').all() as { name: string }[]
    if (!schemas.some((c) => c.name === 'rewrite')) db.exec('ALTER TABLE training_schemas ADD COLUMN rewrite TEXT')
    db.exec('PRAGMA user_version = 19')
  }
  if (version < 20) {
    // How each coach reply was made: model, time, tokens.
    const cols = db.prepare('PRAGMA table_info(training_chat)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'stats')) db.exec('ALTER TABLE training_chat ADD COLUMN stats TEXT')
    db.exec('PRAGMA user_version = 20')
  }
  if (version < 21) {
    // A screenshot sent to the coach, as the data URL it came in.
    const cols = db.prepare('PRAGMA table_info(training_chat)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'image')) db.exec('ALTER TABLE training_chat ADD COLUMN image TEXT')
    db.exec('PRAGMA user_version = 21')
  }
  if (version < 22) {
    // Goals became floors (protein, fat, fiber) and a calorie cap, the same every day. The cap starts
    // where a rest day's was: what the macros added up to, plus the buffer. Carbs, the training-day
    // carbs, the buffer and day_types stay behind, unused.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'max_calories')) {
      db.exec('ALTER TABLE goals ADD COLUMN max_calories REAL NOT NULL DEFAULT 1800')
      if (cols.some((c) => c.name === 'base_carbs') && cols.some((c) => c.name === 'calorie_buffer')) {
        db.exec('UPDATE goals SET max_calories = ROUND(base_protein * 4 + base_carbs * 4 + base_fat * 9 + calorie_buffer)')
      }
    }
    db.exec('PRAGMA user_version = 22')
  }
  if (version < 23) {
    // Calories became a range again: a minimum beside the cap, 0 (a cap alone) until one is set.
    const cols = db.prepare('PRAGMA table_info(goals)').all() as { name: string }[]
    if (!cols.some((c) => c.name === 'min_calories')) db.exec('ALTER TABLE goals ADD COLUMN min_calories REAL NOT NULL DEFAULT 0')
    db.exec('PRAGMA user_version = 23')
  }
}
