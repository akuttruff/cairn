import type { PlanEdit, Prescription, TrainingItem, TrainingSchema, TrainingSession } from '../../types.ts'
import { OVERRIDE_OPS, REVISION_OPS } from '../../types.ts'
import { hasSets, prescriptionFor } from './resolve.ts'

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
    const from = Math.max(('fromWeek' in e ? e.fromWeek : undefined) ?? currentWeek, out.firstWeek)
    if (from > out.weeks) { errors.push(`${e.op}: fromWeek ${from} is after the schema's last week (${out.weeks})`); continue }
    // An addition can stop at a week (toWeek = fromWeek for just one); without one it runs to the end.
    const until = 'toWeek' in e && e.toWeek !== undefined ? e.toWeek : out.weeks
    if (!Number.isInteger(until) || until < from || until > out.weeks) { errors.push(`${e.op}: toWeek must be from ${from} to ${out.weeks}`); continue }
    switch (e.op) {
      case 'replaceItem': {
        const at = findItem(e.itemId)
        if (!at) { errors.push(`replaceItem: no item "${e.itemId}"`); break }
        const old = at.session.items[at.index]!
        // The replacement covers the weeks the old one had from `from` on -- never weeks it wasn't in.
        const [start, end] = range(old, out)
        if (from > end) { errors.push(`replaceItem: "${e.itemId}" ends in week ${end}, before week ${from}`); break }
        const kept = endBefore(old, from)
        const next = startAt({ ...e.item, id: e.item.id || old.id }, Math.max(from, start), end)
        at.session.items.splice(kept ? at.index + 1 : at.index, kept ? 0 : 1, next)
        break
      }
      case 'addItem': {
        const at = findSession(e.sessionId)
        if (!at) { errors.push(`addItem: no session "${e.sessionId}"`); break }
        at.day.sessions[at.index]!.items.push(startAt(e.item, from, until))
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
        session.items = (session.items ?? []).map((i) => startAt(i, from, until))
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
          items: session.items.filter((i) => range(i, out)[1] >= from).map((i) => startAt(i, Math.max(from, range(i, out)[0]), range(i, out)[1])),
        }
        session.items = session.items.filter((i) => endBefore(i, from))
        if (!session.items.length) at.day.sessions.splice(at.index, 1)
        let day = out.days.find((d) => d.weekday === e.toWeekday)
        if (!day) { day = { weekday: e.toWeekday, sessions: [] }; out.days.push(day); out.days.sort((a, b) => a.weekday - b.weekday) }
        if (moved.items.length) day.sessions.push(moved)
        break
      }
      case 'setOptional': {
        // Only how the day counts as done changes, so it holds for every week, trained or not.
        if (e.sessionId) {
          const at = findSession(e.sessionId)
          if (!at) { errors.push(`setOptional: no session "${e.sessionId}"`); break }
          const s = at.day.sessions[at.index]!
          if (e.optional) s.optional = true
          else delete s.optional
        } else if (e.itemId) {
          const at = findItem(e.itemId)
          if (!at) { errors.push(`setOptional: no item "${e.itemId}"`); break }
          const i = at.session.items[at.index]!
          if (e.optional) i.optional = true
          else delete i.optional
        } else errors.push('setOptional: needs a sessionId or an itemId')
        break
      }
      case 'renameSession': {
        // A label, not what's trained: with no weeks given the new name holds for every week;
        // with them, just those weeks, for a session whose contents change partway.
        const at = findSession(e.sessionId)
        if (!at) { errors.push(`renameSession: no session "${e.sessionId}"`); break }
        const title = typeof e.title === 'string' ? e.title.trim().slice(0, 80) : ''
        if (!title) { errors.push('renameSession: title is the new name'); break }
        const session = at.day.sessions[at.index]!
        if (e.fromWeek === undefined && e.toWeek === undefined) { session.title = title; delete session.weekTitles; break }
        session.weekTitles ??= {}
        for (let w = from; w <= until; w++) session.weekTitles[w] = title
        break
      }
      case 'setNotes': {
        // A description, not what's trained: it holds for every week, like a name.
        const at = findItem(e.itemId)
        if (!at) { errors.push(`setNotes: no item "${e.itemId}"`); break }
        if (typeof e.notes !== 'string') { errors.push('setNotes: notes is the new description, as text'); break }
        const item = at.session.items[at.index]!
        const notes = e.notes.trim().slice(0, 1500)
        if (notes) item.notes = notes
        else delete item.notes
        break
      }
      case 'setWeeks': {
        // Some weeks' sets changed in place: the item's every week is written out week by week,
        // then the given weeks replace theirs. Same item, same id, so its logged sets stay with it.
        const at = findItem(e.itemId)
        if (!at) { errors.push(`setWeeks: no item "${e.itemId}"`); break }
        const item = at.session.items[at.index]!
        if (!hasSets(item)) { errors.push(`setWeeks: "${e.itemId}" has no sets to change (it's a WOD slot, minutes or a check)`); break }
        if (!e.weeks || typeof e.weeks !== 'object' || Array.isArray(e.weeks) || !Object.keys(e.weeks).length) {
          errors.push('setWeeks: weeks maps week numbers to sets, e.g. { "0": "3x5@35", "1": "4x5@40" }')
          break
        }
        const [lo, hi] = range(item, out)
        const outside = Object.keys(e.weeks).filter((w) => !/^\d+$/.test(w) || Number(w) < lo || Number(w) > hi)
        if (outside.length) { errors.push(`setWeeks: "${e.itemId}" runs weeks ${lo}-${hi}, so it can't take week ${outside.join(', ')}`); break }
        const weeks: Record<string, Prescription | string> = {}
        for (let w = lo; w <= hi; w++) {
          const p = prescriptionFor(item, w, out)
          if (p) weeks[w] = structuredClone(p)
        }
        // A week given as null has no sets at all; the rest are checked (and read, if short) with the schema.
        for (const [w, p] of Object.entries(e.weeks)) {
          if (p === null) delete weeks[Number(w)]
          else weeks[Number(w)] = p as Prescription | string
        }
        delete item.sets
        delete item.progression
        item.weeks = weeks as Record<string, Prescription>
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
