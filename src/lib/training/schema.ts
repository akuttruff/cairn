import { GEAR, WOD_FOCUSES } from '../../types.ts'
import type {
  Equipment, Gear, Prescription, Progression, SetTarget, TrainingItem, TrainingSchema, TrainingSession, Wod, WodFocus, WodPart, WodSlot,
} from '../../types.ts'
import { isDateString } from '../nutrition.ts'
import { MOVEMENT } from './movements.ts'
import { fittingWods, viewWod } from './bank.ts'
import { prescriptionFor, weekdayOf } from './resolve.ts'

/**
 * Checking a training schema, whoever wrote it: an import, or the model.
 * Everything wrong is collected as a readable line rather than thrown at
 * the first problem, so the model can be shown the whole list and fix it in
 * one go. Returns the cleaned schema (unknown fields dropped) when there
 * were no errors.
 */

export const MAX_WEEKS = 16
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/
const WOD_FORMATS = ['rft', 'amrap', 'emom', 'chipper', 'ladder', 'intervals'] as const

export interface SchemaContext {
  /** The workout activity ids in Settings. */
  kinds: string[]
  equipment: Equipment
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min: number, max: number): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max
const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

export function cleanSchema(input: unknown, ctx: SchemaContext): { schema: TrainingSchema | null; errors: string[] } {
  const errors: string[] = []
  const err = (where: string, what: string): void => { if (errors.length < 40) errors.push(`${where}: ${what}`) }
  if (!isObj(input)) return { schema: null, errors: ['the schema must be a JSON object'] }

  if (input.schemaVersion !== 1) err('schemaVersion', 'must be 1')
  const name = text(input.name, 80)
  if (!name) err('name', 'is required')
  const startDate = typeof input.startDate === 'string' ? input.startDate : ''
  if (!isDateString(startDate) || weekdayOf(startDate) !== 1) err('startDate', 'must be a Monday, YYYY-MM-DD')
  const firstWeek = input.firstWeek ?? 1
  if (firstWeek !== 0 && firstWeek !== 1) err('firstWeek', 'must be 0 (an intro week) or 1')
  const weeks = input.weeks
  if (!isInt(weeks, 1, MAX_WEEKS)) err('weeks', `must be a whole number from 1 to ${MAX_WEEKS}`)
  const lastWeek = isInt(weeks, 1, MAX_WEEKS) ? weeks : MAX_WEEKS
  const inRange = (w: number): boolean => Number.isInteger(w) && w >= (firstWeek as number) && w <= lastWeek
  const deloadWeeks = Array.isArray(input.deloadWeeks) ? input.deloadWeeks : input.deloadWeeks === undefined ? [] : null
  if (!deloadWeeks || !deloadWeeks.every((w) => inRange(w as number))) err('deloadWeeks', `must be a list of week numbers from ${firstWeek} to ${lastWeek}`)
  const testWeek = input.testWeek
  if (testWeek !== undefined && !inRange(testWeek as number)) err('testWeek', `must be a week number from ${firstWeek} to ${lastWeek}`)

  // Lifts: what the percentages are of.
  const lifts: TrainingSchema['lifts'] = []
  if (!Array.isArray(input.lifts)) err('lifts', 'must be a list (it can be empty)')
  else input.lifts.slice(0, 12).forEach((raw, i) => {
    const where = `lifts[${i}]`
    if (!isObj(raw) || typeof raw.id !== 'string' || !ID.test(raw.id)) return err(where, 'needs an id of lowercase letters, digits, - or _')
    if (![1, 1.25, 2.5, 5, 10].includes(raw.increment as number)) err(where, 'increment must be 1, 1.25, 2.5, 5 or 10 (lb)')
    if (lifts.some((l) => l.id === raw.id)) err(where, `lift "${raw.id}" is listed twice`)
    lifts.push({ id: raw.id, name: text(raw.name, 60) ?? raw.id, increment: raw.increment as number })
  })
  const liftIds = new Set(lifts.map((l) => l.id))

  // The schema's own WODs, checked movement by movement.
  const wods: Wod[] = []
  if (input.wods !== undefined) {
    if (!Array.isArray(input.wods)) err('wods', 'must be a list')
    else input.wods.slice(0, 30).forEach((raw, i) => {
      const wod = cleanWod(raw, `wods[${i}]`, err)
      if (!wod) return
      if (!viewWod(wod, ctx.equipment)) err(`wods[${i}] (${wod.name})`, 'uses a movement the equipment on hand can\'t do or swap')
      wods.push(wod)
    })
  }

  // Bank WODs the schema leaves out, by id.
  const hiddenWods = Array.isArray(input.hiddenWods) ? input.hiddenWods.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, 100) : []
  const schemaish = { deloadWeeks: (deloadWeeks ?? []) as number[], testWeek: testWeek as number | undefined }
  // Sessions and items are looked up separately (sets by item, WOD picks by session), so each only has to be unique among its own kind.
  const ids = new Set<string>()
  const itemIds = new Set<string>()
  const days: TrainingSchema['days'] = []
  let tested = false
  if (!Array.isArray(input.days) || !input.days.length) err('days', 'must list at least one day')
  else input.days.slice(0, 7).forEach((rawDay, d) => {
    const where = `days[${d}]`
    if (!isObj(rawDay) || !isInt(rawDay.weekday, 1, 7)) return err(where, 'weekday must be 1 (Monday) to 7 (Sunday)')
    if (days.some((x) => x.weekday === rawDay.weekday)) err(where, `weekday ${rawDay.weekday} is listed twice`)
    const sessions: TrainingSession[] = []
    if (!Array.isArray(rawDay.sessions)) err(where, 'sessions must be a list')
    else rawDay.sessions.slice(0, 6).forEach((rawSession, s) => {
      const sw = `${where}.sessions[${s}]`
      if (!isObj(rawSession)) return err(sw, 'must be an object')
      const title = text(rawSession.title, 80)
      if (!title) err(sw, 'title is required')
      const sid = rawSession.id
      if (typeof sid !== 'string' || !ID.test(sid)) err(sw, 'needs an id of lowercase letters, digits, - or _')
      else if (ids.has(sid)) err(sw, `id "${sid}" is used by two sessions`)
      else ids.add(sid)
      if (typeof rawSession.kind !== 'string' || !ctx.kinds.includes(rawSession.kind)) err(sw, `kind must be one of ${ctx.kinds.join(', ')}`)
      const items: TrainingItem[] = []
      if (!Array.isArray(rawSession.items) || !rawSession.items.length) err(sw, 'items must list at least one item')
      else rawSession.items.slice(0, 20).forEach((rawItem, k) => {
        const item = cleanItem(rawItem, `${sw}.items[${k}]`)
        if (!item) return
        if (itemIds.has(item.id)) err(`${sw}.items[${k}]`, `id "${item.id}" is used by two items`)
        itemIds.add(item.id)
        items.push(item)
        if (testWeek !== undefined && (item.sets || item.weeks || item.progression)) {
          if (prescriptionFor(item, testWeek as number, schemaish)?.sets.some((x) => x.test)) tested = true
        }
      })
      let weekTitles: Record<string, string> | undefined
      if (rawSession.weekTitles !== undefined) {
        if (!isObj(rawSession.weekTitles)) err(sw, 'weekTitles must map week numbers to titles')
        else for (const [w, t] of Object.entries(rawSession.weekTitles)) {
          const name = text(t, 80)
          if (!/^\d+$/.test(w) || Number(w) > lastWeek || !name) { err(sw, `weekTitles: "${w}" must be a week from 0 to ${lastWeek} with a title`); continue }
          ;(weekTitles ??= {})[w] = name
        }
      }
      if (title && typeof sid === 'string' && typeof rawSession.kind === 'string') sessions.push({ id: sid, title, ...(weekTitles ? { weekTitles } : {}), kind: rawSession.kind, ...(rawSession.optional === true ? { optional: true } : {}), items })
    })
    days.push({ weekday: rawDay.weekday, sessions })
  })
  if (testWeek !== undefined && !tested) err('testWeek', `week ${testWeek} is a test week, but no lift is tested in it`)

  function cleanItem(raw: unknown, where: string): TrainingItem | null {
    if (!isObj(raw)) { err(where, 'must be an object'); return null }
    const name = text(raw.name, 80)
    const id = raw.id
    if (typeof id !== 'string' || !ID.test(id)) { err(where, 'needs an id of lowercase letters, digits, - or _'); return null }
    const label = `${where} (${name ?? id})`
    if (!name) err(label, 'name is required')
    const item: TrainingItem = { id, name: name ?? id }
    if (raw.optional === true) item.optional = true
    const notes = text(raw.notes, 1500)
    if (notes) item.notes = notes
    if (raw.lift !== undefined) {
      if (typeof raw.lift !== 'string' || !liftIds.has(raw.lift)) err(label, `lift must be one of the schema's lifts (${[...liftIds].join(', ') || 'none listed'})`)
      else item.lift = raw.lift
    }
    if (raw.onlyWeeks !== undefined) {
      const ow = raw.onlyWeeks
      if (!Array.isArray(ow) || ow.length !== 2 || !inRange(ow[0] as number) || !inRange(ow[1] as number) || (ow[0] as number) > (ow[1] as number)) {
        err(label, 'onlyWeeks must be [from, to] within the schema\'s weeks')
      } else item.onlyWeeks = [ow[0] as number, ow[1] as number]
    }
    const kinds = (['sets', 'weeks', 'progression', 'wod', 'check', 'minutes'] as const).filter((k) => raw[k] !== undefined)
    if (kinds.length !== 1) {
      err(label, `needs exactly one of sets, weeks, progression, wod, check or minutes${kinds.length ? ` (it has ${kinds.join(' and ')})` : ' (it has none)'}`)
      return item
    }
    const usesPct = (sets: SetTarget[]): boolean => sets.some((s) => s.pct !== undefined || s.test)
    switch (kinds[0]) {
      case 'sets': {
        const clean = cleanPrescription(raw.sets, `${label} sets`)
        if (clean) {
          if (usesPct(clean.sets) && !item.lift) err(label, 'uses percentages, so it needs a lift')
          item.sets = clean
        }
        break
      }
      case 'weeks': {
        if (!isObj(raw.weeks)) { err(label, 'weeks must map week numbers to prescriptions'); break }
        const out: Record<string, Prescription> = {}
        for (const [w, p] of Object.entries(raw.weeks)) {
          if (!inRange(Number(w))) { err(label, `week ${w} is outside the schema`); continue }
          const clean = cleanPrescription(p, `${label} week ${w}`)
          if (clean) out[String(Number(w))] = clean
        }
        if (Object.values(out).some((p) => usesPct(p.sets)) && !item.lift) err(label, 'uses percentages, so it needs a lift')
        item.weeks = out
        break
      }
      case 'progression': {
        const p = cleanProgression(raw.progression, label)
        if (p) item.progression = p
        if (!item.lift) err(label, 'a progression is in percentages, so it needs a lift')
        break
      }
      case 'wod': {
        const slot = cleanSlot(raw.wod, label)
        if (slot) {
          item.wod = slot
          if (!fittingWods(slot, ctx.equipment, wods, hiddenWods).length) err(label, 'no WOD in the bank fits this slot with the equipment on hand -- loosen its focus or length')
        }
        break
      }
      case 'check':
        if (raw.check !== true) err(label, 'check must be true')
        else item.check = true
        break
      case 'minutes': {
        if (!isObj(raw.minutes)) { err(label, 'minutes must map week numbers to minutes'); break }
        const out: Record<string, number> = {}
        for (const [w, m] of Object.entries(raw.minutes)) {
          if (!inRange(Number(w))) err(label, `week ${w} is outside the schema`)
          else if (!isNum(m, 1, 600)) err(label, `week ${w}'s minutes must be 1 to 600`)
          else out[String(Number(w))] = Math.round(m)
        }
        item.minutes = out
        break
      }
    }
    return item
  }

  function cleanPrescription(raw: unknown, where: string): Prescription | null {
    if (!isObj(raw) || !Array.isArray(raw.sets) || !raw.sets.length || raw.sets.length > 15) {
      err(where, 'needs sets: a list of 1 to 15 sets')
      return null
    }
    const sets: SetTarget[] = []
    raw.sets.forEach((s, i) => {
      const sw = `${where} set ${i + 1}`
      if (!isObj(s)) return err(sw, 'must be an object')
      const set: SetTarget = {}
      if (s.test !== undefined) {
        if (s.test !== 'ladder' && s.test !== 'single') return err(sw, 'test must be "ladder" or "single"')
        set.test = s.test
        return sets.push(set)
      }
      if (s.reps !== undefined) {
        if (s.reps === 'max' || isInt(s.reps, 1, 200)) set.reps = s.reps
        else err(sw, 'reps must be 1 to 200, or "max"')
      }
      if (s.seconds !== undefined) {
        if (isInt(s.seconds, 1, 3600)) set.seconds = s.seconds
        else err(sw, 'seconds must be 1 to 3600')
      }
      if (s.pct !== undefined) {
        if (isNum(s.pct, 0.2, 1.1)) set.pct = s.pct
        else err(sw, `pct is ${JSON.stringify(s.pct)}; it must be a fraction of the PR from 0.2 to 1.1`)
      }
      if (s.weight !== undefined) {
        if (isNum(s.weight, 0, 1000)) set.weight = s.weight
        else err(sw, 'weight must be 0 to 1000 lb')
      }
      if (set.reps === undefined && set.seconds === undefined) err(sw, 'needs reps or seconds')
      sets.push(set)
    })
    const note = text(raw.note, 300)
    return { sets, ...(note ? { note } : {}) }
  }

  function cleanProgression(raw: unknown, where: string): Progression | null {
    if (!isObj(raw) || !Array.isArray(raw.phases) || !raw.phases.length) {
      err(where, 'progression needs phases: a list of { weeks: [from, to], sets, reps, startPct, stepPct }')
      return null
    }
    const phases: Progression['phases'] = []
    raw.phases.slice(0, 6).forEach((ph, i) => {
      const pw = `${where} phase ${i + 1}`
      if (!isObj(ph)) return err(pw, 'must be an object')
      const w = ph.weeks
      if (!Array.isArray(w) || w.length !== 2 || !inRange(w[0] as number) || !inRange(w[1] as number) || (w[0] as number) > (w[1] as number)) {
        return err(pw, 'weeks must be [from, to] within the schema')
      }
      if (!isInt(ph.sets, 1, 10)) err(pw, 'sets must be 1 to 10')
      if (!isInt(ph.reps, 1, 20)) err(pw, 'reps must be 1 to 20')
      if (!isNum(ph.startPct, 0.3, 1.05)) err(pw, `startPct is ${JSON.stringify(ph.startPct)}; it must be a fraction of the PR from 0.3 to 1.05`)
      if (!isNum(ph.stepPct, -0.1, 0.1)) err(pw, `stepPct is ${JSON.stringify(ph.stepPct)}; it must be a fraction from -0.1 to 0.1 (0.025 adds 2.5% a week)`)
      const steps = (w[1] as number) - (w[0] as number)
      if (isNum(ph.startPct, 0.3, 1.05) && isNum(ph.stepPct, -0.1, 0.1) && ph.startPct + steps * ph.stepPct > 1.1) {
        err(pw, `climbs to ${Math.round((ph.startPct + steps * ph.stepPct) * 100)}% of the PR; keep it at or under 110%`)
      }
      phases.push({ weeks: [w[0] as number, w[1] as number], sets: ph.sets as number, reps: ph.reps as number, startPct: ph.startPct as number, stepPct: ph.stepPct as number })
    })
    const out: Progression = { phases }
    if (raw.deload !== undefined) {
      const dl = raw.deload
      if (!isObj(dl) || !isInt(dl.sets, 1, 10) || !isInt(dl.reps, 1, 20) || !isNum(dl.pct, 0.3, 0.9)) err(where, 'deload must be { sets 1-10, reps 1-20, pct 0.3-0.9 }')
      else out.deload = { sets: dl.sets, reps: dl.reps, pct: dl.pct }
    }
    if (raw.test !== undefined) {
      if (raw.test !== 'ladder' && raw.test !== 'single') err(where, 'test must be "ladder" or "single"')
      else out.test = raw.test
    }
    return out
  }

  function cleanSlot(raw: unknown, where: string): WodSlot | null {
    if (!isObj(raw) || !isInt(raw.maxMinutes, 5, 60)) { err(where, 'wod needs maxMinutes, 5 to 60'); return null }
    const slot: WodSlot = { maxMinutes: raw.maxMinutes }
    if (raw.minMinutes !== undefined) {
      if (!isInt(raw.minMinutes, 0, raw.maxMinutes)) err(where, 'minMinutes must be 0 to maxMinutes')
      else slot.minMinutes = raw.minMinutes
    }
    if (raw.focus !== undefined) {
      const bad = Array.isArray(raw.focus) ? raw.focus.filter((f) => !(WOD_FOCUSES as readonly unknown[]).includes(f)) : [raw.focus]
      if (bad.length) err(where, `focus ${JSON.stringify(bad)} isn't a tag -- focus must be a list of ${WOD_FOCUSES.join(', ')}`)
      else slot.focus = raw.focus as WodFocus[]
    }
    if (raw.lowImpact !== undefined) slot.lowImpact = raw.lowImpact === true
    return slot
  }

  if (errors.length) return { schema: null, errors }
  const schema: TrainingSchema = {
    schemaVersion: 1, name: name!, startDate, firstWeek: firstWeek as 0 | 1, weeks: weeks as number,
    deloadWeeks: [...new Set(deloadWeeks as number[])].sort((a, b) => a - b), lifts, days: days.sort((a, b) => a.weekday - b.weekday),
  }
  if (testWeek !== undefined) schema.testWeek = testWeek as number
  const goals = text(input.goals, 4000)
  if (goals) schema.goals = goals
  if (typeof input.basedOn === 'string' && input.basedOn) schema.basedOn = input.basedOn.slice(0, 64)
  if (wods.length) schema.wods = wods
  if (hiddenWods.length) schema.hiddenWods = [...new Set(hiddenWods)]
  return { schema, errors: [] }
}

