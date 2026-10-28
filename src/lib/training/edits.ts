import type { PlanEdit, TrainingItem, TrainingSchema, TrainingSession } from '../../types.ts'
import { OVERRIDE_OPS, REVISION_OPS } from '../../types.ts'

/**
 * Lasting changes to a schema, from a week on. Nothing that's been trained
 * is rewritten: a changed or removed item keeps its weeks so far (its
 * `onlyWeeks` ends the week before), and what replaces it is a new item with
 * a new id from that week, so sets already logged stay with the item they
 * were logged against.
 */

export type RevisionEdit = Extract<PlanEdit, { op: (typeof REVISION_OPS)[number] }>
export type OverrideEdit = Extract<PlanEdit, { op: (typeof OVERRIDE_OPS)[number] }>

export const isRevision = (e: PlanEdit): e is RevisionEdit => (REVISION_OPS as readonly string[]).includes(e.op)
export const isOverride = (e: PlanEdit): e is OverrideEdit => (OVERRIDE_OPS as readonly string[]).includes(e.op)

const range = (item: TrainingItem, schema: TrainingSchema): [number, number] => item.onlyWeeks ?? [schema.firstWeek, schema.weeks]

/** An id not yet taken: `base`, else `base-w6`, else `base-w6-2`… */
function freshId(base: string, taken: Set<string>, week: number): string {
  let id = taken.has(base) ? `${base}-w${week}`.slice(0, 40) : base
  for (let n = 2; taken.has(id); n++) id = `${base}-w${week}-${n}`.slice(0, 40)
  taken.add(id)
  return id
}

/**
 * The schema with the edits made, from `fromWeek` (or the current week) on.
 * Returns errors for edits that name what isn't there; the result still
 * needs checking as a whole (cleanSchema).
 */
export function reviseSchema(schema: TrainingSchema, edits: RevisionEdit[], currentWeek: number): { schema: TrainingSchema; errors: string[] } {
  const out = structuredClone(schema)
  const errors: string[] = []
  const itemIds = new Set(out.days.flatMap((d) => d.sessions.flatMap((s) => s.items.map((i) => i.id))))
  const sessionIds = new Set(out.days.flatMap((d) => d.sessions.map((s) => s.id)))

  const findItem = (id: string): { session: TrainingSession; index: number } | null => {
    for (const d of out.days) for (const s of d.sessions) {
      const index = s.items.findIndex((i) => i.id === id)
      if (index >= 0) return { session: s, index }
    }
    return null
  }
  const findSession = (id: string): { day: TrainingSchema['days'][number]; index: number } | null => {
    for (const d of out.days) {
      const index = d.sessions.findIndex((s) => s.id === id)
      if (index >= 0) return { day: d, index }
    }
    return null
  }
  /** End an item the week before `from`; false when that leaves it no weeks at all. */
  const endBefore = (item: TrainingItem, from: number): boolean => {
    const [lo] = range(item, out)
    if (from - 1 < lo) return false
    item.onlyWeeks = [lo, Math.min(range(item, out)[1], from - 1)]
    return true
  }
  /** A new item (or a copy) that starts at `from`. */
  const startAt = (item: TrainingItem, from: number, end = out.weeks): TrainingItem => {
    const copy = structuredClone(item)
    copy.id = freshId(item.id, itemIds, from)
    if (from > out.firstWeek || end < out.weeks) copy.onlyWeeks = [Math.max(from, out.firstWeek), end]
    else delete copy.onlyWeeks
    return copy
  }

  for (const e of edits) {
    const from = Math.max(e.fromWeek ?? currentWeek, out.firstWeek)
    if (from > out.weeks) { errors.push(`${e.op}: fromWeek ${from} is after the schema's last week (${out.weeks})`); continue }
    switch (e.op) {
      case 'replaceItem': {
        const at = findItem(e.itemId)
        if (!at) { errors.push(`replaceItem: no item "${e.itemId}"`); break }
        const old = at.session.items[at.index]!
        const end = range(old, out)[1]
        const kept = endBefore(old, from)
        const next = startAt({ ...e.item, id: e.item.id || old.id }, from, end)
        at.session.items.splice(kept ? at.index + 1 : at.index, kept ? 0 : 1, next)
        break
      }
      case 'addItem': {
        const at = findSession(e.sessionId)
        if (!at) { errors.push(`addItem: no session "${e.sessionId}"`); break }
        at.day.sessions[at.index]!.items.push(startAt(e.item, from))
        break
      }
      case 'removeItem': {
        const at = findItem(e.itemId)
        if (!at) { errors.push(`removeItem: no item "${e.itemId}"`); break }
        if (!endBefore(at.session.items[at.index]!, from)) at.session.items.splice(at.index, 1)
        break
      }
      case 'addSession': {
        if (!Number.isInteger(e.weekday) || e.weekday < 1 || e.weekday > 7) { errors.push(`addSession: weekday must be 1 to 7`); break }
        let day = out.days.find((d) => d.weekday === e.weekday)
        if (!day) { day = { weekday: e.weekday, sessions: [] }; out.days.push(day); out.days.sort((a, b) => a.weekday - b.weekday) }
        const session = structuredClone(e.session)
        session.id = freshId(session.id || 'session', sessionIds, from)
        session.items = (session.items ?? []).map((i) => startAt(i, from))
        day.sessions.push(session)
        break
      }
      case 'removeSession': {
        const at = findSession(e.sessionId)
        if (!at) { errors.push(`removeSession: no session "${e.sessionId}"`); break }
        const session = at.day.sessions[at.index]!
        session.items = session.items.filter((i) => endBefore(i, from))
        if (!session.items.length) at.day.sessions.splice(at.index, 1)
        break
      }
      case 'moveSession': {
        const at = findSession(e.sessionId)
        if (!at) { errors.push(`moveSession: no session "${e.sessionId}"`); break }
        if (!Number.isInteger(e.toWeekday) || e.toWeekday < 1 || e.toWeekday > 7) { errors.push('moveSession: toWeekday must be 1 to 7'); break }
        const session = at.day.sessions[at.index]!
        // A copy on the new day from `from`; the original keeps the weeks before.
        const moved: TrainingSession = {
          ...structuredClone(session),
          id: freshId(session.id, sessionIds, from),
          items: session.items.filter((i) => range(i, out)[1] >= from).map((i) => startAt(i, from, range(i, out)[1])),
        }
        session.items = session.items.filter((i) => endBefore(i, from))
        if (!session.items.length) at.day.sessions.splice(at.index, 1)
        let day = out.days.find((d) => d.weekday === e.toWeekday)
        if (!day) { day = { weekday: e.toWeekday, sessions: [] }; out.days.push(day); out.days.sort((a, b) => a.weekday - b.weekday) }
        if (moved.items.length) day.sessions.push(moved)
        break
      }
    }
  }
  out.days = out.days.filter((d) => d.sessions.length > 0)
  return { schema: out, errors }
}

