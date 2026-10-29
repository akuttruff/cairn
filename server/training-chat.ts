import { chatText, chooseModel, extractJson } from './research.ts'
import { describeGear, shortDate } from './store/training.ts'
import type { ActivePlan, TrainingStore } from './store/training.ts'
import { BANK_OPS, OVERRIDE_OPS, RECORD_OPS, REVISION_OPS } from '../src/types.ts'
import type { CoachMessage, CoachStats, CoachStatus, Equipment, Place, PlanEdit, PlanProposal, Settings, TrainingSchema } from '../src/types.ts'
import type { ChatProgress } from './research.ts'
import { addDays, daysBetween, isDateString } from '../src/lib/nutrition.ts'
import { cleanEquipment, cleanItemIn, cleanSchema } from '../src/lib/training/schema.ts'
import { isRevision, reviseSchema } from '../src/lib/training/edits.ts'
import type { OverrideEdit, RevisionEdit } from '../src/lib/training/edits.ts'
import { weekOf, weekSequence } from '../src/lib/training/resolve.ts'
import { MOVEMENTS } from '../src/lib/training/movements.ts'
import { findWod, viewWod } from '../src/lib/training/bank.ts'
import { WOD_BANK } from '../src/lib/training/wods.ts'
import { outline } from './training-gen.ts'

/**
 * The training coach: a conversation about the plan with the local model.
 * It answers questions and gives feedback, and when asked for a change it
 * proposes typed edits -- one-off changes for some days, lasting changes
 * from a week on, or a rewrite of the rest of the plan. The code checks
 * every edit and works out what it would do by trying it and rolling it
 * back; nothing changes until the person applies it.
 */

export const COACH_TIMEOUT_MS = 5 * 60_000
/** Room for a model that thinks before it answers (the big Qwen can't be told not to). */
export const COACH_MAX_TOKENS = 12_000
/** How far ahead the coach sees the plan day by day. */
const AHEAD_DAYS = 14
const BEHIND_DAYS = 7
/** The longest a one-off change can run. */
const MAX_RANGE_DAYS = 42
const HISTORY = 12

export const EDIT_SPEC = `Edits (only when the person wants the plan changed; otherwise "edits": []):
One-off changes for some days (the plan itself stays as it is):
  { "op": "move", "sessionId": id, "from": date, "to": date }          do a session on another day
  { "op": "skip", "date": date, "sessionId"?: id }                      skip one session, or the whole day
  { "op": "load", "from": date, "to": date, "factor": 0.5-1.2, "lifts"?: [lift ids] }   lighter or heavier weights
  { "op": "swap", "from": date, "to": date, "itemId": id, "item": Item }   a stand-in for an item over some days
  { "op": "equipment", "from": date, "to": date, "equipment": { "gear": [...], "dumbbells": [lb], "kettlebells": [lb] } }   traveling
Lasting changes to the plan from a week on (fromWeek defaults to the current week; an earlier week corrects what has already happened):
  { "op": "setWeeks", "itemId": id, "weeks": { "<week>": sets, ... } }   NEW SETS OR WEIGHTS FOR AN ITEM: the way to change reps, sets or weights.
      Give only the weeks that change; the item's other weeks stay as they are. Past weeks can be corrected too.
      e.g. today 3x5 at 35 and building from there:  { "op": "setWeeks", "itemId": "overhead-squat-wed", "weeks": { "0": "3x5@35", "1": "4x5@40", "2": "4x5@45" } }
  { "op": "replaceItem", "itemId": id, "item": Item, "fromWeek"?: n }   a different exercise in its place (keep its "lift" as it was unless that changes too)
  { "op": "addItem", "sessionId": id, "item": Item, "fromWeek"?: n, "toWeek"?: n }
  { "op": "removeItem", "itemId": id, "fromWeek"?: n }
  { "op": "addSession", "weekday": 1-7 (7 = Sunday), "session": { "id", "title", "kind", "items": [Item] }, "fromWeek"?: n, "toWeek"?: n }
      toWeek ends an addition: toWeek = fromWeek adds it for that one week only (a session done once); without it, it runs to the end of the plan.
      A session's title says what's in it, the way the plan's do ("Back squat + deadlift", "Strict press") -- never "Strength session" or "Workout".
  { "op": "removeSession", "sessionId": id, "fromWeek"?: n }
  { "op": "moveSession", "sessionId": id, "toWeekday": 1-7, "fromWeek"?: n }
  { "op": "renameSession", "sessionId": id, "title": "Overhead squat", "fromWeek"?: n, "toWeek"?: n }   a session's name, when what's in it has changed;
      with no weeks, for every week; with them, only those weeks (a session whose items differ in some weeks)
  { "op": "setOptional", "sessionId"?: id, "itemId"?: id, "optional": true | false }   nice to do, not needed for the day to count as done
Changes to the RECORD -- what was logged -- not the plan (use these to untick or tick off what was done):
  { "op": "removeWorkout", "workoutId": id }            take a workout off the Workouts card (and untick its session, if it came from one)
  { "op": "unlogSession", "date": date, "sessionId": id }   untick a session that was ticked off by mistake
  { "op": "logSession", "date": date, "sessionId": id }     tick a whole session off as done
The WOD bank and where the gear is:
  { "op": "addWod", "wod": Wod }        a new WOD for the bank (Wod as below, movements from the movement ids)
  { "op": "hideWod", "wodId": id }      take a bank WOD out of the picks;  { "op": "showWod", "wodId": id } brings it back
  { "op": "setPlaces", "places": [{ "name": "Garage", "gear": [...], "dumbbells": [lb], "kettlebells": [lb] }] }
      where the gear is, room by room: a WOD is then only offered if ONE place has everything it needs. Gear names:
      barbell, plates, bumpers, rack, dumbbells, kettlebells, pullup-bar, rings, bands, ab-mat, jump-rope, bike, rower, box.
  Wod = { "id", "name", "format": "rft"|"amrap"|"emom"|"chipper"|"ladder"|"intervals", "minutes": n, "rounds"?: n, "scheme"?: [21,15,9],
          "text"?: string, "parts": [{ "move": movement id, "amount"?: n, "weight"?: lb }] }
A rewrite of the rest of the plan, when the person asks for one or for something bigger than a few edits:
  { "op": "rewrite", "instruction": "what to change, in a sentence or two", "fromWeek": n }   (alone, no other edits)
Sets are written the way the plan reads them: "3x5@35" is 3 sets of 5 at 35 lb, "5@35, 5@40, 3@45" lists them one by one,
  "3x5@70%" is 70% of the lift's PR (needs a "lift"), "4x10" has no weight, "3x30s" is held for seconds, "max" is as many as possible.
Item = { "id": new unique id, "name", "lift"?: lift id, "notes"?, "onlyWeeks"?: [from, to], and exactly one of:
  "sets": "3x5@35"                                   the same sets every week
  "weeks": { "0": "3x5@35", "1": "4x5@40", ... }     sets that change week to week (a week left out has none)
  "progression": {...} as in the schema, "minutes": { "<week>": n }, "wod": { "maxMinutes": n, "focus"?: [focus tags] }, "check": true }
  An item has only these fields; anything else is an error.
  WOD focus tags are ONLY "upper" (pulling and pushing: pull-ups, ring rows, push-ups, presses), "legs", "full", "bike", "core";
  a slot is offered WODs that use those. To change a slot's focus, replaceItem it with the same item and the new "wod".
Dates are YYYY-MM-DD, any day of the plan -- past days too, when the person wants the record to match what they actually did.
Use only the session ids, item ids and lift ids shown.`