function cleanWod(raw: unknown, where: string, err: (where: string, what: string) => void): Wod | null {
  if (!isObj(raw)) { err(where, 'must be an object'); return null }
  const name = text(raw.name, 60)
  if (typeof raw.id !== 'string' || !ID.test(raw.id) || !name) { err(where, 'needs an id and a name'); return null }
  const label = `${where} (${name})`
  if (!(WOD_FORMATS as readonly unknown[]).includes(raw.format)) err(label, `format must be one of ${WOD_FORMATS.join(', ')}`)
  if (!isInt(raw.minutes, 3, 60)) err(label, 'minutes must be 3 to 60')
  if (!Array.isArray(raw.parts) || !raw.parts.length || raw.parts.length > 10) { err(label, 'parts must list 1 to 10 movements'); return null }
  const parts: WodPart[] = []
  raw.parts.forEach((p, i) => {
    if (!isObj(p) || typeof p.move !== 'string' || !MOVEMENT.has(p.move)) return err(`${label} part ${i + 1}`, 'move must be a movement id from the library')
    const part: WodPart = { move: p.move }
    if (p.amount !== undefined) { if (isNum(p.amount, 1, 5000)) part.amount = p.amount; else err(`${label} part ${i + 1}`, 'amount must be 1 to 5000') }
    if (p.weight !== undefined) { if (isNum(p.weight, 1, 500)) part.weight = p.weight; else err(`${label} part ${i + 1}`, 'weight must be 1 to 500 lb') }
    parts.push(part)
  })
  const wod: Wod = { id: raw.id, name, format: raw.format as Wod['format'], minutes: raw.minutes as number, parts }
  if (raw.format === 'rft') {
    if (isInt(raw.rounds, 1, 30)) wod.rounds = raw.rounds
    else err(label, 'a rounds-for-time WOD needs rounds, 1 to 30')
  }
  if (raw.format === 'ladder') {
    if (Array.isArray(raw.scheme) && raw.scheme.length && raw.scheme.every((n) => isInt(n, 1, 100))) wod.scheme = raw.scheme as number[]
    else err(label, 'a ladder needs scheme, e.g. [21, 15, 9]')
  }
  const t = text(raw.text, 200)
  if (t) wod.text = t
  else if (raw.format === 'intervals') err(label, 'an intervals WOD needs text saying how it runs')
  const notes = text(raw.notes, 300)
  if (notes) wod.notes = notes
  return wod
}

