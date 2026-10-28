import { describe, expect, it } from 'vitest'
import type { Equipment, TrainingSchema } from '../../types.ts'
import { describe as describeSets, e1rm, itemOn, planSets, prescriptionFor, roundTo, schemaEnd, weekOf, weekdayOf } from './resolve.ts'
import { fittingWods, pickWods, snapWeight, viewWod } from './bank.ts'
import { cleanEquipment, cleanSchema } from './schema.ts'
import { MOVEMENT, MOVEMENTS } from './movements.ts'
import { WOD_BANK } from './wods.ts'
import { SAMPLE_EQUIPMENT, SAMPLE_SCHEMA } from './sample.ts'

const KINDS = ['wod', 'weightlifting', 'run', 'cycling', 'yoga', 'pilates']
const ctx = { kinds: KINDS, equipment: SAMPLE_EQUIPMENT }
const clone = (): TrainingSchema => structuredClone(SAMPLE_SCHEMA)
const item = (schema: TrainingSchema, id: string) => schema.days.flatMap((d) => d.sessions.flatMap((s) => s.items)).find((i) => i.id === id)!

describe('weeks', () => {
  it('finds the week a date is in, and nothing outside the schema', () => {
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-01')).toBeNull()
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-02')).toEqual({ week: 1, repeat: false })
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-15')).toEqual({ week: 2, repeat: false })
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-29')).toEqual({ week: 4, repeat: false })
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-30')).toBeNull()
    expect(schemaEnd(SAMPLE_SCHEMA)).toBe('2026-11-29')
  })

  it('pushes every later week back by one when a week is repeated', () => {
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-16', [2])).toEqual({ week: 2, repeat: true })
    expect(weekOf(SAMPLE_SCHEMA, '2026-11-23', [2])).toEqual({ week: 3, repeat: false })
    expect(weekOf(SAMPLE_SCHEMA, '2026-12-06', [2])).toEqual({ week: 4, repeat: false })
    expect(schemaEnd(SAMPLE_SCHEMA, [2])).toBe('2026-12-06')
  })

  it('numbers days Monday 1 to Sunday 7', () => {
    expect(['2026-11-02', '2026-11-04', '2026-11-08'].map(weekdayOf)).toEqual([1, 3, 7])
  })
})

describe('prescriptions', () => {
  const squat = item(SAMPLE_SCHEMA, 'back-squat')

  it('steps a progression up week by week, deloads, and tests', () => {
    expect(prescriptionFor(squat, 1, SAMPLE_SCHEMA)!.sets).toHaveLength(5)
    expect(prescriptionFor(squat, 2, SAMPLE_SCHEMA)!.sets[0]).toEqual({ reps: 5, pct: 0.75 })
    expect(prescriptionFor(squat, 3, SAMPLE_SCHEMA)!.sets).toEqual(Array(3).fill({ reps: 5, pct: 0.6 }))
    expect(prescriptionFor(squat, 4, SAMPLE_SCHEMA)!.sets).toEqual([{ test: 'ladder' }])
  })

  it("doesn't count a deload inside a phase as a step", () => {
    const long = { ...squat, progression: { phases: [{ weeks: [1, 4] as [number, number], sets: 3, reps: 3, startPct: 0.7, stepPct: 0.05 }], deload: { sets: 2, reps: 3, pct: 0.6 } } }
    const at = (w: number) => prescriptionFor(long, w, { deloadWeeks: [3] })!.sets[0]!.pct
    expect([1, 2, 3, 4].map(at)).toEqual([0.7, 0.75, 0.6, 0.8])
  })

  it('turns percentages into weights at the PR, rounded to the lift\'s step', () => {
    expect(planSets({ reps: 5, pct: 0.65 }, 155, 5)).toEqual([{ reps: 5, seconds: null, weight: 100 }])
    expect(planSets({ reps: 5, pct: 0.65625 }, 72, 2.5)[0]!.weight).toBe(47.5)
    expect(planSets({ reps: 5, pct: 0.65 }, null, 5)[0]!.weight).toBeNull()
    expect(planSets({ seconds: 30 }, 100, 5)).toEqual([{ reps: null, seconds: 30, weight: null }])
    expect(roundTo(57.4, 2.5)).toBe(57.5)
  })

  it('expands a test into the ladder, ending on an attempt -- or on a sure single', () => {
    expect(describeSets(planSets({ test: 'ladder' }, 155, 5))).toBe('3 @ 110, 2 @ 125, 1 @ 140, 1 @ 145, 1 @ 160 (PR attempt)')
    const single = planSets({ test: 'single' }, 70, 2.5)
    expect(single.at(-1)).toEqual({ reps: 1, seconds: null, weight: 70 })
    expect(single.some((s) => s.attempt)).toBe(false)
  })

  it('says whether an item is on in a week', () => {
    expect(itemOn(item(SAMPLE_SCHEMA, 'strict-press'), 3, SAMPLE_SCHEMA)).toBe(false)
    expect(itemOn(item(SAMPLE_SCHEMA, 'zone2'), 3, SAMPLE_SCHEMA)).toBe(true)
    expect(itemOn({ id: 'x', name: 'x', check: true, onlyWeeks: [2, 3] }, 1, SAMPLE_SCHEMA)).toBe(false)
  })

  it('estimates a max from a set', () => {
    expect(e1rm(100, 1)).toBe(100)
    expect(e1rm(100, 5)).toBe(116.7)
  })
})

