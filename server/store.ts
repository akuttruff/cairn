import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { ALCOHOL_KINDS, APP_ICONS, BODY_METRICS, CHARTABLE, DRINKS, MEALS, NUTRIENTS } from '../src/types.ts'
import type {
  AlcoholKind, AlcoholLog, DaySummary, DayType, DayView, Drink, Entry, Food, Goals,
  Meal, MealPreset, MealPresetItem, MeditationLog, DogWalkLog, NewEntry, Nutrients, NutrientKey, PublicSettings,
  RangeView, Settings, WaterLog, WorkoutKind, WorkoutLog, WorkoutPlan,
} from '../src/types.ts'
import {
  addDays, alcoholCalories, blendGoals, DEFAULT_GOALS, daysBetween, isDateString, localDate, resolveGoals, round1, scale,
  scoreDays, scoreDogWalks, scoreMeditation, scoreWater, startOfWeek, streakThrough, sumDay, isTrainingKind,
} from '../src/lib/nutrition.ts'
import { LOOKUP_TTL_MS, normalizeQuery } from './research.ts'
import type { ResearchResult } from './research.ts'
import { gramsFor, multiply } from '../src/lib/units.ts'
import { ensureSchema, locate } from './store/schema.ts'
import { prepareStatements } from './store/statements.ts'
import type { Stmts } from './store/statements.ts'
import { migrateFromJson } from './store/legacy.ts'
import {
  cleanAmount, cleanBodySample, cleanDayType, cleanGoalNumber, cleanGrams, cleanMinutes, cleanName, cleanNote, cleanNutrients,
  cleanPerServing, cleanPlan, cleanSource, cleanSources, cleanWorkoutKinds, MAX_NAME, ValidationError,
} from './store/clean.ts'
import { cleanEquipment } from '../src/lib/training/schema.ts'
import { TrainingStore } from './store/training.ts'
import {
  countByKind, entryColumnParams, entryFromRow, foodColumnParams, foodFromRow, GOALS_COLUMNS, GOALS_PLACEHOLDERS,
  goalsFromRow, goalsParams, groupBy, meditationFromRow, dogWalkFromRow, parsePlan, planTotal, presetItemColumnParams, presetItemFromRow,
  settingsFromRow, workoutFromRow, zeroByKind,
} from './store/rows.ts'
import type {
  AlcoholLogRow, BodyRow, DayTypeRow, DogWalkLogRow, EntryRow, FoodRow, GoalsRow, MeditationLogRow, PresetItemRow, SettingsRow,
  WaterLogRow, WorkoutLogRow,
} from './store/rows.ts'

/**
 * Everything is kept on the machine running the server, so the log is shared
 * between devices and survives a phone clearing its storage.
 */

export { ValidationError }

const BACKUP_KEEP = 20

export interface StoreOptions {
  dir?: string
}

export class Store {
  readonly dataDir: string
  private paths: ReturnType<typeof locate>
  private db: DatabaseSync
  private stmts: Stmts
  /** Training schemas, PRs and logged sets (store/training.ts). */
  readonly training: TrainingStore
  /** The local date of the last snapshot this process made or found. */
  private backedUpOn = ''

  constructor(options: StoreOptions = {}) {
    this.paths = locate(options.dir)
    this.dataDir = this.paths.dataDir
    // 0700: this is a record of everything you eat.
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(this.dataDir, 0o700) } catch { /* not ours to change */ }

    const hasLegacyJson = fs.existsSync(this.paths.legacyLog) || fs.existsSync(this.paths.legacySettings)
    if (!fs.existsSync(this.paths.sqlite) && hasLegacyJson) {
      migrateFromJson(this.paths)
    }

    this.db = new DatabaseSync(this.paths.sqlite)
    ensureSchema(this.db)
    try { fs.chmodSync(this.paths.sqlite, 0o600) } catch { /* not ours to change */ }

    this.stmts = prepareStatements(this.db)
    this.training = new TrainingStore(this.db, {
      getSettings: () => this.getSettings(),
      addWorkout: (input) => this.addWorkout(input),
      deleteWorkout: (id) => this.deleteWorkout(id),
    })

    if (!this.stmts.selectGoals.get()) {
      this.db.prepare(`INSERT INTO goals (id,${GOALS_COLUMNS}) VALUES (1,${GOALS_PLACEHOLDERS})`)
        .run(...goalsParams(DEFAULT_GOALS))
    }
    if (!this.stmts.selectSettings.get()) {
      this.db.prepare('INSERT INTO settings (id,usda_api_key,lm_studio_url,lm_studio_token,research_model,auto_lookup) VALUES (1,?,?,?,?,?)')
        .run('', 'http://127.0.0.1:1234', '', '', 1)
    }

