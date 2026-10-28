import { describe, expect, it } from 'vitest'
import type { TrainingSchema } from '../../types.ts'
import { mergeRewrite, reviseSchema } from './edits.ts'
import { cleanSchema } from './schema.ts'
import { itemOn } from './resolve.ts'
import { SAMPLE_EQUIPMENT, SAMPLE_SCHEMA } from './sample.ts'

const ctx = { kinds: ['wod', 'weightlifting', 'run', 'cycling', 'yoga', 'pilates'], equipment: SAMPLE_EQUIPMENT }
const items = (s: TrainingSchema) => s.days.flatMap((d) => d.sessions.flatMap((x) => x.items))
const item = (s: TrainingSchema, id: string) => items(s).find((i) => i.id === id)

describe('lasting changes', () => {
  it('replaces an item from a week on, keeping the weeks before as they were', () => {
    const { schema, errors } = reviseSchema(SAMPLE_SCHEMA, [{ op: 'replaceItem', itemId: 'mobility', item: { id: 'hip-flow', name: 'Hip flow', check: true }, fromWeek: 3 }], 1)
    expect(errors).toEqual([])
    expect(item(schema, 'mobility')).toMatchObject({ onlyWeeks: [1, 2] })
    expect(item(schema, 'hip-flow')).toMatchObject({ onlyWeeks: [3, 4] })
    expect(cleanSchema(schema, ctx).errors).toEqual([])
    expect(item(SAMPLE_SCHEMA, 'mobility')!.onlyWeeks).toBeUndefined() // the original is untouched
  })

  it('gives a replacement a fresh id when it would clash', () => {
    const { schema } = reviseSchema(SAMPLE_SCHEMA, [{ op: 'replaceItem', itemId: 'mobility', item: { id: 'mobility', name: 'Hip flow', check: true }, fromWeek: 2 }], 1)
    expect(items(schema).map((i) => i.id)).toContain('mobility-w2')
  })

  it('adds a session from a week on, and moves one to another day', () => {
    const added = reviseSchema(SAMPLE_SCHEMA, [{ op: 'addSession', weekday: 7, session: { id: 'sunday-run', title: 'Easy run', kind: 'run', items: [{ id: 'run', name: 'Run', minutes: { 3: 20, 4: 20 } }] }, fromWeek: 3 }], 1).schema
    const sunday = added.days.find((d) => d.weekday === 7)!
    expect(sunday.sessions[0]!.items[0]).toMatchObject({ id: 'run', onlyWeeks: [3, 4] })
    expect(itemOn(sunday.sessions[0]!.items[0]!, 2, added)).toBe(false)

    const moved = reviseSchema(SAMPLE_SCHEMA, [{ op: 'moveSession', sessionId: 'ride', toWeekday: 6, fromWeek: 2 }], 1).schema
    expect(moved.days.find((d) => d.weekday === 4)!.sessions[0]!.items.every((i) => i.onlyWeeks?.[1] === 1)).toBe(true)
    const saturday = moved.days.find((d) => d.weekday === 6)!.sessions[0]!
    expect(saturday.id).toBe('ride-w2')
    expect(saturday.items.map((i) => i.id)).toEqual(['zone2-w2', 'dead-hang-w2'])
    expect(cleanSchema(moved, ctx).errors).toEqual([])
  })

  it('removes what has no weeks left, and says what it can\'t find', () => {
    const { schema, errors } = reviseSchema(SAMPLE_SCHEMA, [
      { op: 'removeSession', sessionId: 'wod-wed', fromWeek: 1 },
      { op: 'removeItem', itemId: 'nope' },
    ], 1)
    expect(schema.days.find((d) => d.weekday === 3)!.sessions.map((s) => s.id)).toEqual(['press-day'])
    expect(errors).toEqual(['removeItem: no item "nope"'])
  })
})

describe('a rewrite', () => {
  it('keeps the weeks already trained from the old schema, and takes the rest from the new', () => {
    const next = structuredClone(SAMPLE_SCHEMA)
    next.name = 'Rewritten'
    next.days = [{ weekday: 2, sessions: [{ id: 'legs', title: 'Legs', kind: 'weightlifting', items: [{ id: 'back-squat', name: 'Back squat', lift: 'squat', sets: { sets: [{ reps: 3, pct: 0.8 }] } }] }] }]
    const merged = mergeRewrite(SAMPLE_SCHEMA, next, 3)
    expect(merged).toMatchObject({ name: 'Rewritten', startDate: SAMPLE_SCHEMA.startDate, firstWeek: 1, deloadWeeks: [3], testWeek: 4 })
    // Monday's old squat ends at week 2; Tuesday's new one starts at week 3 under a fresh id.
    expect(item(merged, 'back-squat')!.onlyWeeks).toEqual([1, 2])
    const fresh = merged.days.find((d) => d.weekday === 2)!.sessions[0]!
    expect(fresh.id).toBe('legs-w3')
    expect(fresh.items[0]).toMatchObject({ id: 'back-squat-w3', onlyWeeks: [3, 4] })
    // The test week came from the old schema's squat, which no longer reaches week 4 -- the checker says so.
    expect(cleanSchema(merged, ctx).errors.join()).toMatch(/testWeek/)
  })
})