describe('the WOD bank', () => {
  it('is written only in movements the library has, and every swap leads somewhere', () => {
    for (const wod of WOD_BANK) for (const p of wod.parts) expect(MOVEMENT.has(p.move), `${wod.id}: ${p.move}`).toBe(true)
    const subs = (m: (typeof MOVEMENTS)[number]) => (m.sub ? [m.sub].flat() : [])
    expect(MOVEMENTS.filter((m) => subs(m).some((x) => !MOVEMENT.has(x.to))).map((m) => m.id)).toEqual([])
    expect(new Set(WOD_BANK.map((w) => w.id)).size).toBe(WOD_BANK.length)
  })

  it('swaps what the gear (or the ankle) rules out, and snaps dumbbells to the pairs there are', () => {
    const spooky = WOD_BANK.find((w) => w.id === 'spooky-21s')!
    const dumbbellsOnly: Equipment = { gear: ['dumbbells', 'bike'], dumbbells: [15, 25], kettlebells: [] }
    const view = viewWod(spooky, dumbbellsOnly)!
    expect(view.lines[0]).toBe('DB thrusters (2×15 lb)')
    expect(view.swaps[0]).toMatch(/in place of thrusters @ 45 lb/)
    const cycling = WOD_BANK.find((w) => w.id === 'barbell-cycling')!
    expect(viewWod(cycling, SAMPLE_EQUIPMENT)!.lines).toContain('20 single-unders')
    const lowImpact = viewWod(cycling, SAMPLE_EQUIPMENT, true)!
    expect(lowImpact.lines).toContain('17 cal bike') // the swap joins the bike calories beside it
    expect(lowImpact.swaps).toEqual(['7 cal bike in place of 20 single-unders'])
    expect(snapWeight(22, [15, 20, 25])).toBe(20)
    expect(snapWeight(22, [])).toBe(22)
  })

  it('merges a swap into the same movement beside it, and loads a swapped-in dumbbell movement', () => {
    const noRings: Equipment = { gear: ['dumbbells', 'bike'], dumbbells: [15, 20, 25], kettlebells: [] }
    const boat = viewWod(WOD_BANK.find((w) => w.id === 'row-row-row')!, noRings)!
    expect(boat.lines.slice(0, 2)).toEqual(['22 DB bent-over rows (2×25 lb)', '10 cal bike'])
    const fran = viewWod(WOD_BANK.find((w) => w.id === 'fran-ish')!, noRings)!
    expect(fran.lines).toEqual(['DB thrusters (2×20 lb)', 'DB bent-over rows (2×20 lb)'])
  })

  it('keeps a WOD to one place when the gear is split between rooms, and says which', () => {
    const split = cleanEquipment({ places: [
      { name: 'Living room', gear: ['bike', 'ab-mat'], dumbbells: [15, 20, 25, 30] },
      { name: 'Garage', gear: ['barbell', 'plates', 'pullup-bar', 'rings', 'jump-rope'] },
    ] })
    expect(split.gear).toEqual(['barbell', 'plates', 'dumbbells', 'pullup-bar', 'rings', 'ab-mat', 'jump-rope', 'bike'])
    // Pull-ups and the bike: in one place, the garage, the bike becomes jump rope or burpees -- never the living room's bike.
    const pullPushPedal = viewWod(WOD_BANK.find((w) => w.id === 'pull-push-pedal')!, split)!
    expect(pullPushPedal.place).toBe('Garage')
    expect(pullPushPedal.lines.join(' ')).not.toMatch(/cal bike/)
    const pressPairing = viewWod(WOD_BANK.find((w) => w.id === 'press-pairing')!, split)!
    expect(pressPairing).toMatchObject({ place: 'Living room', lines: ['10 DB push press (2×25 lb)', '12 cal bike', '10 V-ups'] })
  })

  it('leaves out WODs a schema hides', () => {
    const slot = { maxMinutes: 15, focus: ['upper' as const, 'bike' as const] }
    const all = fittingWods(slot, SAMPLE_EQUIPMENT).map((w) => w.id)
    expect(fittingWods(slot, SAMPLE_EQUIPMENT, [], [all[0]!]).map((w) => w.id)).not.toContain(all[0])
  })

  it('falls back to bodyweight when nothing on hand can stand in, and leaves out what it can\'t place', () => {
    const rowChipper = WOD_BANK.find((w) => w.id === 'row-chipper')!
    const bare = viewWod(rowChipper, { gear: [], dumbbells: [], kettlebells: [] }, true)!
    expect(bare.lines[0]).toBe('120 mountain climbers') // 40 cal row, by way of 120 single-unders: no rope, and nothing that jumps on low impact
    expect(viewWod({ ...rowChipper, parts: [{ move: 'teleport', amount: 1 }] }, SAMPLE_EQUIPMENT)).toBeNull()
  })

  it('offers only what fits the slot, skips recent ones, and keeps the same picks for a day', () => {
    const slot = { maxMinutes: 15, focus: ['upper' as const, 'bike' as const] }
    const fits = fittingWods(slot, SAMPLE_EQUIPMENT)
    expect(fits.length).toBeGreaterThan(3)
    for (const w of fits) {
      expect(w.minutes).toBeLessThanOrEqual(15)
      expect(w.focus.every((f) => ['upper', 'bike', 'core'].includes(f))).toBe(true)
    }
    const a = pickWods(slot, SAMPLE_EQUIPMENT, { seed: '2026-11-04' })
    expect(a).toHaveLength(3)
    expect(pickWods(slot, SAMPLE_EQUIPMENT, { seed: '2026-11-04' })).toEqual(a)
    const fresh = pickWods(slot, SAMPLE_EQUIPMENT, { seed: '2026-11-04', recent: a.map((w) => w.id) })
    expect(fresh.some((w) => a.some((x) => x.id === w.id))).toBe(false)
  })
})

