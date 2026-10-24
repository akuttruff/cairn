import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { DEFAULT_CHARTS, DEFAULT_WORKOUT_KINDS } from '../../src/types.ts'
import type { Entry, Food, Goals, MealPreset, Settings } from '../../src/types.ts'
import { DEFAULT_GOALS } from '../../src/lib/nutrition.ts'
import { ensureSchema } from './schema.ts'
import type { locate } from './schema.ts'
import { entryColumnParams, foodColumnParams, GOALS_COLUMNS, GOALS_PLACEHOLDERS, goalsParams, presetItemColumnParams } from './rows.ts'

// ---------------------------------------------------------------------------
// Migration from JSON
// ---------------------------------------------------------------------------

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

interface LegacyLog {
  entries: Record<string, Entry[]>
  foods: Food[]
  mealPresets: MealPreset[]
  goals: Goals
}

/**
 * One-time import from the old log.json/settings.json, the first time this
 * data dir is opened after the SQLite switch. Builds the database at a temp
 * path and only renames it into place on success, so a crash mid-import
 * never leaves a half-built file at the real path -- which would otherwise
 * stop the migration from ever being retried.
 */
export function migrateFromJson(paths: ReturnType<typeof locate>): void {
  // Goals predate this file's shape by years (calories/protein/fat/carbs as
  // flat numbers, no training/rest split) -- nothing left to carry over from
  // it, so a legacy log's own goals are never read, only the fresher fields.
  const raw = readJson<Partial<Omit<LegacyLog, 'goals'>>>(paths.legacyLog, {})
  const log: LegacyLog = {
    entries: raw.entries ?? {},
    foods: raw.foods ?? [],
    mealPresets: raw.mealPresets ?? [],
    goals: DEFAULT_GOALS,
  }
  const rawSettings = readJson<Partial<Settings>>(paths.legacySettings, {})
  const settings: Settings = {
    usdaApiKey: typeof rawSettings.usdaApiKey === 'string' ? rawSettings.usdaApiKey : '',
    lmStudioUrl: typeof rawSettings.lmStudioUrl === 'string' && rawSettings.lmStudioUrl ? rawSettings.lmStudioUrl : 'http://127.0.0.1:1234',
    lmStudioToken: typeof rawSettings.lmStudioToken === 'string' ? rawSettings.lmStudioToken : '',
    researchModel: typeof rawSettings.researchModel === 'string' ? rawSettings.researchModel : '',
    notesModel: '',
    labelModel: '',
    preferredModel: '',
    autoLookup: typeof rawSettings.autoLookup === 'boolean' ? rawSettings.autoLookup : true,
    appIcon: 'ring',
    charts: [...DEFAULT_CHARTS],
    workoutKinds: DEFAULT_WORKOUT_KINDS.map((k) => ({ ...k })),
  }

  const tmp = `${paths.sqlite}.${process.pid}.tmp`
  try { fs.rmSync(tmp, { force: true }) } catch { /* nothing there yet */ }

  const db = new DatabaseSync(tmp)
  try {
    ensureSchema(db)
    const insertEntry = db.prepare(
      `INSERT INTO entries (id,date,meal,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        food_id,source,created_at) VALUES (${Array(29).fill('?').join(',')})`,
    )
    const insertFood = db.prepare(
      `INSERT INTO foods (id,name,brand,source,source_id,has_per100g,per100g_calories,per100g_protein,per100g_fat,
        per100g_carbs,per100g_fiber,has_per_serving,per_serving_label,per_serving_grams,
        per_serving_nutrients_calories,per_serving_nutrients_protein,per_serving_nutrients_fat,
        per_serving_nutrients_carbs,per_serving_nutrients_fiber,note) VALUES (${Array(20).fill('?').join(',')})`,
    )
    const insertServing = db.prepare('INSERT INTO food_servings (food_id,position,label,grams) VALUES (?,?,?,?)')
    const insertSource = db.prepare('INSERT INTO food_sources (food_id,position,title,url) VALUES (?,?,?,?)')
    const insertPreset = db.prepare('INSERT INTO meal_presets (id,name,created_at) VALUES (?,?,?)')
    const insertItem = db.prepare(
      `INSERT INTO meal_preset_items (preset_id,position,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        has_nutrients,nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        food_id,source) VALUES (${Array(28).fill('?').join(',')})`,
    )

    db.exec('BEGIN')
    for (const list of Object.values(log.entries)) {
      for (const e of list) {
        insertEntry.run(e.id, ...entryColumnParams(e))
      }
    }
    for (const f of log.foods) {
      insertFood.run(f.id, ...foodColumnParams(f))
      ;(f.servings ?? []).forEach((s, i) => insertServing.run(f.id, i, s.label, s.grams))
      ;(f.sources ?? []).forEach((s, i) => insertSource.run(f.id, i, s.title, s.url))
    }
    for (const p of log.mealPresets) {
      insertPreset.run(p.id, p.name, p.createdAt)
      p.items.forEach((item, i) => insertItem.run(p.id, i, ...presetItemColumnParams(item)))
    }
    db.prepare(`INSERT INTO goals (id,${GOALS_COLUMNS}) VALUES (1,${GOALS_PLACEHOLDERS})`)
      .run(...goalsParams(log.goals))
    db.prepare('INSERT INTO settings (id,usda_api_key,lm_studio_url,lm_studio_token,research_model,auto_lookup) VALUES (1,?,?,?,?,?)')
      .run(settings.usdaApiKey, settings.lmStudioUrl, settings.lmStudioToken, settings.researchModel, settings.autoLookup ? 1 : 0)
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* nothing to roll back */ }
    db.close()
    try { fs.rmSync(tmp, { force: true }) } catch { /* best effort */ }
    throw err
  }
  db.close()
  fs.renameSync(tmp, paths.sqlite)

  const entryCount = Object.values(log.entries).reduce((n, list) => n + list.length, 0)
  console.log(
    `[macros] migrated ${entryCount} entries, ${log.foods.length} foods, ${log.mealPresets.length} meal presets ` +
    'from log.json/settings.json to macros.sqlite',
  )
  for (const legacy of [paths.legacyLog, paths.legacySettings]) {
    if (fs.existsSync(legacy)) {
      try { fs.renameSync(legacy, `${legacy}.migrated`) } catch { /* best effort */ }
    }
  }
}