    this.importLegacyLookups()
    this.backupOncePerDay()
  }

  /**
   * A whole-file snapshot once per calendar day, not per write: every
   * mutating method here already touches only the row(s) it names by
   * primary key, so there's no "the whole document got swapped for
   * something smaller" failure mode left to guard against on every write --
   * only user error or a bad migration, which this covers.
   *
   * Taken on opening and again before the first write of each new day (the
   * API calls this), since the service runs for weeks between restarts.
   * Named by the local date, the day you would look for it under.
   */
  backupOncePerDay(now: Date = new Date()): void {
    const today = localDate(now)
    if (today === this.backedUpOn) return
    const backupDir = path.join(this.dataDir, 'backups')
    const file = path.join(backupDir, `macros.${today}.sqlite`)
    if (!fs.existsSync(file)) {
      fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
      // VACUUM INTO, not a file copy: a consistent snapshot even with a
      // write (or another process's) half-way through.
      this.db.prepare('VACUUM INTO ?').run(file)
      try { fs.chmodSync(file, 0o600) } catch { /* best effort */ }
      const kept = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sqlite')).sort()
      for (const old of kept.slice(0, Math.max(0, kept.length - BACKUP_KEEP))) {
        try { fs.unlinkSync(path.join(backupDir, old)) } catch { /* already gone */ }
      }
    }
    this.backedUpOn = today
  }

  // --- online lookup cache ---------------------------------------------------

  /**
   * Finished online lookups, each a couple of minutes of the model's time.
   * Kept in the database rather than in a per-process file so every running
   * copy of the app shares one cache instead of overwriting each other's.
   */
  getLookup(key: string): ResearchResult | undefined {
    const row = this.stmts.selectLookup.get(key) as unknown as { at: number; result: string } | undefined
    if (!row || Date.now() - row.at > LOOKUP_TTL_MS) return undefined
    try {
      return JSON.parse(row.result) as ResearchResult
    } catch {
      return undefined
    }
  }

  setLookup(key: string, result: ResearchResult): void {
    this.stmts.upsertLookup.run(key, Date.now(), JSON.stringify(result))
    this.stmts.pruneLookups.run(Date.now() - LOOKUP_TTL_MS)
  }

  /** One-time import of the old lookups.json cache, re-keyed the new way; renamed, not deleted. */
  private importLegacyLookups(): void {
    const file = path.join(this.dataDir, 'lookups.json')
    if (!fs.existsSync(file)) return
    let saved: Record<string, { at: number; result: ResearchResult }>
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return
    }
    this.db.exec('BEGIN')
    try {
      for (const [k, v] of Object.entries(saved)) {
        // Empty answers are no longer cached at all, and old ones shouldn't be replayed.
        if (Date.now() - v.at < LOOKUP_TTL_MS && v.result?.foods?.length) {
          this.stmts.upsertLookup.run(normalizeQuery(k), v.at, JSON.stringify(v.result))
        }
      }
      this.stmts.pruneLookups.run(Date.now() - LOOKUP_TTL_MS)
      this.db.exec('COMMIT')
    } catch {
      this.db.exec('ROLLBACK')
      return
    }
    try { fs.renameSync(file, `${file}.migrated`) } catch { /* best effort */ }
  }

  // --- days and entries ------------------------------------------------------

  getDay(date: string): DayView {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const rows = this.stmts.selectEntriesByDate.all(date) as unknown as EntryRow[]
    const entries = rows.map(entryFromRow)
      .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.createdAt - b.createdAt)
    const dayType = this.getDayType(date)
    const goals = resolveGoals(this.getGoals(), dayType)
    const water = this.getWater(date, goals.water)
    // The drinks' calories are reported (alcohol.calories) but kept out of
    // the day's totals and goals: food is judged on its own.
    const alcohol = this.getAlcohol(date, goals.alcoholWeekly)
    const workouts = this.getWorkouts(date)
    const meditation = this.getMeditation(date, goals.meditationMinutes)
    const dog = this.getDogWalks(date, goals.dogWalks, goals.walkMiles)
    const body = this.getBody(date)
    return { date, entries, dayType, goals, water, alcohol, workouts, meditation, dog, body, ...sumDay(entries) }
  }

  /**
   * A week or month at a glance: one summary per calendar day (including
   * empty ones, so a chart has a bar for every day) plus range-wide totals
   * and averages. See RangeView for how the averages are scoped.
   */
  getRange(start: string, end: string): RangeView {
    if (!isDateString(start)) throw new ValidationError('start must be YYYY-MM-DD')
    if (!isDateString(end)) throw new ValidationError('end must be YYYY-MM-DD')
    const span = daysBetween(start, end)
    if (span < 0) throw new ValidationError('end must not be before start')
    if (span >= 366) throw new ValidationError('range is too long (max 366 days)')

    const entriesByDate = groupBy(
      (this.stmts.selectEntriesBetween.all(start, end) as unknown as EntryRow[]).map(entryFromRow), 'date',
    )
    const waterByDate = groupBy(this.stmts.selectWaterBetween.all(start, end) as unknown as WaterLogRow[], 'date')
    const alcoholRows = this.stmts.selectAlcoholBetween.all(start, end) as unknown as AlcoholLogRow[]
    const alcoholByDate = groupBy(alcoholRows, 'date')
    const workoutRows = this.stmts.selectWorkoutsBetween.all(start, end) as unknown as WorkoutLogRow[]
    const workoutsByDate = groupBy(workoutRows, 'date')
    const meditationByDate = groupBy(this.stmts.selectMeditationBetween.all(start, end) as unknown as MeditationLogRow[], 'date')
    const dogByDate = groupBy(this.stmts.selectDogWalksBetween.all(start, end) as unknown as DogWalkLogRow[], 'date')
    const dayTypeByDate = new Map(
      (this.stmts.selectDayTypesBetween.all(start, end) as unknown as DayTypeRow[]).map((r) => [r.date, r.type]),
    )

    const goals = this.getGoals()
    const days: DaySummary[] = []
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const dayEntries = entriesByDate.get(date) ?? []
      const water = (waterByDate.get(date) ?? []).reduce((sum, r) => sum + r.ounces, 0)
      const dayType: DayType = dayTypeByDate.get(date) === 'training' ? 'training' : 'rest'
      const drinks = alcoholByDate.get(date) ?? []
      const sessions = workoutsByDate.get(date) ?? []
      days.push({
        date, entryCount: dayEntries.length, dayType, goals: resolveGoals(goals, dayType), water,
        alcohol: drinks.length,
        workouts: sessions.length,
        workoutMinutes: sessions.reduce((sum, r) => sum + (r.minutes ?? 0), 0),
        meditationMinutes: (meditationByDate.get(date) ?? []).reduce((sum, r) => sum + r.minutes, 0),
        dogWalks: (dogByDate.get(date) ?? []).length,
        dogMiles: round1((dogByDate.get(date) ?? []).reduce((sum, r) => sum + r.miles, 0)),
        ...sumDay(dayEntries),
      })
    }
    const dayTypes: Record<DayType, number> = {
      training: days.filter((d) => d.dayType === 'training').length,
      rest: days.filter((d) => d.dayType === 'rest').length,
    }

    const totalDays = days.length
    const loggedDays = days.filter((d) => d.entryCount > 0).length
    const totals = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
    for (const d of days) for (const key of NUTRIENTS) totals[key] += d.totals[key]
    for (const key of NUTRIENTS) totals[key] = round1(totals[key])

    // Averages and scores count finished days only: today is still being
    // logged (a half-eaten day would drag the calories down and count as a
    // protein miss), and the days still ahead haven't happened. Before any
    // day in the range has finished -- the 1st of a month -- today stands in.
    const today = localDate()
    const finished = days.filter((d) => d.date < today)
    const basis = finished.length ? finished : days.filter((d) => d.date === today)
    const per = (sum: number): number => (basis.length ? round1(sum / basis.length) : 0)
    const loggedBasis = basis.filter((d) => d.entryCount > 0)
    const averages = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
    if (loggedBasis.length) {
      for (const key of NUTRIENTS) averages[key] = round1(loggedBasis.reduce((s, d) => s + d.totals[key], 0) / loggedBasis.length)
    }

    const waterTotal = days.reduce((sum, d) => sum + d.water, 0)
    const alcoholTotal = days.reduce((sum, d) => sum + d.alcohol, 0)
    const byKind = countByKind(alcoholRows)

    const kinds = this.getSettings().workoutKinds
    const kindIds = kinds.map((k) => k.id)
    const workoutsByKind = zeroByKind(kindIds)
    for (const r of workoutRows) if (r.kind in workoutsByKind) workoutsByKind[r.kind as WorkoutKind]++
    // Each day carries a seventh of its own week's plan, so a range that cuts a week
    // (a month starting midweek) gets that share of it; whole weeks come out exact.
    const plans = new Map<string, WorkoutPlan>()
    const goalShare = zeroByKind(kindIds)
    for (const d of days) {
      const week = startOfWeek(d.date)
      if (!plans.has(week)) plans.set(week, this.planForWeek(week).plan)
      for (const k of kindIds) goalShare[k] += (plans.get(week)![k] ?? 0) / 7
    }
    const goalByKind = Object.fromEntries(kindIds.map((k) => [k, Math.round(goalShare[k])])) as Record<WorkoutKind, number>
    const meditationTotal = days.reduce((sum, d) => sum + d.meditationMinutes, 0)
    // A streak runs up to today at the latest -- the days still ahead can't have broken it -- and a
    // today with nothing logged yet doesn't break it either: it counts back from yesterday until it does.
    const lastDay = end < today ? end : today
    const todayStarted = days.some((d) => d.date === today && d.meditationMinutes > 0)
    const through = lastDay === today && !todayStarted ? addDays(today, -1) : lastDay
    // The same rule for the dog's streak: a today with no walk yet doesn't break it.
    const dogToday = days.some((d) => d.date === today && d.dogWalks > 0)
    const dogThrough = lastDay === today && !dogToday ? addDays(today, -1) : lastDay

    return {
      start, end, days, goals: blendGoals(days.map((d) => d.goals)), dayTypes, scorecard: scoreDays(basis),
      charts: this.getSettings().charts,
      totalDays, loggedDays, averagedDays: basis.length, totals, averages,
      water: { total: round1(waterTotal), average: per(basis.reduce((s, d) => s + d.water, 0)), ...scoreWater(basis, goals.water) }, // each day against its own goal (see scoreWater)
      alcohol: { total: alcoholTotal, average: per(basis.reduce((s, d) => s + d.alcohol, 0)), calories: alcoholCalories(byKind), byKind },
      workouts: {
        sessions: workoutRows.length,
        days: days.filter((d) => d.workouts > 0).length,
        minutes: days.reduce((sum, d) => sum + d.workoutMinutes, 0),
        kinds,
        byKind: workoutsByKind,
        goalByKind,
        goal: kindIds.reduce((sum, k) => sum + goalByKind[k], 0),
      },
      meditation: {
        total: meditationTotal,
        average: per(basis.reduce((s, d) => s + d.meditationMinutes, 0)),
        days: days.filter((d) => d.meditationMinutes > 0).length,
        ...scoreMeditation(basis, goals.meditationMinutes),
        streak: streakThrough(days, (d) => d.meditationMinutes > 0, through),
      },
      dog: {
        walks: days.reduce((sum, d) => sum + d.dogWalks, 0),
        miles: round1(days.reduce((sum, d) => sum + d.dogMiles, 0)),
        days: days.filter((d) => d.dogWalks > 0).length,
        ...scoreDogWalks(basis, goals.dogWalks),
        streak: streakThrough(days, (d) => d.dogWalks > 0, dogThrough),
      },
      body: this.getBodyBetween(start, end),
    }
  }

  // --- body measurements ------------------------------------------------------

  /**
   * Readings sent from the phone (an iOS Shortcut reading Apple Health).
   * Accepts Apple Health's own type names or Cairn's, in lb or kg; a body
   * fat fraction (0.21) or percent (21). A reading already stored -- same
   * kind, same moment -- is skipped, so a Shortcut can send the whole last
   * week every morning. Returns how many were new.
   */
  addBodySamples(input: unknown): { added: number; skipped: number } {
    const list = Array.isArray(input) ? input : [input]
    if (list.length > 2000) throw new ValidationError('at most 2000 samples at once')
    let added = 0
    let skipped = 0
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      for (const [i, raw] of list.entries()) {
        const s = cleanBodySample(raw, i)
        const result = this.stmts.insertBody.run(s.metric, s.measuredAt, localDate(new Date(s.measuredAt)), s.value, now)
        if (result.changes) added++
        else skipped++
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return { added, skipped }
  }

  private getBody(date: string): DayView['body'] {
    const out = {} as DayView['body']
    for (const metric of BODY_METRICS) {
      const [latest, before] = this.stmts.selectBodyUpTo.all(metric, date) as unknown as BodyRow[]
      out[metric] = latest
        ? { value: latest.value, measuredAt: latest.measured_at, date: latest.date, change: before ? round1(latest.value - before.value) : null }
        : null
    }
    return out
  }

  private getBodyBetween(start: string, end: string): RangeView['body'] {
    const rows = this.stmts.selectBodyBetween.all(start, end) as unknown as BodyRow[]
    const out = {} as RangeView['body']
    for (const metric of BODY_METRICS) {
      const mine = rows.filter((r) => r.metric === metric)
      const first = mine[0]
      const last = mine[mine.length - 1]
      out[metric] = first && last ? { first: first.value, last: last.value, change: round1(last.value - first.value), count: mine.length } : null
    }
    return out
  }

  /** This day's sessions, plus its calendar week (Sunday-start): each kind's count against that week's plan. */
  private getWorkouts(date: string): DayView['workouts'] {
    const sessions = (this.stmts.selectWorkoutsByDate.all(date) as unknown as WorkoutLogRow[]).map(workoutFromRow)
    const weekStart = startOfWeek(date)
    const weekRows = this.stmts.selectWorkoutsBetween.all(weekStart, addDays(weekStart, 6)) as unknown as WorkoutLogRow[]
    const kinds = this.getSettings().workoutKinds
    const weekByKind = zeroByKind(kinds.map((k) => k.id))
    for (const r of weekRows) if (r.kind in weekByKind) weekByKind[r.kind as WorkoutKind]++
    const { plan, custom } = this.planForWeek(weekStart)
    return {
      sessions, minutes: sessions.reduce((sum, s) => sum + (s.minutes ?? 0), 0),
      weekStart, kinds, plan, planIsCustom: custom, weekByKind,
      weekTotal: weekRows.length, weekGoal: planTotal(plan), lastLogId: sessions[0]?.id ?? null,
      // The whole week's sessions, latest day first, so any of them can be seen and removed from any day.
      weekSessions: weekRows.map(workoutFromRow).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
      planned: this.training.plannedTitles(date),
    }
  }

  /** A week's own plan if it has one, else the default from Settings. */
  planForWeek(weekStart: string): { plan: WorkoutPlan; custom: boolean } {
    const row = this.stmts.selectWeekPlan.get(weekStart) as { plan: string } | undefined
    const own = row ? parsePlan(row.plan, this.kindIds()) : undefined
    return own ? { plan: own, custom: true } : { plan: this.getGoals().workoutPlan, custom: false }
  }

  /** The ids of the activities in Settings, in order. */
  private kindIds(): string[] {
    return this.getSettings().workoutKinds.map((k) => k.id)
  }

  /** Give one week (by its Sunday) its own plan; other weeks keep theirs, or the default. */
  setWeekPlan(weekStart: string, plan: unknown): WorkoutPlan {
    if (!isDateString(weekStart) || startOfWeek(weekStart) !== weekStart) throw new ValidationError('weekStart must be a Sunday, YYYY-MM-DD')
    const clean = cleanPlan(plan, this.kindIds())
    this.stmts.upsertWeekPlan.run(weekStart, JSON.stringify(clean))
    return clean
  }

  /** Put a week back on the default plan. */
  clearWeekPlan(weekStart: string): void {
    if (!isDateString(weekStart)) throw new ValidationError('weekStart must be YYYY-MM-DD')
    this.stmts.deleteWeekPlan.run(weekStart)
  }

  private getMeditation(date: string, goal: number): DayView['meditation'] {
    const sessions = (this.stmts.selectMeditationByDate.all(date) as unknown as MeditationLogRow[]).map(meditationFromRow)
    return { sessions, minutes: sessions.reduce((sum, s) => sum + s.minutes, 0), goal, lastLogId: sessions[0]?.id ?? null }
  }

  /**
   * One workout session. An activity marked "training" in Settings (a WOD
   * or lifting session, as set up) is what a training day is, so logging
   * one ticks the day as training -- the extra carbs apply without a second
   * tap. Other kinds (a ride, yoga) leave the day type alone, and the box in
   * Day view can still be changed by hand.
   */
  addWorkout(input: { date?: unknown; kind?: unknown; minutes?: unknown; note?: unknown }): WorkoutLog {
    const { date, kind } = input
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const kinds = this.getSettings().workoutKinds
    if (typeof kind !== 'string' || !kinds.some((k) => k.id === kind)) {
      throw new ValidationError(`kind must be one of ${kinds.map((k) => k.id).join(', ')}`)
    }
    const note = cleanNote(input.note)
    const log: WorkoutLog = {
      id: randomUUID(), date, kind: kind as WorkoutKind, minutes: cleanMinutes(input.minutes, false), createdAt: Date.now(),
      ...(note ? { note } : {}),
    }
    this.stmts.insertWorkout.run(log.id, log.date, log.kind, log.minutes, log.note ?? null, log.createdAt)
    if (isTrainingKind(kinds, log.kind)) this.stmts.upsertDayType.run(date, 'training')
    return log
  }

  deleteWorkout(id: string): void {
    const result = this.stmts.deleteWorkout.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  /** One sit, in minutes. */
  addMeditation(input: { date?: unknown; minutes?: unknown; note?: unknown }): MeditationLog {
    const { date } = input
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const note = cleanNote(input.note)
    const log: MeditationLog = {
      id: randomUUID(), date, minutes: cleanMinutes(input.minutes, true)!, createdAt: Date.now(), ...(note ? { note } : {}),
    }
    this.stmts.insertMeditation.run(log.id, log.date, log.minutes, log.note ?? null, log.createdAt)
    return log
  }

  deleteMeditation(id: string): void {
    const result = this.stmts.deleteMeditation.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  private getDogWalks(date: string, goal: number, walkMiles: number): DayView['dog'] {
    const walks = (this.stmts.selectDogWalksByDate.all(date) as unknown as DogWalkLogRow[]).map(dogWalkFromRow)
    return { walks, miles: round1(walks.reduce((sum, w) => sum + w.miles, 0)), goal, walkMiles, lastLogId: walks[0]?.id ?? null }
  }

  /** One walk with the dog: the usual length from Settings unless the request says otherwise. */
  addDogWalk(input: { date?: unknown; miles?: unknown }): DogWalkLog {
    const { date } = input
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    let miles = this.getGoals().walkMiles
    if (input.miles != null && input.miles !== '') {
      if (typeof input.miles !== 'number' || !Number.isFinite(input.miles) || input.miles <= 0 || input.miles > 50) {
        throw new ValidationError('miles must be a positive number, at most 50')
      }
      miles = round1(input.miles)
    }
    const log: DogWalkLog = { id: randomUUID(), date, miles, createdAt: Date.now() }
    this.stmts.insertDogWalk.run(log.id, log.date, log.miles, log.createdAt)
    return log
  }

  deleteDogWalk(id: string): void {
    const result = this.stmts.deleteDogWalk.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  private getWater(date: string, goal: number): DayView['water'] {
    const rows = this.stmts.selectWaterByDate.all(date) as unknown as WaterLogRow[]
    const ounces = rows.reduce((sum, r) => sum + r.ounces, 0)
    const tea = rows.reduce((sum, r) => sum + (r.drink === 'tea' ? r.ounces : 0), 0)
    return { ounces, goal, tea, lastLogId: rows[0]?.id ?? null }
  }

  /** This day's drinks, plus the calendar week's (Sunday-start, today included) against its own goal. */
  private getAlcohol(date: string, weekGoal: number): DayView['alcohol'] {
    const rows = this.stmts.selectAlcoholByDate.all(date) as unknown as AlcoholLogRow[]
    const byKind = Object.fromEntries(ALCOHOL_KINDS.map((k) => [k, 0])) as Record<AlcoholKind, number>
    for (const r of rows) if (r.kind in byKind) byKind[r.kind as AlcoholKind]++
    const weekStart = startOfWeek(date)
    const weekEnd = addDays(weekStart, 6)
    const weekRows = this.stmts.selectAlcoholBetween.all(weekStart, weekEnd) as unknown as AlcoholLogRow[]
    return {
      drinks: rows.length, byKind, calories: alcoholCalories(byKind),
      weekTotal: weekRows.length, weekByKind: countByKind(weekRows), weekGoal, lastLogId: rows[0]?.id ?? null,
    }
  }

  /** One standard drink for one day. Just a record -- there is no goal to hit. */
  addAlcohol(date: string, kind: string): AlcoholLog {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!(ALCOHOL_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError(`kind must be one of ${ALCOHOL_KINDS.join(', ')}`)
    }
    const log: AlcoholLog = { id: randomUUID(), date, kind: kind as AlcoholKind, createdAt: Date.now() }
    this.stmts.insertAlcohol.run(log.id, log.date, log.kind, log.createdAt)
    return log
  }

  deleteAlcohol(id: string): void {
    const result = this.stmts.deleteAlcohol.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  /** One water log for one day -- a bottle, a mug of tea, whatever amount was drunk. */
  addWater(date: string, ounces: number, drink: string = 'water'): WaterLog {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (typeof ounces !== 'number' || !Number.isFinite(ounces) || ounces <= 0 || ounces > 200) {
      throw new ValidationError('ounces must be a positive number')
    }
    if (!(DRINKS as readonly string[]).includes(drink)) throw new ValidationError(`drink must be one of ${DRINKS.join(', ')}`)
    const log: WaterLog = { id: randomUUID(), date, ounces, drink: drink as Drink, createdAt: Date.now() }
    this.stmts.insertWater.run(log.id, log.date, log.ounces, log.drink, log.createdAt)
    return log
  }

  deleteWater(id: string): void {
    const result = this.stmts.deleteWater.run(id)
    if (result.changes === 0) throw new ValidationError('no such log')
  }

  /**
   * Validates one entry's contents, without a date or meal -- shared by
   * addEntry (which supplies its own right after) and meal presets, whose
   * items are cleaned the same way at save time and applied, unchanged,
   * through addEntry once a date and meal are chosen for them.
   */
  private cleanEntryItem(input: unknown, label = 'entry'): MealPresetItem {
    const src = (input && typeof input === 'object' ? input : {}) as Partial<NewEntry>
    const grams = cleanGrams(src.grams)
    const amount = src.amount == null ? undefined : cleanAmount(src.amount)
    const per100g = src.per100g == null ? undefined : cleanNutrients(src.per100g, `${label}.per100g`)
    const perUnit = src.perUnit == null ? undefined : cleanNutrients(src.perUnit, `${label}.perUnit`)
    const nutrients = src.nutrients == null ? undefined : cleanNutrients(src.nutrients, `${label}.nutrients`)
    if (per100g) {
      if (grams == null) throw new ValidationError(`${label}: grams is required with per100g`)
    } else if (perUnit) {
      // A food known per serving: the amount says how many servings.
      if (!amount) throw new ValidationError(`${label}: amount is required with perUnit`)
    } else if (!nutrients) {
      throw new ValidationError(`${label} needs per100g, perUnit or nutrients`)
    }
    return {
      name: cleanName(src.name, `${label}.name`),
      brand: typeof src.brand === 'string' && src.brand.trim() ? src.brand.trim().slice(0, MAX_NAME) : undefined,
      grams,
      amount,
      per100g,
      perUnit,
      nutrients,
      foodId: typeof src.foodId === 'string' ? src.foodId.slice(0, 200) : undefined,
      source: cleanSource(src.source),
    }
  }

  addEntry(input: NewEntry): Entry {
    if (!isDateString(input?.date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(input.meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    const item = this.cleanEntryItem(input)
    let grams = item.grams

    let nutrients: Nutrients
    if (item.per100g) {
      nutrients = scale(item.per100g, grams!)
    } else if (item.perUnit) {
      nutrients = multiply(item.perUnit, item.amount!.quantity)
      grams = gramsFor({ grams: item.amount!.unitGrams }, item.amount!.quantity)
    } else {
      nutrients = item.nutrients!
    }

    const entry: Entry = {
      id: randomUUID(),
      date: input.date,
      meal: input.meal,
      name: item.name,
      brand: item.brand,
      grams,
      amount: item.amount,
      nutrients,
      per100g: item.per100g,
      perUnit: item.perUnit,
      foodId: item.foodId,
      source: item.source,
      createdAt: Date.now(),
    }
    this.stmts.insertEntry.run(entry.id, ...entryColumnParams(entry))
    return entry
  }

  /**
   * Change the amount, meal or name. A new quantity rescales in the unit the
   * entry was logged in; a new weight rescales from per100g.
   */
  updateEntry(id: string, patch: {
    grams?: number; quantity?: number; meal?: string; name?: string; nutrients?: Nutrients; perUnit?: Nutrients
  }): Entry {
    const row = this.stmts.selectEntry.get(id) as unknown as EntryRow | undefined
    if (!row) throw new ValidationError('no such entry')
    const entry = entryFromRow(row)

    if (patch.meal !== undefined) {
      if (!MEALS.includes(patch.meal as Entry['meal'])) throw new ValidationError('invalid meal')
      entry.meal = patch.meal as Entry['meal']
    }
    if (patch.name !== undefined) entry.name = cleanName(patch.name)
    // Corrected numbers are for the portion as it was logged, so apply them
    // before any amount change in the same patch rescales from the new basis.
    const corrected = patch.nutrients === undefined ? [] : this.correctNutrients(entry, patch.nutrients)
    if (patch.perUnit !== undefined) {
      // Your own numbers for one serving; a database's stay as published.
      if (!entry.perUnit || entry.source !== 'custom') throw new ValidationError('only your own entries can change their numbers')
      entry.perUnit = cleanNutrients(patch.perUnit, 'perUnit')
      entry.nutrients = multiply(entry.perUnit, entry.amount?.quantity ?? 1)
    }
    if (patch.quantity !== undefined) {
      if (!entry.amount) throw new ValidationError('this entry has no serving to count')
      const amount = cleanAmount({ ...entry.amount, quantity: patch.quantity })
      entry.amount = amount
      const grams = gramsFor({ grams: amount.unitGrams }, amount.quantity)
      if (entry.perUnit) {
        entry.nutrients = multiply(entry.perUnit, amount.quantity)
        entry.grams = grams
      } else if (entry.per100g && grams != null) {
        entry.grams = grams
        entry.nutrients = scale(entry.per100g, grams)
      }
    }
    if (patch.grams !== undefined) {
      const grams = cleanGrams(patch.grams)
      if (grams == null) throw new ValidationError('grams must be a positive number')
      entry.grams = grams
      if (entry.per100g) entry.nutrients = scale(entry.per100g, grams)
      // Now measured by weight, not in the old unit.
      if (patch.quantity === undefined) delete entry.amount
    }

    this.stmts.updateEntry.run(...entryColumnParams(entry), entry.id)
    if (corrected.length && entry.foodId) this.correctSavedFood(entry, corrected)
    return entry
  }

  /**
   * Fix numbers on an entry -- fiber a database left out, a value a lookup got
   * wrong -- whatever its source. Only the ones that actually differ change,
   * and the per-100g / per-serving basis they came from is corrected too, so
   * a later weight or quantity edit scales the corrected numbers rather than
   * quietly restoring the published ones. Returns which nutrients changed.
   */
  private correctNutrients(entry: Entry, input: unknown): NutrientKey[] {
    const edited = cleanNutrients(input, 'nutrients')
    const changed = NUTRIENTS.filter((k) => edited[k] !== entry.nutrients[k])
    const quantity = entry.amount?.quantity
    for (const k of changed) {
      const v = edited[k]
      entry.nutrients = { ...entry.nutrients, [k]: v }
      if (entry.per100g && entry.grams != null && entry.grams > 0) {
        entry.per100g = { ...entry.per100g, [k]: v == null ? null : (v * 100) / entry.grams }
      }
      if (entry.perUnit && quantity != null && quantity > 0) {
        entry.perUnit = { ...entry.perUnit, [k]: v == null ? null : v / quantity }
      }
    }
    return changed
  }

  /** The saved food an entry was logged from gets the same correction, so future logs have it. */
  private correctSavedFood(entry: Entry, changed: NutrientKey[]): void {
    const row = this.stmts.selectFood.get(entry.foodId!) as unknown as FoodRow | undefined
    if (!row) return
    const food = this.loadFood(row)
    let touched = false
    if (food.per100g && entry.per100g) {
      food.per100g = { ...food.per100g }
      for (const k of changed) food.per100g[k] = entry.per100g[k]
      touched = true
    }
    if (food.perServing && entry.perUnit) {
      food.perServing = { ...food.perServing, nutrients: { ...food.perServing.nutrients } }
      for (const k of changed) food.perServing.nutrients[k] = entry.perUnit[k]
      touched = true
    }
    if (touched) this.writeFood(food)
  }

  deleteEntry(id: string): void {
    const result = this.stmts.deleteEntry.run(id)
    if (result.changes === 0) throw new ValidationError('no such entry')
  }

  // --- foods -------------------------------------------------------------------

  private loadFood(row: FoodRow): Food {
    const servings = (this.stmts.selectFoodServings.all(row.id) as unknown as { label: string; grams: number }[])
      .map((s) => ({ label: s.label, grams: s.grams }))
    const sources = (this.stmts.selectFoodSources.all(row.id) as unknown as { title: string; url: string }[])
      .map((s) => ({ title: s.title, url: s.url }))
    return foodFromRow(row, servings, sources)
  }

  listFoods(): Food[] {
    const rows = this.stmts.selectAllFoods.all() as unknown as FoodRow[]
    const servings = groupBy(this.stmts.selectAllFoodServings.all() as unknown as { food_id: string; label: string; grams: number }[], 'food_id')
    const sources = groupBy(this.stmts.selectAllFoodSources.all() as unknown as { food_id: string; title: string; url: string }[], 'food_id')
    return rows
      .map((r) => foodFromRow(
        r,
        (servings.get(r.id) ?? []).map((x) => ({ label: x.label, grams: x.grams })),
        (sources.get(r.id) ?? []).map((x) => ({ title: x.title, url: x.url })),
      ))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Foods logged recently, most recent first, one per food. The honest
   * "frequent foods" list: what you actually eat, not what you remembered
   * to save.
   */
  recentFoods(limit = 20): Food[] {
    const latest = (this.stmts.selectRecentPerFood.all(limit) as unknown as EntryRow[]).map(entryFromRow)
    const out: Food[] = []
    for (const e of latest) {
      const key = e.foodId || `${e.name}|${e.brand ?? ''}`
      const food: Food = { id: e.foodId || `recent:${key}`, name: e.name, brand: e.brand, source: e.source }
      if (e.per100g) {
        food.per100g = e.per100g
        // The unit last used is the most likely next one.
        if (e.amount?.unitGrams) food.servings = [{ label: e.amount.unit, grams: e.amount.unitGrams }]
        else if (e.grams) food.servings = [{ label: `last time (${e.grams} g)`, grams: e.grams }]
      } else if (e.perUnit && e.amount) {
        food.perServing = { label: e.amount.unit, grams: e.amount.unitGrams, nutrients: e.perUnit }
      }
      out.push(food)
    }
    return out
  }

  saveFood(input: Food): Food {
    const food: Food = {
      id: typeof input.id === 'string' && input.id ? input.id.slice(0, 200) : `custom:${randomUUID()}`,
      name: cleanName(input.name),
      brand: typeof input.brand === 'string' && input.brand.trim() ? input.brand.trim().slice(0, MAX_NAME) : undefined,
      source: cleanSource(input.source),
      sourceId: typeof input.sourceId === 'string' ? input.sourceId.slice(0, 100) : undefined,
      per100g: input.per100g == null ? undefined : cleanNutrients(input.per100g, 'per100g'),
      perServing: cleanPerServing(input.perServing),
      sources: cleanSources(input.sources),
      note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 1000) : undefined,
      servings: Array.isArray(input.servings)
        ? input.servings
          .filter((s) => s && typeof s.label === 'string' && typeof s.grams === 'number' && s.grams > 0)
          .slice(0, 20)
          .map((s) => ({ label: s.label.slice(0, 100), grams: s.grams }))
        : undefined,
    }
    if (!food.per100g && !food.perServing) throw new ValidationError('a food needs per100g or perServing nutrition')

    this.writeFood(food)
    return food
  }

  private writeFood(food: Food): void {
    this.db.exec('BEGIN')
    try {
      this.stmts.upsertFood.run(food.id, ...foodColumnParams(food))
      this.stmts.deleteFoodServings.run(food.id)
      this.stmts.deleteFoodSources.run(food.id)
      ;(food.servings ?? []).forEach((s, i) => this.stmts.insertFoodServing.run(food.id, i, s.label, s.grams))
      ;(food.sources ?? []).forEach((s, i) => this.stmts.insertFoodSource.run(food.id, i, s.title, s.url))
      this.syncCachedLookups(food)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /**
   * A cached online lookup that found this food shows the saved copy from
   * now on, so a correction (fiber filled in, a wrong value fixed) isn't
   * undone by picking the same food from a repeat lookup. The cache's age
   * is left alone: this isn't a fresh lookup.
   */
  private syncCachedLookups(food: Food): void {
    for (const row of this.stmts.selectAllLookups.all() as unknown as { key: string; result: string }[]) {
      if (!row.result.includes(JSON.stringify(food.id))) continue
      let result: ResearchResult
      try { result = JSON.parse(row.result) as ResearchResult } catch { continue }
      if (!result.foods.some((f) => f.id === food.id)) continue
      result.foods = result.foods.map((f) => (f.id === food.id ? food : f))
      this.stmts.updateLookupResult.run(JSON.stringify(result), row.key)
    }
  }

  // --- notes on a week or month ----------------------------------------------

  /** The notes written for this exact range, if any, with what they were written from. */
  getNotes(start: string, end: string): { start: string; end: string; fingerprint: string; text: string; model: string; at: number } | null {
    const row = this.stmts.selectNotes.get(`${start}..${end}`) as unknown as
      { start: string; end: string; fingerprint: string; text: string; model: string; at: number } | undefined
    return row ?? null
  }

  saveNotes(start: string, end: string, fingerprint: string, text: string, model: string): void {
    this.stmts.upsertNotes.run(`${start}..${end}`, start, end, fingerprint, text, model, Date.now())
  }

  deleteFood(id: string): void {
    const result = this.stmts.deleteFood.run(id) // cascades servings/sources
    if (result.changes === 0) throw new ValidationError('no such food')
  }

  // --- meal presets --------------------------------------------------------

  private loadPreset(row: { id: string; name: string; created_at: number }): MealPreset {
    const items = (this.stmts.selectPresetItems.all(row.id) as unknown as PresetItemRow[]).map(presetItemFromRow)
    return { id: row.id, name: row.name, items, createdAt: row.created_at }
  }

  listPresets(): MealPreset[] {
    const rows = this.stmts.selectAllPresets.all() as unknown as { id: string; name: string; created_at: number }[]
    const items = groupBy(this.stmts.selectAllPresetItems.all() as unknown as (PresetItemRow & { preset_id: string })[], 'preset_id')
    return rows
      .map((r) => ({ id: r.id, name: r.name, items: (items.get(r.id) ?? []).map(presetItemFromRow), createdAt: r.created_at }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** A named group of foods -- create with no id, or save an edit with one. */
  savePreset(input: { id?: unknown; name?: unknown; items?: unknown }): MealPreset {
    if (!Array.isArray(input?.items) || input.items.length === 0) {
      throw new ValidationError('a meal needs at least one food')
    }
    if (input.items.length > 30) throw new ValidationError('a meal can have at most 30 foods')
    const preset: MealPreset = {
      id: typeof input.id === 'string' && input.id ? input.id.slice(0, 200) : `meal:${randomUUID()}`,
      name: cleanName(input.name, 'name'),
      items: input.items.map((item, i) => this.cleanEntryItem(item, `item ${i + 1}`)),
      createdAt: Date.now(),
    }

    this.db.exec('BEGIN')
    try {
      this.stmts.upsertPreset.run(preset.id, preset.name, preset.createdAt)
      this.stmts.deletePresetItems.run(preset.id)
      preset.items.forEach((item, i) => this.stmts.insertPresetItem.run(preset.id, i, ...presetItemColumnParams(item)))
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return preset
  }

  deletePreset(id: string): void {
    const result = this.stmts.deletePreset.run(id) // cascades items
    if (result.changes === 0) throw new ValidationError('no such meal')
  }

  /**
   * Logs every food in a saved meal to one date and meal-of-day, in one
   * action. date/meal are checked once upfront, common to every item, so a
   * bad one can't log the first few foods and then fail partway through.
   */
  applyPreset(id: string, date: string, meal: string): Entry[] {
    const row = this.stmts.selectPresetById.get(id) as unknown as { id: string; name: string; created_at: number } | undefined
    if (!row) throw new ValidationError('no such meal')
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    if (!MEALS.includes(meal as Meal)) throw new ValidationError(`meal must be one of ${MEALS.join(', ')}`)
    const preset = this.loadPreset(row)
    // All or nothing: a food that fails validation partway must not leave
    // the ones before it logged.
    this.db.exec('BEGIN')
    try {
      const entries = preset.items.map((item) => this.addEntry({ ...item, date, meal: meal as Meal }))
      this.db.exec('COMMIT')
      return entries
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  // --- goals and settings -----------------------------------------------------

  getGoals(): Goals {
    return goalsFromRow(this.stmts.selectGoals.get() as unknown as GoalsRow, this.kindIds())
  }

  /** Change any of the goals; fields left out stay as they were. */
  setGoals(input: Partial<Goals>): Goals {
    const next = this.getGoals()
    if (input.protein !== undefined) next.protein = cleanGoalNumber(input.protein, 'protein')
    if (input.fat !== undefined) next.fat = cleanGoalNumber(input.fat, 'fat')
    if (input.carbs !== undefined) next.carbs = cleanGoalNumber(input.carbs, 'carbs')
    if (input.trainingCarbs !== undefined) next.trainingCarbs = cleanGoalNumber(input.trainingCarbs, 'trainingCarbs')
    if (input.calorieBuffer !== undefined) next.calorieBuffer = cleanGoalNumber(input.calorieBuffer, 'calorieBuffer', 2000)
    if (input.fiber !== undefined) next.fiber = cleanGoalNumber(input.fiber, 'fiber', 1000)
    if (input.water !== undefined) next.water = cleanGoalNumber(input.water, 'water', 1000)
    if (input.alcoholWeekly !== undefined) next.alcoholWeekly = cleanGoalNumber(input.alcoholWeekly, 'alcoholWeekly', 1000)
    if (input.workoutPlan !== undefined) next.workoutPlan = cleanPlan(input.workoutPlan, this.kindIds())
    if (input.meditationMinutes !== undefined) next.meditationMinutes = cleanGoalNumber(input.meditationMinutes, 'meditationMinutes', 1440)
    if (input.dogWalks !== undefined) next.dogWalks = cleanGoalNumber(input.dogWalks, 'dogWalks', 20)
    if (input.walkMiles !== undefined) next.walkMiles = cleanGoalNumber(input.walkMiles, 'walkMiles', 50)
    this.stmts.updateGoals.run(...goalsParams(next))
    return next
  }

  /**
   * No row for a date means it was never marked -- a rest day. Training is
   * the thing you tick off (the "Training day" box in Day view), so a day
   * nobody touched can't claim the higher targets by default.
   */
  getDayType(date: string): DayType {
    const row = this.stmts.selectDayType.get(date) as unknown as DayTypeRow | undefined
    return row?.type === 'training' ? 'training' : 'rest'
  }

  setDayType(date: string, type: unknown): DayType {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const clean = cleanDayType(type)
    this.stmts.upsertDayType.run(date, clean)
    return clean
  }

  getSettings(): Settings {
    const row = this.stmts.selectSettings.get() as unknown as SettingsRow
    return settingsFromRow(row)
  }

  getPublicSettings(): PublicSettings {
    const s = this.getSettings()
    return {
      hasUsdaKey: Boolean(s.usdaApiKey),
      hasLmStudioToken: Boolean(s.lmStudioToken),
      lmStudioUrl: s.lmStudioUrl,
      researchModel: s.researchModel,
      notesModel: s.notesModel,
      labelModel: s.labelModel,
      preferredModel: s.preferredModel,
      autoLookup: s.autoLookup,
      appIcon: s.appIcon,
      charts: s.charts,
      workoutKinds: s.workoutKinds,
      trainingModel: s.trainingModel,
      planChatModel: s.planChatModel,
      equipment: s.equipment,
    }
  }

  setSettings(input: Partial<Settings>): PublicSettings {
    const next = this.getSettings()
    if (typeof input.usdaApiKey === 'string') next.usdaApiKey = input.usdaApiKey.trim().slice(0, 100)
    if (typeof input.lmStudioToken === 'string') next.lmStudioToken = input.lmStudioToken.trim().slice(0, 300)
    if (typeof input.researchModel === 'string') next.researchModel = input.researchModel.trim().slice(0, 200)
    if (typeof input.notesModel === 'string') next.notesModel = input.notesModel.trim().slice(0, 200)
    if (typeof input.labelModel === 'string') next.labelModel = input.labelModel.trim().slice(0, 200)
    if (typeof input.preferredModel === 'string') next.preferredModel = input.preferredModel.trim().slice(0, 200)
    if (typeof input.trainingModel === 'string') next.trainingModel = input.trainingModel.trim().slice(0, 200)
    if (typeof input.planChatModel === 'string') next.planChatModel = input.planChatModel.trim().slice(0, 200)
    if (input.equipment !== undefined) next.equipment = cleanEquipment(input.equipment)
    if (typeof input.autoLookup === 'boolean') next.autoLookup = input.autoLookup
    if (input.appIcon !== undefined) {
      if (!(APP_ICONS as readonly string[]).includes(input.appIcon)) throw new ValidationError(`appIcon must be one of ${APP_ICONS.join(', ')}`)
      next.appIcon = input.appIcon
    }
    if (input.charts !== undefined) {
      const list: unknown = input.charts
      if (!Array.isArray(list) || !list.every((k) => (CHARTABLE as readonly unknown[]).includes(k))) {
        throw new ValidationError(`charts must be a list of ${CHARTABLE.join(', ')}`)
      }
      next.charts = CHARTABLE.filter((k) => list.includes(k)) // no repeats, always in the same order
    }
    if (input.workoutKinds !== undefined) next.workoutKinds = cleanWorkoutKinds(input.workoutKinds)
    if (typeof input.lmStudioUrl === 'string') {
      const url = input.lmStudioUrl.trim().replace(/\/+$/, '')
      if (url) {
        try {
          if (!/^https?:$/.test(new URL(url).protocol)) throw new Error('bad protocol')
        } catch {
          throw new ValidationError('LM Studio address must be an http(s) URL')
        }
      }
      const nextUrl = url || 'http://127.0.0.1:1234'
      // The token was entered for one server: never send it to another
      // unless it comes with the new address.
      if (nextUrl !== next.lmStudioUrl && typeof input.lmStudioToken !== 'string') next.lmStudioToken = ''
      next.lmStudioUrl = nextUrl
    }
    this.stmts.updateSettings.run(next.usdaApiKey, next.lmStudioUrl, next.lmStudioToken, next.researchModel, next.autoLookup ? 1 : 0, next.appIcon, JSON.stringify(next.charts), JSON.stringify(next.workoutKinds), next.notesModel, next.labelModel, next.preferredModel, JSON.stringify(next.equipment), next.trainingModel, next.planChatModel)
    return this.getPublicSettings()
  }
}
