import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  Lift, ProgressSeries, ResolvedItem, ResolvedSession, SchemaOverview, SchemaStatus, SchemaSummary, SetLog, Settings,
  TrainingDay, TrainingItem, TrainingSchema, TrainingSession, WorkoutLog,
} from '../../src/types.ts'
import { addDays, isDateString, localDate } from '../../src/lib/nutrition.ts'
import { cleanSchema } from '../../src/lib/training/schema.ts'
import { findWod, pickWods, viewWod } from '../../src/lib/training/bank.ts'
import {
  describe, e1rm, itemOn, planSets, prescriptionFor, schemaEnd, topWeight, weekdayOf, weekOf,
} from '../../src/lib/training/resolve.ts'
import type { PlannedSet } from '../../src/lib/training/resolve.ts'
import { ValidationError } from './clean.ts'

/**
 * Training schemas and what was done against them. One schema is active
 * at a time; a generated one waits as a draft until it's reviewed. Sets are
 * logged by (date, item, set number), and a session's first logged set
 * also logs the session itself in the ordinary workout log, so the Day
 * view's activity dots and the training-day carbs follow without a second
 * tap.
 */

interface SchemaRow {
  id: string; name: string; body: string; status: SchemaStatus; based_on: string | null; repeats: string; created_at: number; activated_at: number | null
}
interface SetRow { id: string; date: string; schema_id: string; item_id: string; set_index: number; reps: number | null; weight: number | null; seconds: number | null }
interface SessionRow { date: string; schema_id: string; session_id: string; workout_log_id: string | null; wod_id: string | null }
interface LiftRow { id: string; name: string; increment: number; pr: number | null; pr_date: string | null }

export interface TrainingDeps {
  getSettings: () => Settings
  addWorkout: (input: { date: string; kind: string; note?: string }) => WorkoutLog
  deleteWorkout: (id: string) => void
}

const WOD_RECENT_DAYS = 14

const num = (v: unknown, max: number): number | null =>
  v === null || v === undefined || v === '' ? null : typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : NaN

export class TrainingStore {
  private s: Record<string, StatementSync>
  private db: DatabaseSync
  private deps: TrainingDeps

  constructor(db: DatabaseSync, deps: TrainingDeps) {
    this.db = db
    this.deps = deps
    this.s = {
      schemas: db.prepare('SELECT * FROM training_schemas ORDER BY created_at DESC'),
      schema: db.prepare('SELECT * FROM training_schemas WHERE id = ?'),
      active: db.prepare("SELECT * FROM training_schemas WHERE status = 'active' LIMIT 1"),
      draftOf: db.prepare("SELECT * FROM training_schemas WHERE status = 'draft' AND based_on = ? ORDER BY created_at DESC LIMIT 1"),
      insertSchema: db.prepare('INSERT INTO training_schemas (id,name,body,status,based_on,repeats,created_at,activated_at) VALUES (?,?,?,?,?,?,?,?)'),
      setStatus: db.prepare('UPDATE training_schemas SET status = ?, activated_at = ? WHERE id = ?'),
      retireActive: db.prepare("UPDATE training_schemas SET status = 'done' WHERE status = 'active'"),
      setRepeats: db.prepare('UPDATE training_schemas SET repeats = ? WHERE id = ?'),
      deleteSchema: db.prepare('DELETE FROM training_schemas WHERE id = ?'),
      deleteDrafts: db.prepare("DELETE FROM training_schemas WHERE status = 'draft' AND based_on IS ?"),
      lifts: db.prepare('SELECT * FROM lifts ORDER BY rowid'),
      lift: db.prepare('SELECT * FROM lifts WHERE id = ?'),
      upsertLift: db.prepare('INSERT INTO lifts (id,name,increment) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, increment=excluded.increment'),
      setPr: db.prepare('UPDATE lifts SET pr = ?, pr_date = ? WHERE id = ?'),
      insertPr: db.prepare('INSERT INTO lift_prs (lift_id,date,weight,created_at) VALUES (?,?,?,?)'),
      prs: db.prepare('SELECT lift_id, date, weight FROM lift_prs ORDER BY date, created_at'),
      setsOn: db.prepare('SELECT * FROM set_logs WHERE schema_id = ? AND date = ?'),
      setsBetween: db.prepare('SELECT * FROM set_logs WHERE schema_id = ? AND date >= ? AND date <= ?'),
      setsOf: db.prepare('SELECT * FROM set_logs WHERE schema_id = ?'),
      allSets: db.prepare('SELECT * FROM set_logs ORDER BY date'),
      upsertSet: db.prepare(
        'INSERT INTO set_logs (id,date,schema_id,item_id,set_index,reps,weight,seconds,created_at) VALUES (?,?,?,?,?,?,?,?,?) '
        + 'ON CONFLICT(date,item_id,set_index) DO UPDATE SET reps=excluded.reps, weight=excluded.weight, seconds=excluded.seconds, schema_id=excluded.schema_id',
      ),
      deleteSet: db.prepare('DELETE FROM set_logs WHERE date = ? AND item_id = ? AND set_index = ?'),
      session: db.prepare('SELECT * FROM session_logs WHERE date = ? AND session_id = ?'),
      sessionsOn: db.prepare('SELECT * FROM session_logs WHERE schema_id = ? AND date = ?'),
      sessionsOf: db.prepare('SELECT * FROM session_logs WHERE schema_id = ?'),
      upsertSession: db.prepare(
        'INSERT INTO session_logs (date,schema_id,session_id,workout_log_id,wod_id) VALUES (?,?,?,?,?) '
        + 'ON CONFLICT(date,session_id) DO UPDATE SET workout_log_id=excluded.workout_log_id, wod_id=excluded.wod_id, schema_id=excluded.schema_id',
      ),
      recentWods: db.prepare('SELECT wod_id FROM session_logs WHERE wod_id IS NOT NULL AND date >= ? AND date < ?'),
    }
  }

