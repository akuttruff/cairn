import { describe, expect, it } from 'vitest'
import type { TrainingSchema } from '../../types.ts'
import { mergeRewrite, reviseSchema } from './edits.ts'
import { cleanSchema, parseSets } from './schema.ts'
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

  it('keeps a replacement to the weeks the item had, even from an earlier week', () => {
    // A WOD slot from week 2 changed "from week 1" stays out of week 1, where something else is planned.
    const later = structuredClone(SAMPLE_SCHEMA)
    later.days[0]!.sessions[0]!.items[1]!.onlyWeeks = [2, 4]
    const { schema, errors } = reviseSchema(later, [{ op: 'replaceItem', itemId: 'mobility', item: { id: 'hip-flow', name: 'Hip flow', check: true }, fromWeek: 1 }], 1)
    expect(errors).toEqual([])
    expect(item(schema, 'mobility')).toBeUndefined()
    expect(item(schema, 'hip-flow')).toMatchObject({ onlyWeeks: [2, 4] })
    const moved = reviseSchema(later, [{ op: 'moveSession', sessionId: 'legs', toWeekday: 2, fromWeek: 1 }], 1).schema
    expect(moved.days.find((d) => d.weekday === 2)!.sessions[0]!.items.find((i) => i.name === 'Hip mobility')).toMatchObject({ onlyWeeks: [2, 4] })
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

  it('adds a session for just one week with toWeek, and refuses a toWeek before fromWeek', () => {
    const once = reviseSchema(SAMPLE_SCHEMA, [{ op: 'addSession', weekday: 7, session: { id: 'extra', title: 'Back squat + deadlift', kind: 'weightlifting', items: [{ id: 'dl', name: 'Deadlift', check: true }] }, fromWeek: 2, toWeek: 2 }], 1)
    expect(once.errors).toEqual([])
    const sunday = once.schema.days.find((d) => d.weekday === 7)!
    expect(sunday.sessions[0]!.items[0]!.onlyWeeks).toEqual([2, 2])
    expect(itemOn(sunday.sessions[0]!.items[0]!, 3, once.schema)).toBe(false)
    expect(cleanSchema(once.schema, ctx).errors).toEqual([])
    expect(reviseSchema(SAMPLE_SCHEMA, [{ op: 'addItem', sessionId: 'ride', item: { id: 'x', name: 'X', check: true }, fromWeek: 3, toWeek: 2 }], 1).errors)
      .toEqual(['addItem: toWeek must be from 3 to 4'])
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

describe('new sets for some weeks', () => {
  it('changes only the weeks given, writing out the rest of a progression week by week', () => {
    const { schema, errors } = reviseSchema(SAMPLE_SCHEMA, [{ op: 'setWeeks', itemId: 'back-squat', weeks: { 1: '3x5@95', 2: '4x5@100' } }], 1)
    expect(errors).toEqual([])
    const clean = cleanSchema(schema, ctx)
    expect(clean.errors).toEqual([])
    const squat = item(clean.schema!, 'back-squat')!
    expect(squat.progression).toBeUndefined()
    expect(squat.weeks!['1']!.sets).toEqual([{ reps: 5, weight: 95 }, { reps: 5, weight: 95 }, { reps: 5, weight: 95 }])
    expect(squat.weeks!['2']!.sets).toHaveLength(4)
    // The deload and the test stay as the progression had them.
    expect(squat.weeks!['3']!.sets).toEqual([{ reps: 5, pct: 0.6 }, { reps: 5, pct: 0.6 }, { reps: 5, pct: 0.6 }])
    expect(squat.weeks!['4']!.sets).toEqual([{ test: 'ladder' }])
  })

  it('refuses a week the item isn\'t in, and an item with no sets', () => {
    expect(reviseSchema(SAMPLE_SCHEMA, [{ op: 'setWeeks', itemId: 'back-squat', weeks: { 9: '3x5' } }], 1).errors.join()).toMatch(/runs weeks 1-4, so it can't take week 9/)
    expect(reviseSchema(SAMPLE_SCHEMA, [{ op: 'setWeeks', itemId: 'mobility', weeks: { 1: '3x5' } }], 1).errors.join()).toMatch(/has no sets to change/)
  })
})

describe('sets the short way', () => {
  it('reads sets as the plan writes them', () => {
    expect(parseSets('3x5@35')).toEqual([{ reps: 5, weight: 35 }, { reps: 5, weight: 35 }, { reps: 5, weight: 35 }])
    expect(parseSets('5 @ 40, 2×3 @ 45')).toEqual([{ reps: 5, weight: 40 }, { reps: 3, weight: 45 }, { reps: 3, weight: 45 }])
    expect(parseSets('3x5@70%')).toEqual([{ reps: 5, pct: 0.7 }, { reps: 5, pct: 0.7 }, { reps: 5, pct: 0.7 }])
    expect(parseSets('2x30s, max, ladder')).toEqual([{ seconds: 30 }, { seconds: 30 }, { reps: 'max' }, { test: 'ladder' }])
    expect(parseSets('heavy-ish')).toMatch(/"heavy-ish" isn't a set/)
  })

  it('says so when a set has a field it doesn\'t, rather than dropping it', () => {
    const bad = structuredClone(SAMPLE_SCHEMA)
    bad.days[0]!.sessions[0]!.items[1] = { id: 'mobility', name: 'Hip mobility', sets: { sets: [{ week: 0, sets: 3, reps: 5, weight: 35 }] } } as never
    expect(cleanSchema(bad, ctx).errors.join()).toMatch(/week, sets aren't fields of a set -- each entry is ONE set; write "3x5@35"/)
    bad.days[0]!.sessions[0]!.items[1] = { id: 'mobility', name: 'Hip mobility', reps: 5, check: true } as never
    expect(cleanSchema(bad, ctx).errors.join()).toMatch(/reps isn't a field of an item -- reps and weights go in "sets"/)
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