/** Words a model reaches for in place of the WOD focus tags. */
const FOCUS_ALIASES: Record<string, string> = {
  pull: 'upper', pulling: 'upper', push: 'upper', pushing: 'upper', gymnastics: 'upper', arms: 'upper', back: 'upper', shoulders: 'upper', chest: 'upper',
  leg: 'legs', lower: 'legs', squat: 'legs', squats: 'legs', 'full-body': 'full', 'full body': 'full', fullbody: 'full',
  cardio: 'bike', engine: 'bike', conditioning: 'bike', abs: 'core', midline: 'core',
}

/** A WOD slot's focus in the tags the schema knows: "pull" read as "upper", duplicates dropped. */
function tidyFocus(item: unknown): void {
  const wod = (item as { wod?: { focus?: unknown } } | null)?.wod
  if (!wod || !Array.isArray(wod.focus)) return
  wod.focus = [...new Set(wod.focus.map((f) => (typeof f === 'string' ? FOCUS_ALIASES[f.trim().toLowerCase()] ?? f.trim().toLowerCase() : f)))]
}

/** "reps" and "weight" written on the item itself, as one group of sets: read as its sets, the short way. */
function tidySets(item: unknown): void {
  const o = item as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || (o.sets !== undefined && typeof o.sets !== 'number') || o.weeks !== undefined || o.progression !== undefined) return
  const reps = o.reps
  if (typeof reps !== 'number' && reps !== 'max') return
  const count = typeof o.sets === 'number' ? o.sets : typeof o.setCount === 'number' ? o.setCount : 1
  const weight = typeof o.weight === 'number' ? `@${o.weight}` : ''
  o.sets = `${count}x${reps}${weight}`
  delete o.reps
  delete o.weight
  delete o.setCount
}

/** The model's edits, tidied: `type` read as `op`, WOD focus words read as tags, and anything that isn't an object dropped. */
function normalize(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e) => e && typeof e === 'object').map((e) => {
    const o = { ...(e as Record<string, unknown>) }
    if (typeof o.op !== 'string' && typeof o.type === 'string') o.op = o.type
    delete o.type
    tidyFocus(o.item)
    tidySets(o.item)
    const session = o.session as { items?: unknown[] } | undefined
    if (Array.isArray(session?.items)) session.items.forEach((i) => { tidyFocus(i); tidySets(i) })
    return o as unknown as PlanEdit
  })
}

type RecordEdit = Extract<PlanEdit, { op: (typeof RECORD_OPS)[number] }>

/** Titles that say a session happens but not what's in it. */
const GENERIC_TITLE = /^(?:(?:extra|new|another|bonus|make-?up|short|quick)\s+)?(?:strength|lifting|weights?|training|workout|session|exercise|conditioning|cardio)(?:\s+(?:session|workout|day|block))?$|^$/i
type BankEdit = Extract<PlanEdit, { op: 'addWod' | 'hideWod' | 'showWod' }>