/** Gear and bell weights from Settings, or the import file. */
const bells = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.filter((n): n is number => isNum(n, 1, 200)).map((n) => Math.round(n * 2) / 2))].sort((a, b) => a - b).slice(0, 30) : []

function cleanGearSet(o: Obj): { gear: Gear[]; dumbbells: number[]; kettlebells: number[] } {
  const gear = Array.isArray(o.gear) ? GEAR.filter((g) => (o.gear as unknown[]).includes(g)) : []
  const dumbbells = bells(o.dumbbells)
  const kettlebells = bells(o.kettlebells)
  // Bell weights listed mean the bells are there, whether or not the gear list says so.
  const have = new Set<string>(gear)
  if (dumbbells.length) have.add('dumbbells')
  if (kettlebells.length) have.add('kettlebells')
  return { gear: GEAR.filter((g) => have.has(g)), dumbbells, kettlebells }
}

/** Gear and bell weights from Settings, or the import file -- by place when it's in more than one. */
export function cleanEquipment(input: unknown): Equipment {
  const o = isObj(input) ? input : {}
  const places = (Array.isArray(o.places) ? o.places : []).filter(isObj).slice(0, 6)
    .map((p, i) => ({ name: text(p.name, 30) ?? `Place ${i + 1}`, ...cleanGearSet(p) }))
    .filter((p) => p.gear.length > 0)
  if (!places.length) return cleanGearSet(o)
  // With places, everything on hand is what they hold together.
  const all = new Set(places.flatMap((p) => p.gear))
  return {
    gear: GEAR.filter((g) => all.has(g)),
    dumbbells: [...new Set(places.flatMap((p) => p.dumbbells))].sort((a, b) => a - b),
    kettlebells: [...new Set(places.flatMap((p) => p.kettlebells))].sort((a, b) => a - b),
    places,
  }
}

export const NO_EQUIPMENT: Equipment = { gear: [], dumbbells: [], kettlebells: [] }

/**
 * One item checked as a schema would check it -- a stand-in the coach
 * proposes, say -- by putting it into a copy of the schema it would join.
 */
export function cleanItemIn(raw: unknown, schema: TrainingSchema, ctx: SchemaContext): { item: TrainingItem | null; errors: string[] } {
  const copy = structuredClone(schema)
  const host = copy.days[0]?.sessions[0]
  if (!host) return { item: null, errors: ['the schema has no session to check the item in'] }
  host.items.push(raw as TrainingItem)
  const { schema: clean, errors } = cleanSchema(copy, ctx)
  const where = `days[0].sessions[0].items[${host.items.length - 1}]`
  const mine = errors.filter((e) => e.startsWith(where)).map((e) => e.replace(where, 'item'))
  if (mine.length || !clean) return { item: null, errors: mine.length ? mine : errors }
  return { item: clean.days[0]!.sessions[0]!.items.at(-1)!, errors: [] }
}