describe('validating a schema', () => {
  it('accepts the sample and drops what it doesn\'t know', () => {
    const { schema, errors } = cleanSchema({ ...clone(), extra: 'ignored' }, ctx)
    expect(errors).toEqual([])
    expect(schema).not.toHaveProperty('extra')
    expect(schema!.days.map((d) => d.weekday)).toEqual([1, 3, 4])
  })

  it('lists every problem, readably', () => {
    const bad = clone() as unknown as Record<string, unknown>
    bad.startDate = '2026-11-03'
    const s = bad as unknown as TrainingSchema
    s.days[0]!.sessions[0]!.kind = 'skiing'
    Object.assign(item(s, 'back-squat').progression!.phases[0]!, { startPct: 1.05, stepPct: 0.1 })
    item(s, 'mobility').minutes = { 1: 10 }
    const { schema, errors } = cleanSchema(bad, ctx)
    expect(schema).toBeNull()
    expect(errors).toEqual(expect.arrayContaining([
      'startDate: must be a Monday, YYYY-MM-DD',
      expect.stringMatching(/kind must be one of wod, weightlifting/),
      expect.stringMatching(/climbs to 115% of the PR/),
      expect.stringMatching(/Hip mobility\): needs exactly one of/),
    ]))
  })

  it('wants percentages tied to a lift, and a test week that tests something', () => {
    const s = clone()
    delete item(s, 'strict-press').lift
    item(s, 'back-squat').progression!.test = undefined
    const { errors } = cleanSchema(s, ctx)
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Strict press\): uses percentages, so it needs a lift/),
    ]))
    const t = clone()
    item(t, 'back-squat').progression!.test = undefined
    delete item(t, 'strict-press').weeks!['4']
    expect(cleanSchema(t, ctx).errors).toContain('testWeek: week 4 is a test week, but no lift is tested in it')
  })

  it('refuses a WOD slot nothing in the bank can fill with the gear on hand', () => {
    const s = clone()
    item(s, 'wod-slot').wod = { maxMinutes: 5 }
    expect(cleanSchema(s, ctx).errors.join()).toMatch(/no WOD in the bank fits/)
  })

  it('checks a schema\'s own WODs movement by movement', () => {
    const s = { ...clone(), wods: [{ id: 'mine', name: 'Mine', format: 'amrap', minutes: 10, parts: [{ move: 'teleport', amount: 5 }] }] }
    expect(cleanSchema(s, ctx).errors.join()).toMatch(/move must be a movement id/)
  })

  it('cleans equipment to known gear and sensible weights', () => {
    expect(cleanEquipment({ gear: ['bike', 'hovercraft', 'barbell'], dumbbells: [25, 15, 15, -3, 'x'] })).toEqual({ gear: ['barbell', 'dumbbells', 'bike'], dumbbells: [15, 25], kettlebells: [] }) // weights listed: the bells are there
    expect(cleanEquipment(null)).toEqual({ gear: [], dumbbells: [], kettlebells: [] })
  })
})