interface Checked { places: Place[] | null; bank: BankEdit[]; records: RecordEdit[]; overrides: OverrideEdit[]; revisions: RevisionEdit[]; rewrite: Extract<PlanEdit, { op: 'rewrite' }> | null; revised: TrainingSchema | null; errors: string[] }

/** Every edit checked against the plan as it stands; readable errors for the model when anything's off. */
export function checkEdits(training: TrainingStore, plan: ActivePlan, edits: PlanEdit[], today: string, settings: Settings): Checked {
  const errors: string[] = []
  const out: Checked = { places: null, bank: [], records: [], overrides: [], revisions: [], rewrite: null, revised: null, errors }
  const ctx = { kinds: settings.workoutKinds.map((k) => k.id), equipment: settings.equipment }
  const end = plan.summary.endDate
  // Any day of the plan, past ones too: the record should match what was actually done.
  const inPlan = (d: unknown): d is string => typeof d === 'string' && isDateString(d) && d >= plan.schema.startDate && d <= end
  const where = (i: number, e: PlanEdit): string => `edit ${i + 1} (${e.op})`
  const itemIds = new Set(plan.schema.days.flatMap((d) => d.sessions.flatMap((s) => s.items.map((i) => i.id))))
  const current = weekOf(plan.schema, today, plan.repeats)?.week ?? plan.schema.firstWeek

  edits.forEach((e, i) => {
    const w = where(i, e)
    const ops: string[] = [...OVERRIDE_OPS, ...REVISION_OPS, ...RECORD_OPS, ...BANK_OPS, 'rewrite']
    if (!e || typeof e.op !== 'string' || !ops.includes(e.op)) {
      errors.push(`edit ${i + 1}: op must be one of ${ops.join(', ')}`)
      return
    }
    if (e.op === 'rewrite') {
      if (edits.length > 1) errors.push(`${w}: a rewrite goes alone, with no other edits`)
      if (typeof e.instruction !== 'string' || !e.instruction.trim()) errors.push(`${w}: instruction says what to change`)
      if (!Number.isInteger(e.fromWeek) || e.fromWeek < plan.schema.firstWeek || e.fromWeek > plan.schema.weeks) errors.push(`${w}: fromWeek must be from ${plan.schema.firstWeek} to ${plan.schema.weeks}`)
      else out.rewrite = { op: 'rewrite', instruction: e.instruction.trim().slice(0, 500), fromWeek: e.fromWeek }
      return
    }
    if (isRevision(e)) {
      // Named by what's in it, like the plan's sessions, so the week reads the same way throughout.
      const title = e.op === 'addSession' ? e.session?.title : e.op === 'renameSession' ? e.title : undefined
      if (title !== undefined && GENERIC_TITLE.test(title?.trim() ?? '')) {
        errors.push(`${w}: title "${title}" says nothing -- name the session by what's in it, e.g. "Back squat + deadlift"`)
        return
      }
      out.revisions.push(e)
      return
    }
    if (e.op === 'setPlaces') {
      const cleaned = cleanEquipment({ places: e.places })
      if (!cleaned.places?.length) errors.push(`${w}: places needs at least one place with gear in it`)
      else out.places = cleaned.places
      return
    }
    if (e.op === 'addWod' || e.op === 'hideWod' || e.op === 'showWod') { out.bank.push(e); return }
    if (e.op === 'removeWorkout') {
      if (typeof e.workoutId !== 'string' || !training.workoutDate(e.workoutId)) errors.push(`${w}: there's no logged workout "${e.workoutId}"`)
      else out.records.push({ op: 'removeWorkout', workoutId: e.workoutId })
      return
    }
    if (e.op === 'unlogSession' || e.op === 'logSession') {
      if (!inPlan(e.date)) { errors.push(`${w}: date must be within the plan, ${plan.schema.startDate} to ${end}`); return }
      if (!training.planOf(plan, e.date).some((s) => s.id === e.sessionId)) { errors.push(`${w}: there's no session "${e.sessionId}" on ${e.date}`); return }
      out.records.push({ op: e.op, date: e.date, sessionId: e.sessionId })
      return
    }
    const range = (from: unknown, to: unknown): boolean => {
      if (!inPlan(from) || !inPlan(to)) { errors.push(`${w}: dates must be within the plan, ${plan.schema.startDate} to ${end}`); return false }
      if (to < from) { errors.push(`${w}: "to" is before "from"`); return false }
      if (daysBetween(from, to) > MAX_RANGE_DAYS) { errors.push(`${w}: at most ${MAX_RANGE_DAYS} days; for longer, change the plan itself`); return false }
      return true
    }
    switch (e.op) {
      case 'move': {
        if (!inPlan(e.from) || !inPlan(e.to) || e.from === e.to) { errors.push(`${w}: from and to must be two different days within the plan`); return }
        if (!training.planOf(plan, e.from).some((s) => s.id === e.sessionId)) { errors.push(`${w}: there's no session "${e.sessionId}" on ${e.from}`); return }
        out.overrides.push({ op: 'move', sessionId: e.sessionId, from: e.from, to: e.to })
        return
      }
      case 'skip': {
        if (!inPlan(e.date)) { errors.push(`${w}: date must be within the plan, ${plan.schema.startDate} to ${end}`); return }
        if (e.sessionId && !training.planOf(plan, e.date).some((s) => s.id === e.sessionId)) { errors.push(`${w}: there's no session "${e.sessionId}" on ${e.date}`); return }
        out.overrides.push({ op: 'skip', date: e.date, ...(e.sessionId ? { sessionId: e.sessionId } : {}) })
        return
      }
      case 'load': {
        if (!range(e.from, e.to)) return
        if (typeof e.factor !== 'number' || e.factor < 0.5 || e.factor > 1.2) { errors.push(`${w}: factor must be 0.5 to 1.2 (0.9 is 10% lighter)`); return }
        const unknown = (e.lifts ?? []).filter((l) => !plan.schema.lifts.some((x) => x.id === l))
        if (unknown.length) { errors.push(`${w}: unknown lifts ${unknown.join(', ')}; the lifts are ${plan.schema.lifts.map((l) => l.id).join(', ')}`); return }
        out.overrides.push({ op: 'load', from: e.from, to: e.to, factor: Math.round(e.factor * 100) / 100, ...(e.lifts?.length ? { lifts: e.lifts } : {}) })
        return
      }
      case 'swap': {
        if (!range(e.from, e.to)) return
        if (!itemIds.has(e.itemId)) { errors.push(`${w}: there's no item "${e.itemId}"`); return }
        const raw = e.item && typeof e.item === 'object' ? { ...e.item } : e.item
        if (raw && typeof raw === 'object' && (!raw.id || itemIds.has(raw.id))) raw.id = `${e.itemId}-swap-${e.from}`.slice(0, 40)
        const { item, errors: bad } = cleanItemIn(raw, plan.schema, ctx)
        if (!item) { errors.push(...bad.map((b) => `${w}: ${b}`)); return }
        out.overrides.push({ op: 'swap', from: e.from, to: e.to, itemId: e.itemId, item })
        return
      }
      case 'equipment': {
        if (!range(e.from, e.to)) return
        out.overrides.push({ op: 'equipment', from: e.from, to: e.to, equipment: cleanEquipment(e.equipment) })
        return
      }
    }
  })
  // With new places, the schema (its WOD slots, new WODs) is checked against them.
  const gear: Equipment = out.places ? cleanEquipment({ places: out.places }) : ctx.equipment
  if (out.revisions.length || out.bank.length) {
    const { schema, errors: bad } = reviseSchema(plan.schema, out.revisions, current)
    errors.push(...bad)
    for (const b of out.bank) {
      if (b.op === 'addWod') {
        if (!b.wod || typeof b.wod !== 'object') { errors.push('addWod: needs a wod'); continue }
        if (findWod(b.wod.id, schema.wods)) { errors.push(`addWod: there's already a WOD "${b.wod.id}"`); continue }
        schema.wods = [...(schema.wods ?? []), b.wod]
      } else if (!findWod(b.wodId, schema.wods)) errors.push(`${b.op}: there's no WOD "${b.wodId}"`)
      else if (b.op === 'hideWod') schema.hiddenWods = [...new Set([...(schema.hiddenWods ?? []), b.wodId])]
      else schema.hiddenWods = (schema.hiddenWods ?? []).filter((x) => x !== b.wodId)
    }
    if (!errors.length) {
      const whole = cleanSchema(schema, { ...ctx, equipment: gear })
      if (whole.schema) out.revised = whole.schema
      else errors.push(...whole.errors.map((x) => `after the changes: ${x}`))
    }
  }
  return out
}

