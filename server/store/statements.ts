import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { LOOKUP_MAX } from '../research.ts'
import { GOALS_ASSIGNMENTS } from './rows.ts'

// ---------------------------------------------------------------------------
// Prepared statements
// ---------------------------------------------------------------------------

export interface Stmts {
  selectEntry: StatementSync
  selectEntriesByDate: StatementSync
  selectEntriesBetween: StatementSync
  selectRecentPerFood: StatementSync
  selectAllFoodServings: StatementSync
  selectAllFoodSources: StatementSync
  selectAllPresetItems: StatementSync
  selectAllLookups: StatementSync
  updateLookupResult: StatementSync
  insertEntry: StatementSync
  updateEntry: StatementSync
  deleteEntry: StatementSync
  selectAllFoods: StatementSync
  selectFood: StatementSync
  selectFoodServings: StatementSync
  selectFoodSources: StatementSync
  upsertFood: StatementSync
  deleteFoodServings: StatementSync
  deleteFoodSources: StatementSync
  insertFoodServing: StatementSync
  insertFoodSource: StatementSync
  deleteFood: StatementSync
  selectAllPresets: StatementSync
  selectPresetById: StatementSync
  selectPresetItems: StatementSync
  upsertPreset: StatementSync
  deletePresetItems: StatementSync
  insertPresetItem: StatementSync
  deletePreset: StatementSync
  selectGoals: StatementSync
  updateGoals: StatementSync
  selectDayType: StatementSync
  selectDayTypesBetween: StatementSync
  upsertDayType: StatementSync
  selectSettings: StatementSync
  updateSettings: StatementSync
  selectWaterByDate: StatementSync
  selectWaterBetween: StatementSync
  insertWater: StatementSync
  deleteWater: StatementSync
  selectAlcoholByDate: StatementSync
  selectAlcoholBetween: StatementSync
  insertAlcohol: StatementSync
  deleteAlcohol: StatementSync
  selectWorkoutsByDate: StatementSync
  selectWorkoutsBetween: StatementSync
  insertWorkout: StatementSync
  deleteWorkout: StatementSync
  selectWeekPlan: StatementSync
  upsertWeekPlan: StatementSync
  deleteWeekPlan: StatementSync
  selectMeditationByDate: StatementSync
  selectMeditationBetween: StatementSync
  insertMeditation: StatementSync
  deleteMeditation: StatementSync
  selectDogWalksByDate: StatementSync
  selectDogWalksBetween: StatementSync
  insertDogWalk: StatementSync
  deleteDogWalk: StatementSync
  insertBody: StatementSync
  selectBodyUpTo: StatementSync
  selectBodyBetween: StatementSync
  selectLookup: StatementSync
  upsertLookup: StatementSync
  selectNotes: StatementSync
  upsertNotes: StatementSync
  pruneLookups: StatementSync
}

