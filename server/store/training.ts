import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type {
  CoachMessage, Equipment, Lift, PlanProposal, ProgressSeries, ResolvedItem, ResolvedSession, SchemaOverview, SchemaStatus, SchemaSummary, SetLog, Settings,
  TrainingDay, TrainingItem, TrainingSchema, TrainingSession, WorkoutLog,
} from '../../src/types.ts'
import type { OverrideEdit } from '../../src/lib/training/edits.ts'
import { addDays, isDateString, localDate } from '../../src/lib/nutrition.ts'
import { cleanSchema } from '../../src/lib/training/schema.ts'
import { findWod, pickWods, viewWod } from '../../src/lib/training/bank.ts'
import {
  describe, e1rm, hasSets, itemOn, planSets, prescriptionFor, roundTo, schemaEnd, topWeight, weekdayOf, weekOf,
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
  rewrite: string | null
}
interface OverrideRow { id: string; schema_id: string; kind: string; body: string; from_date: string; to_date: string; message_id: string | null }
interface RevisionRow { id: string; schema_id: string; body: string; reason: string; message_id: string | null; created_at: number }
interface ChatRow { id: string; schema_id: string; role: 'user' | 'assistant'; text: string; proposal: string | null; status: CoachMessage['status']; note: string | null; created_at: number }

/** One of the coach's one-off changes, as stored. */
interface Override { id: string; edit: OverrideEdit; messageId: string | null }

/** The active schema with what a day is worked out from: its repeated weeks and the coach's changes. */
export interface ActivePlan { id: string; schema: TrainingSchema; repeats: number[]; summary: SchemaSummary; overrides: Override[] }

/** A session on a day, with the week of the schema it's from (a moved session keeps its own). */
interface Planned { session: TrainingSession; week: number; movedFrom?: string }

/** "Fri Nov 6". */
export const shortDate = (date: string): string =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export const describeGear = (e: Equipment): string =>
  [...e.gear.filter((g) => g !== 'dumbbells' && g !== 'kettlebells'), ...(e.dumbbells.length ? [`dumbbells ${e.dumbbells.join('/')} lb`] : []), ...(e.kettlebells.length ? [`kettlebells ${e.kettlebells.join('/')} lb`] : [])].join(', ') || 'bodyweight only'