type DayPlan = ReturnType<TrainingStore['planOf']>

/**
 * What the edits would do, in lines: the affected days resolved before and
 * after (the after inside a transaction that's rolled back), then compared
 * session by session and item by item.
 */
export function previewEdits(training: TrainingStore, plan: ActivePlan, checked: Checked, today: string): string[] {
  if (checked.rewrite) return [`Rewrite the plan from week ${checked.rewrite.fromWeek}: ${checked.rewrite.instruction}`]
  // Changes to the record say what they do directly; there's no plan to compare.
  const recordLines = checked.records.map((e) => {
    if (e.op === 'removeWorkout') {
      const date = training.workoutDate(e.workoutId)!
      const w = training.recordOf(plan, date).workouts.find((x) => x.id === e.workoutId)
      const what = `${w?.kind ?? 'a'} workout${w?.note ? ` "${w.note}"` : ''}`
      return `${shortDate(date)}: remove the ${what} from the Workouts card${w?.session ? ', and untick its session' : ''}`
    }
    const title = training.planOf(plan, e.date).find((s) => s.id === e.sessionId)?.title ?? e.sessionId
    return `${shortDate(e.date)}: ${e.op === 'logSession' ? 'tick off' : 'untick'} ${title}`
  })
  // The bank and the places say what they do directly too.
  const gear: Equipment = checked.places ? cleanEquipment({ places: checked.places }) : training.equipmentOn(null, today)
  const bankLines = [
    ...(checked.places ?? []).map((p) => `${p.name}: ${describeGear({ ...p, places: undefined })}`),
    ...checked.bank.map((b) => {
      if (b.op === 'addWod') {
        const v = viewWod(b.wod, gear)
        return `+ WOD ${b.wod.name}: ${v ? `${v.heading}, ${v.lines.join(', ')}${v.place ? ` (${v.place})` : ''}` : b.wod.name}`
      }
      const name = findWod(b.wodId, plan.schema.wods)?.name ?? b.wodId
      return b.op === 'hideWod' ? `No more ${name} in the WOD picks` : `${name} back in the WOD picks`
    }),
  ]
  const planChanged = checked.overrides.length > 0 || checked.revisions.length > 0
  if (!planChanged) return [...bankLines, ...recordLines]
  const dates = new Set<string>()
  const span = (from: string, to: string): void => { for (let d = from; d <= to && dates.size < 120; d = addDays(d, 1)) dates.add(d) }
  for (const e of checked.overrides) {
    if (e.op === 'move') { dates.add(e.from); dates.add(e.to) }
    else if (e.op === 'skip') dates.add(e.date)
    else span(e.from, e.to)
  }
  if (checked.revised) {
    // From the earliest week a lasting change starts (this week unless it says), four weeks on.
    const current = weekOf(plan.schema, today, plan.repeats)?.week ?? plan.schema.firstWeek
    // New sets start at the first week they change; the rest from their week, this one unless they say.
    const week = Math.min(...checked.revisions.map((r) => (r.op === 'setWeeks' ? Math.min(...Object.keys(r.weeks).map(Number)) : r.fromWeek ?? current)))
    const index = weekSequence(plan.schema, plan.repeats).indexOf(week)
    const from = index >= 0 ? addDays(plan.schema.startDate, index * 7) : today
    span(from, addDays(from, 27))
  }
  const sorted = [...dates].filter((d) => d <= plan.summary.endDate).sort()
  const before = new Map(sorted.map((d) => [d, training.planOf(plan, d)]))
  const after = training.trial(() => {
    if (checked.overrides.length) training.addOverrides(plan.id, checked.overrides, null)
    if (checked.revised) training.revise(plan.id, checked.revised, 'preview', null)
  }, () => {
    const next = training.activePlan()!
    return new Map(sorted.map((d) => [d, training.planOf(next, d)]))
  })

  const lines: string[] = []
  // Optional or not holds for every week, so it reads once, without dates.
  const nowOptional = new Set<string>()
  const nowRequired = new Set<string>()
  const renamed = new Set<string>()
  const gone = new Map<string, { date: string; title: string }>()
  const added = new Map<string, { date: string; session: DayPlan[number] }>()
  for (const d of sorted) {
    const was = before.get(d) ?? []
    const now = after.get(d) ?? []
    for (const s of was) if (!now.some((x) => x.id === s.id)) gone.set(`${s.id}|${d}`, { date: d, title: s.title })
    for (const s of now) if (!was.some((x) => x.id === s.id)) added.set(`${s.id}|${d}`, { date: d, session: s })
    for (const s of now) {
      const old = was.find((x) => x.id === s.id)
      if (!old) continue
      if (old.optional !== s.optional) (s.optional ? nowOptional : nowRequired).add(s.title)
      if (old.title !== s.title) renamed.add(`Renamed: ${old.title} → ${s.title}`)
      for (const i of s.items) {
        const o = old.items.find((x) => x.id === i.id)
        if (o && o.optional !== i.optional) (i.optional ? nowOptional : nowRequired).add(i.name)
      }
      const removed = old.items.filter((i) => !s.items.some((x) => x.id === i.id))
      const fresh = s.items.filter((i) => !old.items.some((x) => x.id === i.id))
      for (const i of s.items) {
        const o = old.items.find((x) => x.id === i.id)
        if (o && o.text !== i.text) lines.push(`${shortDate(d)} · ${i.name}: ${o.text} → ${i.text}`)
      }
      // A removed item and a new one in the same session read as one swapped for the other.
      removed.forEach((r, k) => {
        const n = fresh[k]
        lines.push(n ? `${shortDate(d)} · ${r.name} ${r.text} → ${n.name} ${n.text}` : `${shortDate(d)} · no ${r.name}`)
      })
      fresh.slice(removed.length).forEach((n) => lines.push(`${shortDate(d)} · + ${n.name} ${n.text}`))
    }
  }
  // A session gone from one day and arrived on another moved.
  for (const [key, g] of gone) {
    const id = key.split('|')[0]!
    const arrival = [...added.entries()].find(([k]) => k.split('|')[0] === id)
    if (arrival) {
      lines.push(`${shortDate(g.date)} → ${shortDate(arrival[1].date)}: ${g.title}`)
      added.delete(arrival[0])
    } else lines.push(`${shortDate(g.date)}: no ${g.title}`)
  }
  for (const { date, session } of added.values()) lines.push(`${shortDate(date)}: + ${session.title} (${session.items.map((i) => i.name).join(', ')})`)
  lines.push(...renamed)
  if (nowOptional.size) lines.push(`Optional from now on: ${[...nowOptional].join(', ')}`)
  if (nowRequired.size) lines.push(`Part of the day again: ${[...nowRequired].join(', ')}`)
  for (const e of checked.overrides) if (e.op === 'equipment') lines.push(`${shortDate(e.from)}–${shortDate(e.to)}: WODs for ${describeGear(e.equipment)}`)
  // The same change on several days reads once: "Sun, Dec 13, Dec 20: + Easy Sunday run".
  const grouped = new Map<string, string[]>()
  const plain: string[] = []
  for (const l of lines) {
    const m = /^(\w{3}, \w{3} \d{1,2})( · |: )(.*)$/.exec(l)
    if (!m) { plain.push(l); continue }
    const key = `${m[2]}${m[3]}`
    grouped.set(key, [...(grouped.get(key) ?? []), m[1]!])
  }
  const joinDates = (ds: string[]): string => (ds.length > 4 ? `From ${ds[0]} (${ds.length} days)` : ds.map((d, i) => (i === 0 ? d : d.replace(/^\w{3}, /, ''))).join(', '))
  const unique = [...new Set([...bankLines, ...recordLines, ...[...grouped].map(([key, ds]) => `${joinDates(ds)}${key}`), ...plain])]
  return unique.length > 14 ? [...unique.slice(0, 14), `…and ${unique.length - 14} more`] : unique
}