  // --- schemas ---------------------------------------------------------------

  private parse(row: SchemaRow): { schema: TrainingSchema; repeats: number[] } {
    return { schema: JSON.parse(row.body) as TrainingSchema, repeats: JSON.parse(row.repeats) as number[] }
  }

  private summary(row: SchemaRow): SchemaSummary {
    const { schema, repeats } = this.parse(row)
    return {
      id: row.id, name: row.name, status: row.status, startDate: schema.startDate, endDate: schemaEnd(schema, repeats),
      weeks: schema.weeks, firstWeek: schema.firstWeek, basedOn: row.based_on, createdAt: row.created_at,
    }
  }

  private activeRow(): SchemaRow | undefined {
    return this.s.active!.get() as unknown as SchemaRow | undefined
  }

  /** Checked against the activities and gear in Settings; throws every problem at once. */
  validate(input: unknown): TrainingSchema {
    const settings = this.deps.getSettings()
    const { schema, errors } = cleanSchema(input, { kinds: settings.workoutKinds.map((k) => k.id), equipment: settings.equipment })
    if (!schema) throw new ValidationError(`The training schema has problems:\n${errors.join('\n')}`)
    return schema
  }

  /** Save a schema: an import (active straight away, by default) or a generated draft. */
  save(input: unknown, status: SchemaStatus = 'active'): SchemaSummary {
    const schema = this.validate(input)
    const id = randomUUID()
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      if (status === 'active') this.s.retireActive!.run()
      // One draft at a time per schema it follows: a regenerated one replaces the last.
      if (status === 'draft') this.s.deleteDrafts!.run(schema.basedOn ?? null)
      this.s.insertSchema!.run(id, schema.name, JSON.stringify(schema), status, schema.basedOn ?? null, '[]', now, status === 'active' ? now : null)
      // A draft's lifts wait until it's followed, so the PR list only ever shows lifts in use.
      if (status === 'active') for (const l of schema.lifts) this.s.upsertLift!.run(l.id, l.name, l.increment)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.summary(this.s.schema!.get(id) as unknown as SchemaRow)
  }

  list(): SchemaSummary[] {
    return (this.s.schemas!.all() as unknown as SchemaRow[]).map((r) => this.summary(r))
  }

