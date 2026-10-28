import type { Prescription, SetTarget, TrainingItem, TrainingSchema } from '../../types.ts'
import { addDays, daysBetween } from '../nutrition.ts'

/**
 * Turning a training schema into what a given day asks for: which week of
 * the schema a date falls in (allowing for repeated weeks), what an item
 * prescribes that week (spelled out, or from its progression rule), and the
 * weights those percentages come to at today's PRs.
 */

/** The schema's weeks in the order they're trained, with each repeated week in again after itself. */
export function weekSequence(schema: Pick<TrainingSchema, 'firstWeek' | 'weeks'>, repeats: number[] = []): number[] {
  const seq: number[] = []
  for (let w = schema.firstWeek; w <= schema.weeks; w++) {
    seq.push(w)
    for (const r of repeats) if (r === w) seq.push(w)
  }
  return seq
}

/** The last day of the schema, repeats included. */
export function schemaEnd(schema: Pick<TrainingSchema, 'startDate' | 'firstWeek' | 'weeks'>, repeats: number[] = []): string {
  return addDays(schema.startDate, weekSequence(schema, repeats).length * 7 - 1)
}

/** Which week of the schema a date is in, or null outside it; `repeat` when it's a second go at that week. */
export function weekOf(
  schema: Pick<TrainingSchema, 'startDate' | 'firstWeek' | 'weeks'>, date: string, repeats: number[] = [],
): { week: number; repeat: boolean } | null {
  const days = daysBetween(schema.startDate, date)
  if (days < 0) return null
  const seq = weekSequence(schema, repeats)
  const i = Math.floor(days / 7)
  if (i >= seq.length) return null
  return { week: seq[i]!, repeat: i > 0 && seq[i - 1] === seq[i] }
}

/** Mon=1 .. Sun=7, as the schema numbers days. */
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

const inWeeks = (item: TrainingItem, week: number): boolean =>
  !item.onlyWeeks || (week >= item.onlyWeeks[0] && week <= item.onlyWeeks[1])

/** An item logged set by set (rather than a tick, minutes or a WOD). */
export const hasSets = (item: TrainingItem): boolean => Boolean(item.sets || item.weeks || item.progression)

/** What a sets item asks for in a week: spelled out, or worked out from its progression. Null when it's off that week. */
export function prescriptionFor(item: TrainingItem, week: number, schema: Pick<TrainingSchema, 'deloadWeeks' | 'testWeek'>): Prescription | null {
  if (!inWeeks(item, week)) return null
  if (item.sets) return item.sets
  if (item.weeks) return item.weeks[String(week)] ?? null
  const p = item.progression
  if (!p) return null
  if (schema.testWeek === week) return p.test ? { sets: [{ test: p.test }] } : null
  if (schema.deloadWeeks.includes(week)) {
    return p.deload ? { sets: Array.from({ length: p.deload.sets }, () => ({ reps: p.deload!.reps, pct: p.deload!.pct })) } : null
  }
  // Deload weeks inside a phase don't count as steps: the week after one picks up where the one before it left off.
  const phase = p.phases.find((ph) => week >= ph.weeks[0] && week <= ph.weeks[1])
  if (!phase) return null
  let step = 0
  for (let w = phase.weeks[0]; w < week; w++) if (!schema.deloadWeeks.includes(w)) step++
  const pct = Math.round((phase.startPct + step * phase.stepPct) * 1000) / 1000
  return { sets: Array.from({ length: phase.sets }, () => ({ reps: phase.reps, pct })) }
}

/** Is the item on in this week at all (a check, minutes or WOD item, or a sets item with sets that week)? */
export function itemOn(item: TrainingItem, week: number, schema: Pick<TrainingSchema, 'deloadWeeks' | 'testWeek'>): boolean {
  if (!inWeeks(item, week)) return false
  if (item.minutes) return item.minutes[String(week)] !== undefined
  if (hasSets(item)) return prescriptionFor(item, week, schema) !== null
  return true
}

export function roundTo(weight: number, increment: number): number {
  return Math.round(Math.round(weight / increment) * increment * 100) / 100
}

export interface PlannedSet {
  reps: number | 'max' | null
  seconds: number | null
  weight: number | null
  attempt?: boolean
}

/** The test ladder: the singles that lead up to it, then the attempt itself. */
const LADDER: [number, number][] = [[3, 0.7], [2, 0.8], [1, 0.9], [1, 0.95]]

/**
 * One planned set, or several for a test ladder, with the percentages
 * turned into weights at this PR. 'ladder' ends on an attempt 5 lb over the
 * PR; 'single' stops at the PR itself -- a sure single, for a lift that
 * can't be dropped on iron plates.
 */
export function planSets(target: SetTarget, pr: number | null, increment: number): PlannedSet[] {
  const at = (pct: number): number | null => (pr ? roundTo(pr * pct, increment) : null)
  if (target.test) {
    const sets: PlannedSet[] = LADDER.map(([reps, pct]) => ({ reps, seconds: null, weight: at(pct) }))
    sets.push(target.test === 'ladder'
      ? { reps: 1, seconds: null, weight: pr ? pr + Math.max(5, increment) : null, attempt: true }
      : { reps: 1, seconds: null, weight: pr ?? null })
    return sets
  }
  const weight = target.weight ?? (target.pct !== undefined ? at(target.pct) : null)
  return [{ reps: target.reps ?? null, seconds: target.seconds ?? null, weight }]
}

/** "5×5 @ 95", "3 @ 70% … 1 @ 150 (PR attempt)", "3×max": a week's prescription in a few characters. */
export function describe(sets: PlannedSet[]): string {
  const out: string[] = []
  let i = 0
  while (i < sets.length) {
    const s = sets[i]!
    let n = 1
    while (i + n < sets.length && sameSet(sets[i + n]!, s)) n++
    const what = s.seconds !== null ? `${s.seconds} s` : String(s.reps ?? '')
    const load = s.weight !== null ? ` @ ${s.weight}` : ''
    out.push(`${n > 1 ? `${n}×` : ''}${what}${load}${s.attempt ? ' (PR attempt)' : ''}`)
    i += n
  }
  return out.join(', ')
}

const sameSet = (a: PlannedSet, b: PlannedSet): boolean =>
  a.reps === b.reps && a.seconds === b.seconds && a.weight === b.weight && !a.attempt && !b.attempt

/** The heaviest planned weight, for the overview and the draft comparison. */
export function topWeight(sets: PlannedSet[]): number | null {
  const ws = sets.filter((s) => !s.attempt && s.weight !== null).map((s) => s.weight!)
  return ws.length ? Math.max(...ws) : null
}

/** Epley's estimated one-rep max. */
export function e1rm(weight: number, reps: number): number {
  return reps <= 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10
}