/** The plan as the coach sees it: today, the days ahead in detail, the whole schema in outline, how it's gone. */
export function coachContext(training: TrainingStore, plan: ActivePlan, today: string, settings: Settings): string {
  const at = weekOf(plan.schema, today, plan.repeats)
  const lifts = training.lifts()
  const ahead: string[] = []
  // The last week too, so a past day can be put right.
  for (let i = -BEHIND_DAYS; i < AHEAD_DAYS; i++) {
    const d = addDays(today, i)
    if (d < plan.schema.startDate) continue
    if (d > plan.summary.endDate) break
    const sessions = training.planOf(plan, d)
    const wk = weekOf(plan.schema, d, plan.repeats)?.week
    ahead.push(`${shortDate(d)} ${d}${d === today ? ' (TODAY)' : ''}${wk !== undefined ? ` (week ${wk})` : ''}: ${sessions.length ? '' : 'rest'}`)
    const record = d <= today ? training.recordOf(plan, d) : null
    for (const s of sessions) {
      const ticked = record?.sessions.find((x) => x.id === s.id)
      const state = !record ? '' : ticked?.done ? ' -- DONE' : ticked?.started ? ' -- partly done' : ' -- not done'
      ahead.push(`  session ${s.id} "${s.title}" [${s.kind}]${s.optional ? ' (optional)' : ''}${state}: ${s.items.map((i) => `${i.name} [item ${i.id}] ${i.text}`).join('; ')}`)
    }
    // What's on the Workouts card that day: these are what its counts are made of, plan or not.
    for (const w of record?.workouts ?? []) {
      ahead.push(`  logged workout [workout ${w.id}] ${w.kind}${w.note ? ` "${w.note}"` : ''} -- ${w.session ? `from session ${w.session}` : 'added by hand with the + button'}`)
    }
  }
  const changes = plan.overrides.map((o) => `  ${o.edit.op} ${JSON.stringify(o.edit)}`)
  // What changes least comes first, and today's days last: the model server reuses its reading of
  // an unchanged beginning, so a turn only has to read what's new since the last one.
  return [
    `Movement ids for WODs: ${MOVEMENTS.map((m) => m.id).join(', ')}.`,
    '',
    'The WOD bank (id: name, how it would be done with this gear):',
    ...[...(plan.schema.wods ?? []), ...WOD_BANK].map((w) => {
      const v = viewWod(w, settings.equipment)
      const hidden = plan.schema.hiddenWods?.includes(w.id) ? ' [hidden]' : ''
      return `  ${w.id}: ${w.name}${hidden} -- ${v ? `${v.minutes} min, ${v.lines.join(', ')}${v.place ? ` [${v.place}]` : ''}` : 'can\'t be done with this gear'}`
    }),
    '',
    `The plan: "${plan.schema.name}", ${plan.summary.startDate} to ${plan.summary.endDate}, weeks ${plan.schema.firstWeek}-${plan.schema.weeks}; deloads ${plan.schema.deloadWeeks.join(', ') || 'none'}; test week ${plan.schema.testWeek ?? 'none'}.`,
    plan.schema.goals ? `Its goals:\n${plan.schema.goals}` : '',
    `Activities (session kinds): ${settings.workoutKinds.map((k) => k.id).join(', ')}.`,
    settings.equipment.places?.length
      ? `Equipment, by place (a WOD is only offered if one place has all it needs):\n${settings.equipment.places.map((p) => `  ${p.name}: ${describeGear({ ...p, places: undefined })}`).join('\n')}`
      : `Equipment (all in one place): ${describeGear(settings.equipment)}.`,
    `Lifts and PRs (lb): ${lifts.map((l) => `${l.id} ${l.pr ?? '?'}`).join(', ')}.`,
    '',
    'The whole plan in outline, week by week (w0, w1...), weights at today\'s PRs, sets in the short notation setWeeks takes:',
    outline(plan.schema, new Map(lifts.map((l) => [l.id, l.pr]))),
    '',
    'How it has gone so far:',
    training.report(plan.id, today),
    '',
    `Today is ${shortDate(today)} ${today}${at ? `, week ${at.week} of ${plan.schema.weeks}${plan.schema.deloadWeeks.includes(at.week) ? ' (a deload week)' : ''}${plan.schema.testWeek === at.week ? ' (the test week)' : ''}` : ''}.`,
    `The past ${BEHIND_DAYS} days and the next ${AHEAD_DAYS}, with the ids edits use (past days show what was logged):`,
    ...ahead,
    changes.length ? `One-off changes already in place (a newer swap for the same item and day replaces an older one):\n${changes.join('\n')}` : '',
  ].filter((l) => l !== '').join('\n')
}