/**
 * A rewrite of a schema from `fromWeek` on: the new schema's items for
 * those weeks, and the old schema's for the weeks before, so what's been
 * trained stays exactly as it was. The weeks keep their numbers and dates.
 * New items that reuse an old id get a fresh one -- ids are unique, and
 * the old item's logs stay with the old item.
 */
export function mergeRewrite(old: TrainingSchema, next: TrainingSchema, fromWeek: number): TrainingSchema {
  const weeks = Math.max(next.weeks, fromWeek)
  const out: TrainingSchema = {
    ...next,
    startDate: old.startDate,
    firstWeek: old.firstWeek,
    weeks,
    lifts: [...old.lifts, ...next.lifts.filter((l) => !old.lifts.some((o) => o.id === l.id))],
    deloadWeeks: [...old.deloadWeeks.filter((w) => w < fromWeek), ...next.deloadWeeks.filter((w) => w >= fromWeek && w <= weeks)],
    days: [],
  }
  const testWeek = next.testWeek !== undefined && next.testWeek >= fromWeek ? next.testWeek : old.testWeek !== undefined && old.testWeek < fromWeek ? old.testWeek : undefined
  if (testWeek !== undefined) out.testWeek = testWeek
  else delete out.testWeek
  const wods = [...(old.wods ?? []), ...(next.wods ?? []).filter((w) => !old.wods?.some((o) => o.id === w.id))]
  if (wods.length) out.wods = wods
  else delete out.wods

  const clip = (item: TrainingItem, lo: number, hi: number): TrainingItem | null => {
    const [a, b] = item.onlyWeeks ?? [lo, hi]
    const from = Math.max(a, lo)
    const to = Math.min(b, hi)
    if (to < from) return null
    const copy = structuredClone(item)
    if (from === out.firstWeek && to === weeks) delete copy.onlyWeeks
    else copy.onlyWeeks = [from, to]
    return copy
  }
  const itemIds = new Set<string>()
  const sessionIds = new Set<string>()
  const dayFor = (weekday: number): TrainingSchema['days'][number] => {
    let day = out.days.find((d) => d.weekday === weekday)
    if (!day) { day = { weekday, sessions: [] }; out.days.push(day) }
    return day
  }
  // The weeks already trained, from the old schema.
  for (const d of old.days) {
    for (const s of d.sessions) {
      const items = s.items.map((i) => clip(i, old.firstWeek, fromWeek - 1)).filter((i): i is TrainingItem => i !== null)
      if (!items.length) continue
      items.forEach((i) => itemIds.add(i.id))
      sessionIds.add(s.id)
      dayFor(d.weekday).sessions.push({ ...s, items })
    }
  }
  // The weeks ahead, from the new one.
  for (const d of next.days) {
    for (const s of d.sessions) {
      const items = s.items.map((i) => clip(i, fromWeek, weeks)).filter((i): i is TrainingItem => i !== null)
        .map((i) => ({ ...i, id: freshId(i.id, itemIds, fromWeek) }))
      if (!items.length) continue
      const day = dayFor(d.weekday)
      const same = day.sessions.find((x) => x.id === s.id)
      if (same) same.items.push(...items)
      else day.sessions.push({ ...s, id: freshId(s.id, sessionIds, fromWeek), items })
    }
  }
  out.days.sort((a, b) => a.weekday - b.weekday)
  return out
}