export function prepareStatements(db: DatabaseSync): Stmts {
  return {
    selectEntry: db.prepare('SELECT * FROM entries WHERE id = ?'),
    selectEntriesByDate: db.prepare('SELECT * FROM entries WHERE date = ?'),
    selectEntriesBetween: db.prepare('SELECT * FROM entries WHERE date >= ? AND date <= ?'),
    // The latest entry of each distinct food that can be logged again (it
    // has a per-100g or per-serving basis) -- deduplicated in SQL so this
    // never reads the whole log, however long it gets.
    selectRecentPerFood: db.prepare(`
      SELECT * FROM (
        SELECT *, rowid AS rid, ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(food_id, ''), name || '|' || COALESCE(brand, ''))
          ORDER BY created_at DESC, rowid DESC
        ) AS rn
        FROM entries
        WHERE has_per100g = 1 OR (has_per_unit = 1 AND amount_quantity IS NOT NULL)
      ) WHERE rn = 1 ORDER BY created_at DESC, rid DESC LIMIT ?`),
    selectAllFoodServings: db.prepare('SELECT * FROM food_servings ORDER BY food_id, position'),
    selectAllFoodSources: db.prepare('SELECT * FROM food_sources ORDER BY food_id, position'),
    selectAllPresetItems: db.prepare('SELECT * FROM meal_preset_items ORDER BY preset_id, position'),
    selectAllLookups: db.prepare('SELECT key, result FROM lookup_cache'),
    updateLookupResult: db.prepare('UPDATE lookup_cache SET result = ? WHERE key = ?'),
    insertEntry: db.prepare(
      `INSERT INTO entries (id,date,meal,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        food_id,source,created_at) VALUES (${Array(29).fill('?').join(',')})`,
    ),
    updateEntry: db.prepare(
      `UPDATE entries SET date=?,meal=?,name=?,brand=?,grams=?,amount_quantity=?,amount_unit=?,amount_unit_grams=?,
        nutrients_calories=?,nutrients_protein=?,nutrients_fat=?,nutrients_carbs=?,nutrients_fiber=?,
        has_per100g=?,per100g_calories=?,per100g_protein=?,per100g_fat=?,per100g_carbs=?,per100g_fiber=?,
        has_per_unit=?,per_unit_calories=?,per_unit_protein=?,per_unit_fat=?,per_unit_carbs=?,per_unit_fiber=?,
        food_id=?,source=?,created_at=? WHERE id=?`,
    ),
    deleteEntry: db.prepare('DELETE FROM entries WHERE id = ?'),
    selectAllFoods: db.prepare('SELECT * FROM foods'),
    selectFood: db.prepare('SELECT * FROM foods WHERE id = ?'),
    selectFoodServings: db.prepare('SELECT * FROM food_servings WHERE food_id = ? ORDER BY position'),
    selectFoodSources: db.prepare('SELECT * FROM food_sources WHERE food_id = ? ORDER BY position'),
    upsertFood: db.prepare(
      `INSERT INTO foods (id,name,brand,source,source_id,has_per100g,per100g_calories,per100g_protein,per100g_fat,
        per100g_carbs,per100g_fiber,has_per_serving,per_serving_label,per_serving_grams,
        per_serving_nutrients_calories,per_serving_nutrients_protein,per_serving_nutrients_fat,
        per_serving_nutrients_carbs,per_serving_nutrients_fiber,note) VALUES (${Array(20).fill('?').join(',')})
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, source=excluded.source,
        source_id=excluded.source_id, has_per100g=excluded.has_per100g,
        per100g_calories=excluded.per100g_calories, per100g_protein=excluded.per100g_protein,
        per100g_fat=excluded.per100g_fat, per100g_carbs=excluded.per100g_carbs, per100g_fiber=excluded.per100g_fiber,
        has_per_serving=excluded.has_per_serving, per_serving_label=excluded.per_serving_label,
        per_serving_grams=excluded.per_serving_grams,
        per_serving_nutrients_calories=excluded.per_serving_nutrients_calories,
        per_serving_nutrients_protein=excluded.per_serving_nutrients_protein,
        per_serving_nutrients_fat=excluded.per_serving_nutrients_fat,
        per_serving_nutrients_carbs=excluded.per_serving_nutrients_carbs,
        per_serving_nutrients_fiber=excluded.per_serving_nutrients_fiber, note=excluded.note`,
    ),
    deleteFoodServings: db.prepare('DELETE FROM food_servings WHERE food_id = ?'),
    deleteFoodSources: db.prepare('DELETE FROM food_sources WHERE food_id = ?'),
    insertFoodServing: db.prepare('INSERT INTO food_servings (food_id,position,label,grams) VALUES (?,?,?,?)'),
    insertFoodSource: db.prepare('INSERT INTO food_sources (food_id,position,title,url) VALUES (?,?,?,?)'),
    deleteFood: db.prepare('DELETE FROM foods WHERE id = ?'),
    selectAllPresets: db.prepare('SELECT * FROM meal_presets'),
    selectPresetById: db.prepare('SELECT * FROM meal_presets WHERE id = ?'),
    selectPresetItems: db.prepare('SELECT * FROM meal_preset_items WHERE preset_id = ? ORDER BY position'),
    upsertPreset: db.prepare(
      `INSERT INTO meal_presets (id,name,created_at) VALUES (?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, created_at=excluded.created_at`,
    ),
    deletePresetItems: db.prepare('DELETE FROM meal_preset_items WHERE preset_id = ?'),
    insertPresetItem: db.prepare(
      `INSERT INTO meal_preset_items (preset_id,position,name,brand,grams,amount_quantity,amount_unit,amount_unit_grams,
        has_per100g,per100g_calories,per100g_protein,per100g_fat,per100g_carbs,per100g_fiber,
        has_per_unit,per_unit_calories,per_unit_protein,per_unit_fat,per_unit_carbs,per_unit_fiber,
        has_nutrients,nutrients_calories,nutrients_protein,nutrients_fat,nutrients_carbs,nutrients_fiber,
        food_id,source) VALUES (${Array(28).fill('?').join(',')})`,
    ),
    deletePreset: db.prepare('DELETE FROM meal_presets WHERE id = ?'),
    selectGoals: db.prepare('SELECT * FROM goals WHERE id = 1'),
    updateGoals: db.prepare(`UPDATE goals SET ${GOALS_ASSIGNMENTS} WHERE id=1`),
    selectDayType: db.prepare('SELECT * FROM day_types WHERE date = ?'),
    selectDayTypesBetween: db.prepare('SELECT * FROM day_types WHERE date >= ? AND date <= ?'),
    upsertDayType: db.prepare(
      'INSERT INTO day_types (date, type) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET type=excluded.type',
    ),
    selectSettings: db.prepare('SELECT * FROM settings WHERE id = 1'),
    updateSettings: db.prepare(
      'UPDATE settings SET usda_api_key=?, lm_studio_url=?, lm_studio_token=?, research_model=?, auto_lookup=?, app_icon=?, charts=?, workout_kinds=?, notes_model=?, label_model=?, preferred_model=?, equipment=?, training_model=?, plan_chat_model=? WHERE id=1',
    ),
    selectWaterByDate: db.prepare('SELECT * FROM water_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
    selectWaterBetween: db.prepare('SELECT * FROM water_logs WHERE date >= ? AND date <= ?'),
    insertWater: db.prepare('INSERT INTO water_logs (id,date,ounces,drink,created_at) VALUES (?,?,?,?,?)'),
    deleteWater: db.prepare('DELETE FROM water_logs WHERE id = ?'),
    selectAlcoholByDate: db.prepare('SELECT * FROM alcohol_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
    selectAlcoholBetween: db.prepare('SELECT * FROM alcohol_logs WHERE date >= ? AND date <= ?'),
    insertAlcohol: db.prepare('INSERT INTO alcohol_logs (id,date,kind,created_at) VALUES (?,?,?,?)'),
    deleteAlcohol: db.prepare('DELETE FROM alcohol_logs WHERE id = ?'),
    selectWorkoutsByDate: db.prepare('SELECT * FROM workout_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
    selectWorkoutsBetween: db.prepare('SELECT * FROM workout_logs WHERE date >= ? AND date <= ?'),
    insertWorkout: db.prepare('INSERT INTO workout_logs (id,date,kind,minutes,note,created_at) VALUES (?,?,?,?,?,?)'),
    deleteWorkout: db.prepare('DELETE FROM workout_logs WHERE id = ?'),
    selectWeekPlan: db.prepare('SELECT plan FROM workout_plans WHERE week_start = ?'),
    upsertWeekPlan: db.prepare('INSERT INTO workout_plans (week_start, plan) VALUES (?, ?) ON CONFLICT(week_start) DO UPDATE SET plan=excluded.plan'),
    deleteWeekPlan: db.prepare('DELETE FROM workout_plans WHERE week_start = ?'),
    selectMeditationByDate: db.prepare('SELECT * FROM meditation_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
    selectMeditationBetween: db.prepare('SELECT * FROM meditation_logs WHERE date >= ? AND date <= ?'),
    insertMeditation: db.prepare('INSERT INTO meditation_logs (id,date,minutes,note,created_at) VALUES (?,?,?,?,?)'),
    deleteMeditation: db.prepare('DELETE FROM meditation_logs WHERE id = ?'),
    selectDogWalksByDate: db.prepare('SELECT * FROM dog_walk_logs WHERE date = ? ORDER BY created_at DESC, rowid DESC'),
    selectDogWalksBetween: db.prepare('SELECT * FROM dog_walk_logs WHERE date >= ? AND date <= ?'),
    insertDogWalk: db.prepare('INSERT INTO dog_walk_logs (id,date,miles,created_at) VALUES (?,?,?,?)'),
    deleteDogWalk: db.prepare('DELETE FROM dog_walk_logs WHERE id = ?'),
    insertBody: db.prepare('INSERT OR IGNORE INTO body_measurements (metric, measured_at, date, value, created_at) VALUES (?,?,?,?,?)'),
    // The two latest readings of a kind on or before a day: the current one, and the one it changed from.
    selectBodyUpTo: db.prepare('SELECT * FROM body_measurements WHERE metric = ? AND date <= ? ORDER BY measured_at DESC LIMIT 2'),
    selectBodyBetween: db.prepare('SELECT * FROM body_measurements WHERE date >= ? AND date <= ? ORDER BY measured_at'),
    selectNotes: db.prepare('SELECT start_date AS start, end_date AS end, fingerprint, text, model, at FROM range_notes WHERE key = ?'),
    upsertNotes: db.prepare(
      'INSERT INTO range_notes (key,start_date,end_date,fingerprint,text,model,at) VALUES (?,?,?,?,?,?,?) '
      + 'ON CONFLICT(key) DO UPDATE SET fingerprint=excluded.fingerprint, text=excluded.text, model=excluded.model, at=excluded.at',
    ),
    selectLookup: db.prepare('SELECT at, result FROM lookup_cache WHERE key = ?'),
    upsertLookup: db.prepare(
      'INSERT INTO lookup_cache (key,at,result) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET at=excluded.at, result=excluded.result',
    ),
    pruneLookups: db.prepare(
      `DELETE FROM lookup_cache WHERE at < ? OR key NOT IN (SELECT key FROM lookup_cache ORDER BY at DESC LIMIT ${LOOKUP_MAX})`,
    ),
  }
}