const SYSTEM = [
  'You are a friendly, knowledgeable strength and conditioning coach talking with one person about their home training plan.',
  'Be conversational and concise: a few sentences, plain words, no headings. Answer questions, give honest feedback on the plan and their',
  'progress when asked (what is going well, what to watch, whether the plan fits their goals), and suggest changes when they would help.',
  'Only propose edits when the person asks for a change or agrees to one; a question gets an answer and "edits": [].',
  'Be careful with pain: for sharp or lasting pain, suggest easing off that movement and seeing a professional.',
  'The gear can be split between rooms: to keep WODs to one room, set the places (setPlaces) -- slot focus tags won\'t do it.',
  'To change which WODs come up, add, hide or bring back WODs in the bank.',
  'A named benchmark WOD (Cindy, Fran, Helen, Grace...) keeps its standard prescription: check the bank list for it first, and write it exactly as the benchmark is if it isn\'t there.',
  'The plan is what is scheduled; the record is what was logged (ticked sets, and workouts on the Workouts card, some added by hand with +).',
  'The Workouts card counts logged workouts, so when a count looks wrong, look at the logged workouts listed for those days and fix the record',
  '(removeWorkout, unlogSession, logSession) -- not the plan. Read dates carefully: the day marked TODAY is today; check which day the person means.',
  'Past days can be changed too (skip, swap, move, or a lasting change from an earlier week) so the plan matches what really happened; never say you can\'t change the past.',
  'Edits are proposals: the person sees exactly what they would do and applies them, so say what you would change',
  '("I can move…", "Here is a lighter week…"), never that it is done. Describe only the edits you include.',
  'When the gear is limited (traveling), add an "equipment" edit AND swap or skip what that gear cannot do on those days: barbell lifts become',
  'dumbbell versions ("swap" with a "sets" item at a sensible fixed weight), or skip the session if nothing fits.',
  '',
  'Reply with ONLY a JSON object: { "reply": "what you say to them", "edits": [ ... ] }',
  '',
  EDIT_SPEC,
].join('\n')