/** A one-off change in a line, for the report the next schema is written from. */
export function overrideText(e: OverrideEdit): string {
  switch (e.op) {
    case 'move': return `moved session ${e.sessionId} from ${e.from} to ${e.to}`
    case 'skip': return `skipped ${e.sessionId ? `session ${e.sessionId}` : 'the day'} on ${e.date}`
    case 'load': return `weights at ${Math.round(e.factor * 100)}%${e.lifts?.length ? ` for ${e.lifts.join(', ')}` : ''}, ${e.from} to ${e.to}`
    case 'swap': return `${e.item.name} in place of item ${e.itemId}, ${e.from} to ${e.to}`
    case 'equipment': return `traveling gear ${e.from} to ${e.to}: ${describeGear(e.equipment)}`
  }
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
      insertSchema: db.prepare('INSERT INTO training_schemas (id,name,body,status,based_on,repeats,created_at,activated_at,rewrite) VALUES (?,?,?,?,?,?,?,?,?)'),
      updateBody: db.prepare('UPDATE training_schemas SET body = ?, name = ? WHERE id = ?'),
      overridesOf: db.prepare('SELECT * FROM schema_overrides WHERE schema_id = ? ORDER BY created_at, rowid'),
      insertOverride: db.prepare('INSERT INTO schema_overrides (id,schema_id,kind,body,from_date,to_date,message_id,created_at) VALUES (?,?,?,?,?,?,?,?)'),
      deleteOverride: db.prepare('DELETE FROM schema_overrides WHERE id = ?'),
      deleteOverridesOf: db.prepare('DELETE FROM schema_overrides WHERE message_id = ?'),
      lastRevision: db.prepare('SELECT * FROM schema_revisions WHERE schema_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'),
      revisionOf: db.prepare('SELECT * FROM schema_revisions WHERE message_id = ? LIMIT 1'),
      insertRevision: db.prepare('INSERT INTO schema_revisions (id,schema_id,body,reason,message_id,created_at) VALUES (?,?,?,?,?,?)'),
      deleteRevision: db.prepare('DELETE FROM schema_revisions WHERE id = ?'),
      chatOf: db.prepare('SELECT * FROM training_chat WHERE schema_id = ? ORDER BY created_at, rowid'),
      chatMessage: db.prepare('SELECT * FROM training_chat WHERE id = ?'),
      insertChat: db.prepare('INSERT INTO training_chat (id,schema_id,role,text,proposal,status,note,created_at) VALUES (?,?,?,?,?,?,?,?)'),
      updateChat: db.prepare('UPDATE training_chat SET status = ?, note = ? WHERE id = ?'),
      supersede: db.prepare("UPDATE training_chat SET status = 'declined' WHERE schema_id = ? AND status = 'proposed'"),
      clearChat: db.prepare('DELETE FROM training_chat WHERE schema_id = ?'),
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
      rewriteFrom: row.rewrite ? (JSON.parse(row.rewrite) as { fromWeek: number }).fromWeek : null,
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
  save(input: unknown, status: SchemaStatus = 'active', rewrite?: { fromWeek: number; messageId: string | null }): SchemaSummary {
    const schema = this.validate(input)
    const id = randomUUID()
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      if (status === 'active') this.s.retireActive!.run()
      // One draft at a time per schema it follows: a regenerated one replaces the last.
      if (status === 'draft') this.s.deleteDrafts!.run(schema.basedOn ?? null)
      this.s.insertSchema!.run(id, schema.name, JSON.stringify(schema), status, schema.basedOn ?? null, '[]', now, status === 'active' ? now : null, rewrite ? JSON.stringify(rewrite) : null)
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
    // A rewrite isn't a new schema: it becomes the active one's new body, so this block's logs stay with it.
    if (row.rewrite) {
      const active = this.activeRow()
      if (!active || active.id !== row.based_on) throw new ValidationError('that rewrite was written for a schema that is no longer the active one')
      const { messageId } = JSON.parse(row.rewrite) as { messageId: string | null }
      this.revise(active.id, { ...schema, basedOn: undefined }, 'rewrite', messageId)
      this.s.deleteSchema!.run(id)
      if (messageId) this.s.updateChat!.run('applied', 'The rewrite is being followed.', messageId)
      return this.summary(this.row(active.id))
    }
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
          if (!item.lift || !hasSets(item)) continue
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

  private plan(item: TrainingItem, week: number, schema: TrainingSchema, lifts: Map<string, Lift>, factor = 1): PlannedSet[] | null {
    const p = prescriptionFor(item, week, schema)
    if (!p) return null
    const lift = item.lift ? lifts.get(item.lift) : undefined
    const increment = lift?.increment ?? schema.lifts.find((l) => l.id === item.lift)?.increment ?? 5
    const sets = p.sets.flatMap((t) => planSets(t, lift?.pr ?? null, increment))
    // A lighter (or heavier) stretch from the coach: the plan's weights scaled, still in the lift's steps.
    return factor === 1 || !item.lift ? sets : sets.map((x) => (x.weight === null ? x : { ...x, weight: roundTo(x.weight * factor, increment) }))
  }

  /** The sessions a schema has on a date, with only the items that are on that week. */
  private sessionsOn(schema: TrainingSchema, date: string, week: number): TrainingSession[] {
    const day = schema.days.find((d) => d.weekday === weekdayOf(date))
    if (!day) return []
    return day.sessions
      .map((s) => ({ ...s, items: s.items.filter((i) => itemOn(i, week, schema)) }))
      .filter((s) => s.items.length > 0)
  }

  /** The coach's one-off changes to a schema, oldest first. */
  private overrides(schemaId: string): Override[] {
    return (this.s.overridesOf!.all(schemaId) as unknown as OverrideRow[]).map((r) => ({ id: r.id, edit: JSON.parse(r.body) as OverrideEdit, messageId: r.message_id }))
  }

  /**
   * What's planned on a date once the coach's changes are laid over the
   * schema: skipped sessions out, sessions moved here in (at the week they
   * came from), stand-ins in place of the items they replace.
   */
  private sessionsFor(plan: ActivePlan, date: string): Planned[] {
    const { schema, repeats, overrides } = plan
    const base = (d: string): Planned[] => {
      const at = weekOf(schema, d, repeats)
      return at ? this.sessionsOn(schema, d, at.week).map((session) => ({ session, week: at.week })) : []
    }
    let list = base(date)
    for (const { edit } of overrides) {
      if (edit.op === 'skip' && edit.date === date) list = list.filter((p) => edit.sessionId && p.session.id !== edit.sessionId)
      if (edit.op === 'move') {
        if (edit.from === date) list = list.filter((p) => p.session.id !== edit.sessionId)
        if (edit.to === date) {
          const moved = base(edit.from).find((p) => p.session.id === edit.sessionId)
          // First on its new day: it's the reason the day changed.
          if (moved && !list.some((p) => p.session.id === edit.sessionId)) list.unshift({ ...moved, movedFrom: edit.from })
        }
      }
    }
    for (const { edit } of overrides) {
      if (edit.op !== 'swap' || date < edit.from || date > edit.to) continue
      list = list.map((p) => ({ ...p, session: { ...p.session, items: p.session.items.map((i) => (i.id === edit.itemId ? edit.item : i)) } }))
    }
    return list
  }

  /** How much the coach has scaled a lift's weights on a date (1 when not at all). */
  private factorOn(plan: ActivePlan, date: string, lift: string | undefined): number {
    let f = 1
    for (const { edit } of plan.overrides) {
      if (edit.op === 'load' && date >= edit.from && date <= edit.to && lift && (!edit.lifts?.length || edit.lifts.includes(lift))) f *= edit.factor
    }
    return f
  }

  /** The gear on hand on a date: a traveling stretch's, else Settings'. */
  equipmentOn(plan: ActivePlan | null, date: string): Equipment {
    let gear = this.deps.getSettings().equipment
    for (const { edit } of plan?.overrides ?? []) if (edit.op === 'equipment' && date >= edit.from && date <= edit.to) gear = edit.equipment
    return gear
  }

  /** The active schema with its repeats and the coach's changes: everything a day is worked out from. */
  activePlan(): ActivePlan | null {
    const active = this.activeSchema()
    return active ? { ...active, overrides: this.overrides(active.id) } : null
  }

  /** A day's planned items in words, for the coach and for previews: "Back squat: 5×5 @ 95". */
  planOf(plan: ActivePlan, date: string): { id: string; title: string; kind: string; week: number; optional: boolean; items: { id: string; name: string; text: string; optional: boolean }[] }[] {
    const lifts = this.liftMap()
    return this.sessionsFor(plan, date).map(({ session, week }) => ({
      id: session.id, title: session.title, kind: session.kind, week, optional: Boolean(session.optional),
      items: session.items.map((item) => {
        let text = 'tick'
        if (hasSets(item)) text = describe(this.plan(item, week, plan.schema, lifts, this.factorOn(plan, date, item.lift)) ?? [])
        else if (item.minutes) text = `${item.minutes[String(week)]} min`
        else if (item.wod) text = `WOD up to ${item.wod.maxMinutes} min`
        return { id: item.id, name: item.name, text, optional: Boolean(item.optional) }
      }),
    }))
  }

  /** The titles of what the active schema has on a date, for the Day view's link. */
  plannedTitles(date: string): string[] {
    const plan = this.activePlan()
    return plan ? this.sessionsFor(plan, date).map((p) => p.session.title) : []
  }

  /** The coach's changes that touch a date, in words. */
  private adjustmentsOn(plan: ActivePlan, date: string): TrainingDay['adjustments'] {
    const titleOf = (sessionId: string, on: string): string =>
      this.planOfRaw(plan, on).find((s) => s.id === sessionId)?.title ?? 'a session'
    const out: TrainingDay['adjustments'] = []
    for (const { id, edit } of plan.overrides) {
      if (edit.op === 'move' && edit.from === date) out.push({ id, text: `${titleOf(edit.sessionId, edit.from)} moved to ${shortDate(edit.to)}` })
      if (edit.op === 'move' && edit.to === date) out.push({ id, text: `${titleOf(edit.sessionId, edit.from)} moved here from ${shortDate(edit.from)}` })
      if (edit.op === 'skip' && edit.date === date) out.push({ id, text: edit.sessionId ? `Skipping ${titleOf(edit.sessionId, date)}` : 'Skipping the day' })
      const covers = 'from' in edit && 'to' in edit && edit.op !== 'move' && date >= edit.from && date <= edit.to
      // Lighter weights only where an affected lift is on the day's plan.
      const lifted = edit.op === 'load' && this.sessionsFor(plan, date).some((p) => p.session.items.some((i) => i.lift && (!edit.lifts?.length || edit.lifts.includes(i.lift))))
      if (covers && edit.op === 'load' && lifted) out.push({ id, text: `Weights at ${Math.round(edit.factor * 100)}%${edit.lifts?.length ? ` for ${edit.lifts.join(', ')}` : ''} until ${shortDate(edit.to)}` })
      if (covers && edit.op === 'swap') out.push({ id, text: `${edit.item.name} in place of ${this.itemName(plan.schema, edit.itemId)} until ${shortDate(edit.to)}` })
      if (covers && edit.op === 'equipment') out.push({ id, text: `Gear until ${shortDate(edit.to)}: ${describeGear(edit.equipment)}` })
    }
    return out
  }

  /** The schema's own sessions on a date, before any of the coach's changes. */
  private planOfRaw(plan: ActivePlan, date: string): TrainingSession[] {
    const at = weekOf(plan.schema, date, plan.repeats)
    return at ? this.sessionsOn(plan.schema, date, at.week) : []
  }

  private itemName(schema: TrainingSchema, itemId: string): string {
    for (const d of schema.days) for (const s of d.sessions) for (const i of s.items) if (i.id === itemId) return i.name
    return itemId
  }

  day(date: string, shuffle = 0): TrainingDay {
    if (!isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const plan = this.activePlan()
    const lifts = this.lifts()
    const empty: TrainingDay = {
      date, schema: plan?.summary ?? null, draft: this.draft(), week: null, deload: false, test: false, repeat: false, sessions: [], adjustments: [], strip: [], lifts,
    }
    if (!plan) return empty
    const { id, schema, repeats } = plan
    const at = weekOf(schema, date, repeats)
    const strip = this.strip(plan, date)
    const adjustments = this.adjustmentsOn(plan, date)
    const logs = this.logMap(this.s.setsOn!.all(id, date) as unknown as SetRow[])
    const sessionRows = new Map((this.s.sessionsOn!.all(id, date) as unknown as SessionRow[]).map((r) => [r.session_id, r]))
    const recent = (this.s.recentWods!.all(addDays(date, -WOD_RECENT_DAYS), date) as unknown as { wod_id: string }[]).map((r) => r.wod_id)
    const liftById = new Map(lifts.map((l) => [l.id, l]))
    const equipment = this.equipmentOn(plan, date)

    const sessions: ResolvedSession[] = this.sessionsFor(plan, date).map(({ session, week }) => {
      const items: ResolvedItem[] = session.items.map((item) => {
        const base = { id: item.id, name: item.name, ...(item.lift ? { lift: item.lift } : {}), ...(item.notes ? { notes: item.notes } : {}), ...(item.optional ? { optional: true } : {}) }
        if (hasSets(item)) {
          const planned = this.plan(item, week, schema, liftById, this.factorOn(plan, date, item.lift)) ?? []
          const sets = planned.map((p, index) => ({ index, ...p, log: logs.get(`${item.id}:${index}`) ?? null }))
          const note = prescriptionFor(item, week, schema)?.note
          return { ...base, type: 'sets' as const, sets, done: sets.length > 0 && sets.every((s) => s.log), ...(note ? { note } : {}) }
        }
        const done = logs.has(`${item.id}:0`)
        if (item.minutes) return { ...base, type: 'minutes' as const, minutes: item.minutes[String(week)], done }
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
      // Optional items don't hold a session back; a session of only optional items is done when any of them is.
      const required = items.filter((i) => !i.optional)
      const done = required.length ? required.every((i) => i.done) : items.some((i) => i.done)
      return { id: session.id, title: session.title, kind: session.kind, ...(session.optional ? { optional: true } : {}), items, done }
    })

    if (!at) return { ...empty, strip, adjustments, sessions }
    return {
      ...empty, week: at.week, repeat: at.repeat, deload: schema.deloadWeeks.includes(at.week), test: schema.testWeek === at.week, sessions, adjustments, strip,
    }
  }

  private logMap(rows: SetRow[]): Map<string, SetLog> {
    return new Map(rows.map((r) => [`${r.item_id}:${r.set_index}`, { id: r.id, reps: r.reps, weight: r.weight, seconds: r.seconds, done: true }]))
  }

  /** Monday to Sunday around the date: what each day has, and whether it's done. */
  private strip(plan: ActivePlan, date: string): TrainingDay['strip'] {
    const monday = addDays(date, 1 - weekdayOf(date))
    const sunday = addDays(monday, 6)
    const logged = new Map<string, Set<string>>()
    for (const r of this.s.setsBetween!.all(plan.id, monday, sunday) as unknown as SetRow[]) {
      if (!logged.has(r.date)) logged.set(r.date, new Set())
      logged.get(r.date)!.add(`${r.item_id}:${r.set_index}`)
    }
    const lifts = this.liftMap()
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i)
      const done = logged.get(d) ?? new Set<string>()
      const sessions = this.sessionsFor(plan, d).map(({ session: s, week }) => {
        const keysOf = (items: TrainingItem[]): string[] => items.flatMap((item) => {
          const planned = hasSets(item) ? this.plan(item, week, plan.schema, lifts) ?? [] : [null]
          return planned.map((_, k) => `${item.id}:${k}`)
        })
        const all = keysOf(s.items)
        const required = keysOf(s.items.filter((i) => !i.optional))
        const counted = required.length ? required : all
        const hits = all.filter((k) => done.has(k)).length
        const finished = counted.length > 0 && (required.length ? counted.every((k) => done.has(k)) : hits > 0)
        return { id: s.id, title: s.title, kind: s.kind, done: finished, started: hits > 0, ...(s.optional ? { optional: true } : {}) }
      })
      return { date: d, sessions }
    })
  }

  // --- logging ---------------------------------------------------------------

  /** Where an item sits on a date in the active schema (moves and stand-ins included), or a 400 if it isn't on that day. */
  private locate(date: unknown, itemId: unknown): { id: string; schema: TrainingSchema; week: number; session: TrainingSession; item: TrainingItem; date: string } {
    if (typeof date !== 'string' || !isDateString(date)) throw new ValidationError('date must be YYYY-MM-DD')
    const plan = this.activePlan()
    if (!plan) throw new ValidationError('no training schema is active')
    const planned = this.sessionsFor(plan, date)
    if (!planned.length && !weekOf(plan.schema, date, plan.repeats)) throw new ValidationError('that day is outside the active schema')
    for (const { session, week } of planned) {
      const item = session.items.find((i) => i.id === itemId)
      if (item) return { id: plan.id, schema: plan.schema, week, session, item, date }
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

  // --- the coach's changes and the chat --------------------------------------

  /** Run `change`, read what it did, then roll it all back: how a proposal is previewed without saving anything. */
  trial<T>(change: () => void, read: () => T): T {
    this.db.exec('BEGIN')
    try {
      change()
      return read()
    } finally {
      this.db.exec('ROLLBACK')
    }
  }

  addOverrides(schemaId: string, edits: OverrideEdit[], messageId: string | null): void {
    const now = Date.now()
    edits.forEach((e, i) => {
      const [from, to] = e.op === 'skip' ? [e.date, e.date] : e.op === 'move' ? [e.from < e.to ? e.from : e.to, e.from < e.to ? e.to : e.from] : [e.from, e.to]
      this.s.insertOverride!.run(randomUUID(), schemaId, e.op, JSON.stringify(e), from, to, messageId, now + i)
    })
  }

  removeOverride(id: string): void {
    if (this.s.deleteOverride!.run(id).changes === 0) throw new ValidationError('no such change')
  }

  /** Give a schema a new body, keeping the old one to undo to. */
  revise(schemaId: string, next: TrainingSchema, reason: string, messageId: string | null): void {
    const row = this.row(schemaId)
    const schema = this.validate(next)
    this.s.insertRevision!.run(randomUUID(), schemaId, row.body, reason, messageId, Date.now())
    this.s.updateBody!.run(JSON.stringify(schema), schema.name, schemaId)
    for (const l of schema.lifts) this.s.upsertLift!.run(l.id, l.name, l.increment)
  }

  /** Take back what a chat message changed: its one-off changes, and its revision if it's the latest. */
  undoMessage(messageId: string): void {
    const rev = this.s.revisionOf!.get(messageId) as unknown as RevisionRow | undefined
    if (rev) {
      const last = this.s.lastRevision!.get(rev.schema_id) as unknown as RevisionRow
      if (last.id !== rev.id) throw new ValidationError('a later change to the plan came after this one; undo that first')
      this.s.updateBody!.run(rev.body, (JSON.parse(rev.body) as TrainingSchema).name, rev.schema_id)
      this.s.deleteRevision!.run(rev.id)
    }
    this.s.deleteOverridesOf!.run(messageId)
    // A rewrite still waiting as a draft goes too.
    for (const row of this.s.schemas!.all() as unknown as SchemaRow[]) {
      if (row.status === 'draft' && row.rewrite && (JSON.parse(row.rewrite) as { messageId: string | null }).messageId === messageId) this.s.deleteSchema!.run(row.id)
    }
  }

  messages(schemaId: string): CoachMessage[] {
    return (this.s.chatOf!.all(schemaId) as unknown as ChatRow[]).map((r) => ({
      id: r.id, role: r.role, text: r.text, proposal: r.proposal ? JSON.parse(r.proposal) as PlanProposal : null,
      status: r.status, note: r.note, createdAt: r.created_at,
    }))
  }

  message(id: string): CoachMessage & { schemaId: string } {
    const r = this.s.chatMessage!.get(id) as unknown as ChatRow | undefined
    if (!r) throw new ValidationError('no such message')
    return { id: r.id, role: r.role, text: r.text, proposal: r.proposal ? JSON.parse(r.proposal) as PlanProposal : null, status: r.status, note: r.note, createdAt: r.created_at, schemaId: r.schema_id }
  }

  addMessage(schemaId: string, role: 'user' | 'assistant', text: string, proposal: PlanProposal | null = null, note: string | null = null): string {
    const id = randomUUID()
    // One change waiting at a time: a new proposal sets aside the last one.
    if (proposal) this.s.supersede!.run(schemaId)
    this.s.insertChat!.run(id, schemaId, role, text, proposal ? JSON.stringify(proposal) : null, proposal ? 'proposed' : null, note, Date.now())
    return id
  }

  setMessage(id: string, status: CoachMessage['status'], note: string | null = null): void {
    this.s.updateChat!.run(status, note, id)
  }

  clearChat(schemaId: string): void {
    this.s.clearChat!.run(schemaId)
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
  report(id: string, today = localDate(), since?: string): string {
    const row = this.row(id)
    const { schema, repeats } = this.parse(row)
    const plan: ActivePlan = { id, schema, repeats, summary: this.summary(row), overrides: this.overrides(id) }
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
    const liftLines = new Map<string, { name: string; lift: string; lines: string[] }>()
    const counts = new Map<string, { name: string; planned: number; done: number }>()
    const sessionCounts = new Map<string, { title: string; planned: number; done: number }>()
    const first = since && since > schema.startDate ? since : schema.startDate
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const at = weekOf(schema, d, repeats)
      for (const { session, week } of this.sessionsFor(plan, d)) {
        const sc = sessionCounts.get(session.id) ?? { title: session.title, planned: 0, done: 0 }
        sc.planned++
        let sessionDone = false
        for (const item of session.items) {
          const c = counts.get(item.id) ?? { name: item.name, planned: 0, done: 0 }
          c.planned++
          const planned = hasSets(item) ? this.plan(item, week, schema, lifts, this.factorOn(plan, d, item.lift)) ?? [] : [null]
          const done = planned.map((_, k) => logged.get(`${d}|${item.id}|${k}`)).filter((r): r is SetRow => Boolean(r))
          if (done.length) { c.done++; sessionDone = true }
          counts.set(item.id, c)
          if (item.lift && planned[0]) {
            const lifted = done.filter((r) => r.weight !== null)
            const top = lifted.reduce<SetRow | null>((best, r) => (!best || r.weight! > best.weight! ? r : best), null)
            const off = lifted.filter((r) => planned[r.set_index]?.weight != null && r.weight !== planned[r.set_index]!.weight)
            const entry = liftLines.get(item.id) ?? { name: item.name, lift: item.lift, lines: [] }
            const list = entry.lines
            list.push(`  week ${week}${at?.repeat ? ' (repeat)' : ''} ${d}: planned ${describe(planned as PlannedSet[])}; done ${done.length}/${planned.length} sets${top ? `, top ${top.weight}×${top.reps ?? '?'}` : ''}${off.length ? `, ${off.length} set(s) at a different weight than planned` : ''}`)
            liftLines.set(item.id, entry)
          }
        }
        if (sessionDone) sc.done++
        sessionCounts.set(session.id, sc)
      }
    }
    for (const { name, lift, lines: list } of liftLines.values()) lines.push(`${name} (${lift}):`, ...list)
    lines.push('Sessions done of planned:', ...[...sessionCounts.values()].map((s) => `  ${s.title}: ${s.done}/${s.planned}`))
    lines.push('Items done of planned:', ...[...counts.values()].map((c) => `  ${c.name}: ${c.done}/${c.planned}`))
    const wods = (this.s.sessionsOf!.all(id) as unknown as SessionRow[]).filter((r) => r.wod_id).map((r) => findWod(r.wod_id!, schema.wods)?.name ?? r.wod_id)
    lines.push(`WODs picked: ${wods.length ? wods.join(', ') : 'none'}.`)
    // What the person told the coach, and what was changed: the next schema should know the shoulder flared up in week 5.
    if (plan.overrides.length) {
      lines.push('One-off changes made with the coach:', ...plan.overrides.map(({ edit }) => `  ${overrideText(edit)}`))
    }
    const said = (this.s.chatOf!.all(id) as unknown as ChatRow[]).filter((m) => m.role === 'user').slice(-20)
    if (said.length) lines.push('What the person told the coach:', ...said.map((m) => `  ${localDate(new Date(m.created_at))}: ${m.text.slice(0, 300)}`))
    return lines.join('\n')
  }
}