  private row(id: string): SchemaRow {
    const row = this.s.schema!.get(id) as unknown as SchemaRow | undefined
    if (!row) throw new ValidationError('no such training schema')
    return row
  }

  /** Follow this schema from now on; the one before it is finished. */
  activate(id: string): SchemaSummary {
    const row = this.row(id)
    if (row.status === 'active') return this.summary(row)
    // Re-checked: the gear or the activities may have changed since it was written.
    const schema = this.validate(JSON.parse(row.body))
    this.db.exec('BEGIN')
    try {
      this.s.retireActive!.run()
      this.s.setStatus!.run('active', Date.now(), id)
      for (const l of schema.lifts) this.s.upsertLift!.run(l.id, l.name, l.increment)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return this.summary(this.row(id))
  }

  remove(id: string): void {
    const row = this.row(id)
    if (row.status === 'active') throw new ValidationError('the active schema can\'t be deleted; activate another first')
    this.s.deleteSchema!.run(id)
  }

  /** The draft generated from the active schema, if there's one waiting. */
  draft(): SchemaSummary | null {
    const active = this.activeRow()
    if (!active) return null
    const row = this.s.draftOf!.get(active.id) as unknown as SchemaRow | undefined
    return row ? this.summary(row) : null
  }

  /** The active schema itself, with its id: what a new one is generated from. */
  activeSchema(): { id: string; schema: TrainingSchema; repeats: number[]; summary: SchemaSummary } | null {
    const row = this.activeRow()
    return row ? { id: row.id, ...this.parse(row), summary: this.summary(row) } : null
  }

  /** A schema week by week at today's PRs, for the overview and for comparing a draft with the schema before it. */
  overview(id: string): SchemaOverview {
    const row = this.row(id)
    const { schema } = this.parse(row)
    const lifts = this.liftMap()
    const out: SchemaOverview['lifts'] = []
    for (const day of schema.days) {
      for (const session of day.sessions) {
        for (const item of session.items) {
          if (!item.lift || !(item.weeks || item.progression)) continue
          const weeks: SchemaOverview['lifts'][number]['weeks'] = []
          for (let w = schema.firstWeek; w <= schema.weeks; w++) {
            const planned = this.plan(item, w, schema, lifts)
            if (planned) weeks.push({ week: w, text: describe(planned), top: topWeight(planned) })
          }
          out.push({ itemId: item.id, name: item.name, lift: item.lift, weeks })
        }
      }
    }
    return { summary: this.summary(row), schema, lifts: out }
  }

  // --- lifts -----------------------------------------------------------------

  lifts(): Lift[] {
    return (this.s.lifts!.all() as unknown as LiftRow[]).map((r) => ({ id: r.id, name: r.name, increment: r.increment, pr: r.pr, prDate: r.pr_date }))
  }

  private liftMap(): Map<string, Lift> {
    return new Map(this.lifts().map((l) => [l.id, l]))
  }

  setPr(id: string, input: { pr?: unknown; date?: unknown }): Lift {
    const lift = this.s.lift!.get(id) as unknown as LiftRow | undefined
    if (!lift) throw new ValidationError('no such lift')
    const pr = num(input.pr, 2000)
    if (pr === null || Number.isNaN(pr) || pr <= 0) throw new ValidationError('pr must be a weight in lb')
    const date = typeof input.date === 'string' && isDateString(input.date) ? input.date : localDate()
    this.s.setPr!.run(pr, date, id)
    this.s.insertPr!.run(id, date, pr, Date.now())
    return this.lifts().find((l) => l.id === id)!
  }

  // --- a day -----------------------------------------------------------------

  private plan(item: TrainingItem, week: number, schema: TrainingSchema, lifts: Map<string, Lift>): PlannedSet[] | null {
    const p = prescriptionFor(item, week, schema)
    if (!p) return null
    const lift = item.lift ? lifts.get(item.lift) : undefined
    const increment = lift?.increment ?? schema.lifts.find((l) => l.id === item.lift)?.increment ?? 5
    return p.sets.flatMap((t) => planSets(t, lift?.pr ?? null, increment))
  }

  /** The sessions a schema has on a date, with only the items that are on that week. */
  private sessionsOn(schema: TrainingSchema, date: string, week: number): TrainingSession[] {
    const day = schema.days.find((d) => d.weekday === weekdayOf(date))
    if (!day) return []
    return day.sessions
      .map((s) => ({ ...s, items: s.items.filter((i) => itemOn(i, week, schema)) }))
      .filter((s) => s.items.length > 0)
  }

  /** The titles of what the active schema has on a date, for the Day view's link. */
  plannedTitles(date: string): string[] {
    const active = this.activeSchema()
    if (!active) return []
    const at = weekOf(active.schema, date, active.repeats)
    return at ? this.sessionsOn(active.schema, date, at.week).map((s) => s.title) : []
  }

  day(date: string, shuffle = 0): TrainingDay {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const active = this.activeSchema()
    const lifts = this.lifts()
    const empty: TrainingDay = { date, schema: active?.summary ?? null, draft: this.draft(), week: null, deload: false, test: false, repeat: false, sessions: [], strip: [], lifts }
    if (!active) return empty
    const { id, schema, repeats } = active
    const at = weekOf(schema, date, repeats)
    const strip = this.strip(id, schema, repeats, date)
    if (!at) return { ...empty, strip }
    const logs = this.logMap(this.s.setsOn!.all(id, date) as unknown as SetRow[])
    const sessionRows = new Map((this.s.sessionsOn!.all(id, date) as unknown as SessionRow[]).map((r) => [r.session_id, r]))
    const recent = (this.s.recentWods!.all(addDays(date, -WOD_RECENT_DAYS), date) as unknown as { wod_id: string }[]).map((r) => r.wod_id)
    const liftById = new Map(lifts.map((l) => [l.id, l]))
    const equipment = this.deps.getSettings().equipment

    const sessions: ResolvedSession[] = this.sessionsOn(schema, date, at.week).map((session) => {
      const items: ResolvedItem[] = session.items.map((item) => {
        const base = { id: item.id, name: item.name, ...(item.lift ? { lift: item.lift } : {}), ...(item.notes ? { notes: item.notes } : {}) }
        if (item.weeks || item.progression) {
          const planned = this.plan(item, at.week, schema, liftById) ?? []
          const sets = planned.map((p, index) => ({ index, ...p, log: logs.get(`${item.id}:${index}`) ?? null }))
          const note = prescriptionFor(item, at.week, schema)?.note
          return { ...base, type: 'sets' as const, sets, done: sets.length > 0 && sets.every((s) => s.log), ...(note ? { note } : {}) }
        }
        const done = logs.has(`${item.id}:0`)
        if (item.minutes) return { ...base, type: 'minutes' as const, minutes: item.minutes[String(at.week)], done }
        if (item.wod) {
          const chosen = sessionRows.get(session.id)?.wod_id ?? null
          const picks = pickWods(item.wod, equipment, { recent, seed: `${date}:${shuffle}`, extra: schema.wods })
          const chosenWod = chosen ? findWod(chosen, schema.wods) : undefined
          const chosenView = chosenWod ? viewWod(chosenWod, equipment, item.wod.lowImpact) : null
          return {
            ...base, type: 'wod' as const, done,
            wod: { slot: item.wod, chosen, picks: chosenView ? [chosenView, ...picks.filter((p) => p.id !== chosen)] : picks },
          }
        }
        return { ...base, type: 'check' as const, done }
      })
      return { id: session.id, title: session.title, kind: session.kind, items, done: items.every((i) => i.done) }
    })

    return {
      ...empty, week: at.week, repeat: at.repeat, deload: schema.deloadWeeks.includes(at.week), test: schema.testWeek === at.week, sessions, strip,
    }
  }

  private logMap(rows: SetRow[]): Map<string, SetLog> {
    return new Map(rows.map((r) => [`${r.item_id}:${r.set_index}`, { id: r.id, reps: r.reps, weight: r.weight, seconds: r.seconds, done: true }]))
  }

  /** Monday to Sunday around the date: what each day has, and whether it's done. */
  private strip(id: string, schema: TrainingSchema, repeats: number[], date: string): TrainingDay['strip'] {
    const monday = addDays(date, 1 - weekdayOf(date))
    const sunday = addDays(monday, 6)
    const logged = new Map<string, Set<string>>()
    for (const r of this.s.setsBetween!.all(id, monday, sunday) as unknown as SetRow[]) {
      if (!logged.has(r.date)) logged.set(r.date, new Set())
      logged.get(r.date)!.add(`${r.item_id}:${r.set_index}`)
    }
    const lifts = this.liftMap()
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i)
      const at = weekOf(schema, d, repeats)
      const done = logged.get(d) ?? new Set<string>()
      const sessions = at ? this.sessionsOn(schema, d, at.week).map((s) => {
        const keys = s.items.flatMap((item) => {
          const planned = item.weeks || item.progression ? this.plan(item, at.week, schema, lifts) ?? [] : [null]
          return planned.map((_, k) => `${item.id}:${k}`)
        })
        const hits = keys.filter((k) => done.has(k)).length
        return { id: s.id, title: s.title, kind: s.kind, done: keys.length > 0 && hits === keys.length, started: hits > 0 }
      }) : []
      return { date: d, sessions }
    })
  }

  // --- logging ---------------------------------------------------------------

  /** Where an item sits on a date in the active schema, or a 400 if it isn't on that day. */
  private locate(date: unknown, itemId: unknown): { id: string; schema: TrainingSchema; week: number; session: TrainingSession; item: TrainingItem; date: string } {
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const active = this.activeSchema()
    if (!active) throw new ValidationError('no training schema is active')
    const at = weekOf(active.schema, date, active.repeats)
    if (!at) throw new ValidationError('that day is outside the active schema')
    for (const session of this.sessionsOn(active.schema, date, at.week)) {
      const item = session.items.find((i) => i.id === itemId)
      if (item) return { id: active.id, schema: active.schema, week: at.week, session, item, date }
    }
    throw new ValidationError('that item isn\'t on the plan for that day')
  }

  /**
   * Tick a set done (with what was actually lifted), or untick it. Returns
   * the day afresh, and a lift whose PR the set beat, so the page can offer
   * to make it the new one.
   */
  logSet(input: { date?: unknown; itemId?: unknown; setIndex?: unknown; reps?: unknown; weight?: unknown; seconds?: unknown; done?: unknown }): { day: TrainingDay; newPr: { lift: string; name: string; weight: number } | null } {
    const at = this.locate(input.date, input.itemId)
    const index = input.setIndex ?? 0
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 40) throw new ValidationError('setIndex must be a set number')
    const reps = num(input.reps, 500)
    const weight = num(input.weight, 2000)
    const seconds = num(input.seconds, 36_000)
    if ([reps, weight, seconds].some((v) => Number.isNaN(v))) throw new ValidationError('reps, weight and seconds must be positive numbers')
    let newPr: { lift: string; name: string; weight: number } | null = null
    if (input.done === false) {
      this.s.deleteSet!.run(at.date, at.item.id, index)
    } else {
      this.s.upsertSet!.run(randomUUID(), at.date, at.id, at.item.id, index, reps, weight, seconds, Date.now())
      const lift = at.item.lift ? this.liftMap().get(at.item.lift) : undefined
      if (lift && weight !== null && reps !== null && reps >= 1 && (lift.pr === null || weight > lift.pr)) newPr = { lift: lift.id, name: lift.name, weight }
    }
    this.syncSession(at.date, at.id, at.session)
    return { day: this.day(at.date), newPr }
  }

  /** Pick (or clear) the WOD for a session's WOD slot. */
  setWod(input: { date?: unknown; itemId?: unknown; wodId?: unknown }): TrainingDay {
    const at = this.locate(input.date, input.itemId)
    if (!at.item.wod) throw new ValidationError('that item isn\'t a WOD slot')
    const wodId = input.wodId === null ? null : typeof input.wodId === 'string' && findWod(input.wodId, at.schema.wods) ? input.wodId : undefined
    if (wodId === undefined) throw new ValidationError('no such WOD')
    const row = this.s.session!.get(at.date, at.session.id) as unknown as SessionRow | undefined
    this.s.upsertSession!.run(at.date, at.id, at.session.id, row?.workout_log_id ?? null, wodId)
    return this.day(at.date)
  }

  /** The workout log follows the session: in with its first logged set, out with its last. */
  private syncSession(date: string, schemaId: string, session: TrainingSession): void {
    const ids = new Set(session.items.map((i) => i.id))
    const any = (this.s.setsOn!.all(schemaId, date) as unknown as SetRow[]).some((r) => ids.has(r.item_id))
    const row = this.s.session!.get(date, session.id) as unknown as SessionRow | undefined
    if (any && !row?.workout_log_id) {
      let logId: string | null = null
      try {
        logId = this.deps.addWorkout({ date, kind: session.kind, note: session.title }).id
      } catch { /* the activity was removed from Settings: the sets still count */ }
      this.s.upsertSession!.run(date, schemaId, session.id, logId, row?.wod_id ?? null)
    } else if (!any && row?.workout_log_id) {
      try { this.deps.deleteWorkout(row.workout_log_id) } catch { /* already removed from the Day view */ }
      this.s.upsertSession!.run(date, schemaId, session.id, null, row.wod_id)
    }
  }

  /** Repeat the week a date falls in: every later week moves back by seven days. */
  repeatWeek(date: unknown): TrainingDay {
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const active = this.activeSchema()
    if (!active) throw new ValidationError('no training schema is active')
    const at = weekOf(active.schema, date, active.repeats)
    if (!at) throw new ValidationError('that day is outside the active schema')
    if (active.repeats.length >= 8) throw new ValidationError('that\'s already eight repeated weeks')
    this.s.setRepeats!.run(JSON.stringify([...active.repeats, at.week]), active.id)
    return this.day(date)
  }

  // --- progress and the report the next schema is written from ----------------

  progress(): ProgressSeries {
    const items = new Map<string, TrainingItem>()
    for (const row of this.s.schemas!.all() as unknown as SchemaRow[]) {
      for (const d of this.parse(row).schema.days) for (const s of d.sessions) for (const i of s.items) if (!items.has(i.id)) items.set(i.id, i)
    }
    const byLift = new Map<string, Map<string, { weight: number; reps: number; e1rm: number }>>()
    const baselines = new Map<string, { unit: 'reps' | 's'; best: Map<string, number> }>()
    for (const r of this.s.allSets!.all() as unknown as SetRow[]) {
      const item = items.get(r.item_id)
      if (!item) continue
      if (item.lift && r.weight !== null && r.reps !== null && r.reps > 0) {
        if (!byLift.has(item.lift)) byLift.set(item.lift, new Map())
        const day = byLift.get(item.lift)!
        const est = e1rm(r.weight, r.reps)
        const prev = day.get(r.date)
        if (!prev || r.weight > prev.weight || (r.weight === prev.weight && r.reps > prev.reps)) day.set(r.date, { weight: r.weight, reps: r.reps, e1rm: Math.max(est, prev?.e1rm ?? 0) })
      } else if (!item.lift && r.weight === null && (r.seconds !== null || r.reps !== null)) {
        const unit = r.seconds !== null ? 's' : 'reps'
        const value = (r.seconds ?? r.reps)!
        if (!baselines.has(item.id)) baselines.set(item.id, { unit, best: new Map() })
        const b = baselines.get(item.id)!
        b.best.set(r.date, Math.max(value, b.best.get(r.date) ?? 0))
      }
    }
    const prs = this.s.prs!.all() as unknown as { lift_id: string; date: string; weight: number }[]
    return {
      lifts: this.lifts().map((l) => ({
        id: l.id, name: l.name, pr: l.pr,
        points: [...(byLift.get(l.id) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
        prs: prs.filter((p) => p.lift_id === l.id).map((p) => ({ date: p.date, weight: p.weight })),
      })),
      baselines: [...baselines.entries()].map(([itemId, b]) => ({
        itemId, name: items.get(itemId)!.name, unit: b.unit,
        points: [...b.best.entries()].sort(([a], [c]) => a.localeCompare(c)).map(([date, value]) => ({ date, value })),
      })),
    }
  }

  /**
   * How a schema actually went, worked out here rather than by the model:
   * per lift, what was planned and what was lifted each week; how often
   * each other item and session got done; repeated weeks; WODs done. Only
   * days up to `today` count as planned.
   */
  report(id: string, today = localDate()): string {
    const row = this.row(id)
    const { schema, repeats } = this.parse(row)
    const lifts = this.liftMap()
    const sets = this.s.setsOf!.all(id) as unknown as SetRow[]
    const logged = new Map<string, SetRow>(sets.map((r) => [`${r.date}|${r.item_id}|${r.set_index}`, r]))
    const end = schemaEnd(schema, repeats)
    const last = end < today ? end : today
    const lines: string[] = [
      `Schema "${schema.name}": weeks ${schema.firstWeek}-${schema.weeks}, ${schema.startDate} to ${end}${repeats.length ? `; weeks repeated: ${repeats.join(', ')}` : ''}.`,
      `Deload weeks: ${schema.deloadWeeks.join(', ') || 'none'}; test week: ${schema.testWeek ?? 'none'}.`,
      `PRs now (lb): ${this.lifts().map((l) => `${l.name} ${l.pr ?? '?'}${l.prDate ? ` (set ${l.prDate})` : ''}`).join(', ') || 'none recorded'}.`,
    ]
    const liftLines = new Map<string, string[]>()
    const counts = new Map<string, { name: string; planned: number; done: number }>()
    const sessionCounts = new Map<string, { title: string; planned: number; done: number }>()
    for (let d = schema.startDate; d <= last; d = addDays(d, 1)) {
      const at = weekOf(schema, d, repeats)
      if (!at) continue
      for (const session of this.sessionsOn(schema, d, at.week)) {
        const sc = sessionCounts.get(session.id) ?? { title: session.title, planned: 0, done: 0 }
        sc.planned++
        let sessionDone = false
        for (const item of session.items) {
          const c = counts.get(item.id) ?? { name: item.name, planned: 0, done: 0 }
          c.planned++
          const planned = item.weeks || item.progression ? this.plan(item, at.week, schema, lifts) ?? [] : [null]
          const done = planned.map((_, k) => logged.get(`${d}|${item.id}|${k}`)).filter((r): r is SetRow => Boolean(r))
          if (done.length) { c.done++; sessionDone = true }
          counts.set(item.id, c)
          if (item.lift && planned[0]) {
            const lifted = done.filter((r) => r.weight !== null)
            const top = lifted.reduce<SetRow | null>((best, r) => (!best || r.weight! > best.weight! ? r : best), null)
            const off = lifted.filter((r) => planned[r.set_index]?.weight != null && r.weight !== planned[r.set_index]!.weight)
            const list = liftLines.get(item.id) ?? []
            list.push(`  week ${at.week}${at.repeat ? ' (repeat)' : ''} ${d}: planned ${describe(planned as PlannedSet[])}; done ${done.length}/${planned.length} sets${top ? `, top ${top.weight}×${top.reps ?? '?'}` : ''}${off.length ? `, ${off.length} set(s) at a different weight than planned` : ''}`)
            liftLines.set(item.id, list)
          }
        }
        if (sessionDone) sc.done++
        sessionCounts.set(session.id, sc)
      }
    }
    for (const [itemId, list] of liftLines) {
      const item = schema.days.flatMap((d) => d.sessions.flatMap((s) => s.items)).find((i) => i.id === itemId)!
      lines.push(`${item.name} (${item.lift}):`, ...list)
    }
    lines.push('Sessions done of planned:', ...[...sessionCounts.values()].map((s) => `  ${s.title}: ${s.done}/${s.planned}`))
    lines.push('Items done of planned:', ...[...counts.values()].map((c) => `  ${c.name}: ${c.done}/${c.planned}`))
    const wods = (this.s.sessionsOf!.all(id) as unknown as SessionRow[]).filter((r) => r.wod_id).map((r) => findWod(r.wod_id!, schema.wods)?.name ?? r.wod_id)
    lines.push(`WODs picked: ${wods.length ? wods.join(', ') : 'none'}.`)
    return lines.join('\n')
  }
}