export interface CoachArgs {
  training: TrainingStore
  settings: Settings
  fetchImpl: typeof fetch
  text: string
  /** A screenshot to clarify the message, as a JPEG/PNG/WebP data URL. */
  image?: string
  today: string
  signal?: AbortSignal
  /** Told what the coach is doing while it answers: loading, reading the plan, thinking, writing, checking. */
  onStatus?: (status: CoachStatus) => void
}

/** One turn of the conversation: the person's message saved, the coach's reply (and any proposal) saved after it. */
export async function coachReply({ training, settings, fetchImpl, text, image, today, signal: abort, onStatus }: CoachArgs): Promise<CoachMessage[]> {
  const plan = training.activePlan()
  if (!plan) throw new Error('There\'s no active training schema to talk about. Import one first.')
  const history = training.messages(plan.id).slice(-HISTORY)
  training.addMessage(plan.id, 'user', text, null, null, null, image ?? null)
  const signal = AbortSignal.any([AbortSignal.timeout(COACH_TIMEOUT_MS), ...(abort ? [abort] : [])])
  const startedAt = Date.now()
  let phase: CoachStatus['phase'] = 'reading'
  const report = (p: Partial<CoachStatus>): void => onStatus?.({ phase, progress: null, tokens: 0, model: null, startedAt, ...p })
  report({})
  // A screenshot needs a model that can see: the coach model if it can, else whichever vision model there is.
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal, settings.planChatModel, Boolean(image))
  // The last answer's stats, with the time for the whole turn (a retry included).
  let last: ChatProgress['stats'] | undefined
  const watch = (p: ChatProgress): void => {
    if (p.phase === 'done') { last = p.stats; return }
    report({ phase: phase === 'retrying' && p.phase !== 'writing' ? 'retrying' : p.phase, progress: p.progress, tokens: p.tokens, model })
  }
  const stats = (): CoachStats | null => (last ? { model, seconds: Math.round((Date.now() - startedAt) / 100) / 10, ...last } : null)
  const past = history.map((m) => {
    const proposal = m.proposal ? ` [proposed: ${m.proposal.preview.join('; ')} -- ${m.status}]` : ''
    // What actually happened, so a reply that claimed a change it didn't make isn't taken as done.
    const note = m.role === 'assistant' && !m.proposal && m.note ? ` [no change was made: ${m.note}]` : ''
    const shot = m.image ? ' [sent a screenshot]' : ''
    return `${m.role === 'user' ? 'Person' : 'Coach'}: ${m.text}${shot}${proposal}${note}`
  })
  const input = [coachContext(training, plan, today, settings), '', 'The conversation so far:', ...past, `Person: ${text}${image ? ' [screenshot attached: read it to understand what they mean]' : ''}`].join('\n')
  const ask = async (body: string): Promise<string> => {
    // With a screenshot, the input is the text and the picture together, as the label reader sends one.
    const req: Record<string, unknown> = {
      model, system_prompt: SYSTEM, max_output_tokens: COACH_MAX_TOKENS,
      input: image ? [{ type: 'text', content: body }, { type: 'image', data_url: image }] : body,
    }
    if (reasoning) req.reasoning = reasoning
    return chatText(settings, req, fetchImpl, signal, watch)
  }

  const read = (raw: string): { reply: string; edits: PlanEdit[] } => {
    const json = extractJson(raw) as { reply?: unknown; edits?: unknown } | null
    // A plain-text answer is still an answer: conversation needs no JSON.
    if (!json || typeof json.reply !== 'string') return { reply: raw.trim(), edits: [] }
    return { reply: json.reply.trim(), edits: normalize(json.edits) }
  }
  let raw = await ask(input)
  let { reply, edits } = read(raw)
  phase = 'checking'
  if (edits.length) report({ model })
  let checked = checkEdits(training, plan, edits, today, settings)
  if (edits.length && checked.errors.length) {
    phase = 'retrying'
    report({ model })
    raw = await ask([input, '', 'Your reply was:', raw.slice(0, 20_000), '', 'Its edits have these problems:', ...checked.errors.map((e) => `- ${e}`), '', 'Reply again with the corrected JSON.'].join('\n'))
    ;({ reply, edits } = read(raw))
    checked = checkEdits(training, plan, edits, today, settings)
  }
  if (!reply && !edits.length) {
    // Usually a thinking model that spent its whole reply on thinking.
    training.addMessage(plan.id, 'assistant', 'No answer came back that time.', null,
      `${model} didn't say anything. Try again, or choose a quicker Coach model in Settings (a mid-size one answers in seconds).`, stats())
  } else if (!edits.length) {
    training.addMessage(plan.id, 'assistant', reply, null, null, stats())
  } else if (checked.errors.length) {
    training.addMessage(plan.id, 'assistant', reply, null, `I couldn't turn that into a change to the plan (${checked.errors.slice(0, 2).join('; ')}). Try saying it another way.`, stats())
  } else {
    phase = 'checking'
    report({ model })
    const proposal: PlanProposal = { edits: checked.rewrite ? [checked.rewrite] : [...(checked.places ? [{ op: 'setPlaces' as const, places: checked.places }] : []), ...checked.overrides, ...checked.revisions, ...checked.bank, ...checked.records], preview: previewEdits(training, plan, checked, today) }
    if (!proposal.preview.length) training.addMessage(plan.id, 'assistant', reply, null, 'That wouldn\'t change anything on the plan.', stats())
    else training.addMessage(plan.id, 'assistant', reply, proposal, null, stats())
  }
  return training.messages(plan.id)
}

/**
 * Apply a proposal: one-off changes are laid over the plan, lasting ones
 * make a new revision of it. A rewrite only starts here -- `startRewrite`
 * has the training model write it, and it's reviewed as a draft.
 */
export function applyProposal(
  training: TrainingStore, messageId: string, today: string, settings: Settings,
  startRewrite: (rewrite: { instruction: string; fromWeek: number; messageId: string }) => void,
): void {
  const msg = training.message(messageId)
  if (msg.status !== 'proposed' || !msg.proposal) throw new Error('that isn\'t a change waiting to be applied')
  const plan = training.activePlan()
  if (!plan || plan.id !== msg.schemaId) throw new Error('that change was for a plan that is no longer the active one')
  // Checked again: the plan may have moved on since it was proposed.
  const checked = checkEdits(training, plan, msg.proposal.edits, today, settings)
  if (checked.errors.length) throw new Error(`The plan has changed since; ask again. (${checked.errors[0]})`)
  if (checked.rewrite) {
    startRewrite({ instruction: checked.rewrite.instruction, fromWeek: checked.rewrite.fromWeek, messageId })
    training.setMessage(messageId, 'applied', 'Writing the new plan: it takes a few minutes, then it\'s under Block to review.')
    return
  }
  // Places first: the revised schema was checked against them.
  if (checked.places) training.setEquipment(cleanEquipment({ places: checked.places }), messageId)
  if (checked.overrides.length) training.addOverrides(plan.id, checked.overrides, messageId)
  if (checked.revised) training.revise(plan.id, checked.revised, 'coach', messageId)
  for (const r of checked.records) {
    if (r.op === 'removeWorkout') training.removeWorkout(r.workoutId, messageId)
    else if (r.op === 'unlogSession') training.unlogSession(r.date, r.sessionId, messageId)
    else training.logSession(r.date, r.sessionId, messageId)
  }
  training.setMessage(messageId, 'applied')
}

export function undoProposal(training: TrainingStore, messageId: string): void {
  const msg = training.message(messageId)
  if (msg.status !== 'applied') throw new Error('that change isn\'t applied')
  training.undoMessage(messageId)
  training.setMessage(messageId, 'undone')
}
