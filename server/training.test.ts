import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store, ValidationError } from './store.ts'
import { generateSchema, nextStart } from './training-gen.ts'
import { SAMPLE_EQUIPMENT, SAMPLE_SCHEMA } from '../src/lib/training/sample.ts'
import type { TrainingSchema } from '../src/types.ts'

let dir: string
let store: Store

// Week 1 of the sample: Monday legs, Wednesday press + WOD, Thursday ride.
const MON = '2026-11-02'
const WED = '2026-11-04'
const THU = '2026-11-05'

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-training-'))
  store = new Store({ dir })
  store.setSettings({ equipment: SAMPLE_EQUIPMENT })
  store.training.save(SAMPLE_SCHEMA)
  store.training.setPr('squat', { pr: 100, date: '2026-10-01' })
  store.training.setPr('press', { pr: 60, date: '2026-10-01' })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const session = (date: string, id: string) => store.training.day(date).sessions.find((s) => s.id === id)!
const itemOf = (date: string, id: string) => store.training.day(date).sessions.flatMap((s) => s.items).find((i) => i.id === id)!

describe('training schemas', () => {
  it('imports one and follows it, with its lifts', () => {
    const [only] = store.training.list()
    expect(only).toMatchObject({ name: 'Sample block', status: 'active', startDate: MON, endDate: '2026-11-29' })
    expect(store.training.lifts().map((l) => [l.id, l.pr])).toEqual([['squat', 100], ['press', 60]])
  })

  it('refuses a broken schema with every problem listed', () => {
    const bad = { ...structuredClone(SAMPLE_SCHEMA), weeks: 40, startDate: '2026-11-03' }
    expect(() => store.training.save(bad)).toThrow(ValidationError)
    expect(() => store.training.save(bad)).toThrow(/startDate: must be a Monday[\s\S]*weeks: must be a whole number/)
  })

  it('lays out a day: sets at today\'s PRs, minutes, WOD picks, and the week around it', () => {
    const day = store.training.day(MON)
    expect(day).toMatchObject({ week: 1, deload: false, test: false })
    const squat = itemOf(MON, 'back-squat')
    expect(squat.sets!.map((s) => [s.reps, s.weight])).toEqual(Array(5).fill([5, 70]))
    expect(squat.notes).toBe('Pins just below the bottom.')
    expect(itemOf(THU, 'zone2')).toMatchObject({ type: 'minutes', minutes: 40, done: false })
    const wod = itemOf(WED, 'wod-slot').wod!
    expect(wod.picks).toHaveLength(3)
    expect(day.strip.map((d) => d.sessions.map((s) => s.id))).toEqual([['legs'], [], ['press-day', 'wod-wed'], ['ride'], [], [], []])
    expect(store.training.day('2026-11-16')).toMatchObject({ week: 3, deload: true })
    expect(store.training.day('2026-12-01')).toMatchObject({ week: null, sessions: [] })
  })

  it('logs the session in the workout log with its first set, and takes it out with its last', () => {
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    let workouts = store.getDay(MON).workouts
    expect(workouts.sessions).toHaveLength(1)
    expect(workouts.sessions[0]).toMatchObject({ kind: 'weightlifting', note: 'Legs' })
    expect(store.getDay(MON).dayType).toBe('training')
    expect(workouts.planned).toEqual(['Legs'])
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 1, reps: 5, weight: 70 })
    expect(store.getDay(MON).workouts.sessions).toHaveLength(1)
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, done: false })
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 1, done: false })
    workouts = store.getDay(MON).workouts
    expect(workouts.sessions).toHaveLength(0)
  })

  it('keeps what was really lifted, marks the item done once every set is, and spots a beaten PR', () => {
    const { day } = store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 4, weight: 75 })
    const set = day.sessions[0]!.items[0]!.sets![0]!
    expect(set.log).toMatchObject({ reps: 4, weight: 75, done: true })
    for (let i = 1; i < 5; i++) store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: i, reps: 5, weight: 70 })
    expect(itemOf(MON, 'back-squat').done).toBe(true)
    expect(session(MON, 'legs').done).toBe(false) // the mobility tick is still open
    expect(store.training.logSet({ date: MON, itemId: 'mobility' }).day.sessions[0]!.done).toBe(true)
    expect(store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 1, weight: 105 }).newPr).toEqual({ lift: 'squat', name: 'Back squat', weight: 105 })
  })

  it('refuses a set for an item that isn\'t on that day', () => {
    expect(() => store.training.logSet({ date: MON, itemId: 'strict-press', setIndex: 0 })).toThrow(/isn't on the plan/)
    expect(() => store.training.logSet({ date: '2027-03-01', itemId: 'back-squat' })).toThrow(/outside the active schema/)
    expect(() => store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, weight: -5 })).toThrow(ValidationError)
  })

  it('recalculates every weight from a new PR, and keeps the history', () => {
    store.training.setPr('squat', { pr: 140, date: '2026-11-03' })
    expect(itemOf(MON, 'back-squat').sets![0]!.weight).toBe(100) // 70% of 140
    expect(store.training.progress().lifts.find((l) => l.id === 'squat')!.prs).toEqual([{ date: '2026-10-01', weight: 100 }, { date: '2026-11-03', weight: 140 }])
    expect(() => store.training.setPr('bench', { pr: 100 })).toThrow(/no such lift/)
  })

  it('picks a WOD for the slot, and leaves it out of the next two weeks\' picks', () => {
    const first = itemOf(WED, 'wod-slot').wod!.picks[0]!.id
    const day = store.training.setWod({ date: WED, itemId: 'wod-slot', wodId: first })
    expect(day.sessions.find((s) => s.id === 'wod-wed')!.items[0]!.wod).toMatchObject({ chosen: first })
    expect(itemOf('2026-11-11', 'wod-slot').wod!.picks.map((p) => p.id)).not.toContain(first)
    expect(() => store.training.setWod({ date: WED, itemId: 'wod-slot', wodId: 'nope' })).toThrow(/no such WOD/)
  })

  it('repeats a week, moving the rest back', () => {
    store.training.repeatWeek('2026-11-10')
    expect(store.training.day('2026-11-16')).toMatchObject({ week: 2, repeat: true })
    expect(store.training.list()[0]!.endDate).toBe('2026-12-06')
  })

  it('keeps one draft at a time, and following it retires the schema before', () => {
    const active = store.training.list()[0]!
    const next = { ...structuredClone(SAMPLE_SCHEMA), name: 'Next block', startDate: '2026-11-30', basedOn: active.id }
    store.training.save(next, 'draft')
    const draft = store.training.save({ ...next, name: 'Next block, take two' }, 'draft')
    expect(store.training.list().filter((s) => s.status === 'draft').map((s) => s.name)).toEqual(['Next block, take two'])
    expect(store.training.day(MON).draft).toMatchObject({ name: 'Next block, take two' })
    store.training.activate(draft.id)
    expect(store.training.list().map((s) => [s.name, s.status])).toEqual([['Next block, take two', 'active'], ['Sample block', 'done']])
    expect(() => store.training.remove(draft.id)).toThrow(/can't be deleted/)
  })

  it('charts top sets per lift, and timed baselines', () => {
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 1, reps: 3, weight: 75 })
    store.training.logSet({ date: THU, itemId: 'dead-hang', setIndex: 0, seconds: 34 })
    const p = store.training.progress()
    expect(p.lifts.find((l) => l.id === 'squat')!.points).toEqual([{ date: MON, weight: 75, reps: 3, e1rm: 82.5 }])
    expect(p.baselines).toEqual([{ itemId: 'dead-hang', name: 'Dead hang', unit: 's', points: [{ date: THU, value: 34 }] }])
  })

  it('reports how a schema went, set by set, for the next one to be written from', () => {
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 65 })
    const report = store.training.report(store.training.list()[0]!.id, '2026-11-12')
    expect(report).toMatch(/Back squat \(squat\):\n {2}week 1 2026-11-02: planned 5×5 @ 70; done 1\/5 sets, top 65×5, 1 set\(s\) at a different weight than planned/)
    expect(report).toMatch(/Legs: 1\/2/)
    expect(report).toMatch(/Zone 2 ride: 0\/2/)
  })

  it('upgrades a database from before training schemas', () => {
    store.setSettings({ trainingModel: 'big/model' })
    const db = new DatabaseSync(path.join(dir, 'macros.sqlite'))
    try {
      db.exec('ALTER TABLE settings DROP COLUMN equipment')
      db.exec('ALTER TABLE settings DROP COLUMN training_model')
      db.exec('PRAGMA user_version = 17')
    } finally {
      db.close()
    }
    const upgraded = new Store({ dir })
    expect(upgraded.getSettings()).toMatchObject({ trainingModel: '', equipment: { gear: [], dumbbells: [], kettlebells: [] } })
    expect(upgraded.training.list()).toHaveLength(1)
  })
})

describe('writing the next schema', () => {
  const MODELS = { models: [{ type: 'llm', key: 'big/coach', loaded_instances: [{ id: 'big/coach' }], capabilities: { reasoning: { allowed_options: ['off', 'low', 'on'] } } }] }

  /** LM Studio stand-in that answers each chat with the next of `replies`. */
  function lmStudio(replies: string[]) {
    const chats: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify(MODELS), { status: 200 })
      chats.push(JSON.parse(String(init!.body)))
      const reply = replies[chats.length - 1] ?? ''
      const enc = new TextEncoder()
      return new Response(new ReadableStream({ start(c) {
        for (const e of [{ type: 'message.delta', content: reply }, { type: 'chat.end' }]) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
        c.close()
      } }), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchImpl, chats }
  }

  const proposal = (): TrainingSchema => {
    const s = structuredClone(SAMPLE_SCHEMA)
    s.name = 'Block 2'
    s.goals = 'Squat up 5%: every week was finished.'
    delete s.days[0]!.sessions[0]!.items[0]!.notes // carried over from the last schema by id
    return s
  }

  it('starts the Monday after the schema ends', () => {
    expect(nextStart('2026-11-29')).toBe('2026-11-30')
    expect(nextStart('2026-11-25')).toBe('2026-11-30')
  })

  it('saves a valid reply as a draft, fixing what the model doesn\'t decide', async () => {
    const { fetchImpl, chats } = lmStudio([`Here it is:\n\`\`\`json\n${JSON.stringify({ ...proposal(), startDate: '2030-01-07' })}\n\`\`\``])
    const settings = { ...store.getSettings(), trainingModel: 'big/coach' }
    const { draft, model } = await generateSchema({ training: store.training, settings, fetchImpl, note: 'more pressing' })
    expect(model).toBe('big/coach')
    expect(draft).toMatchObject({ name: 'Block 2', status: 'draft', startDate: '2026-11-30', basedOn: store.training.list().find((s) => s.status === 'active')!.id })
    const saved = store.training.overview(draft.id).schema
    expect(saved.days[0]!.sessions[0]!.items[0]!.notes).toBe('Pins just below the bottom.')
    expect(chats).toHaveLength(1)
    expect(chats[0]!.reasoning).toBe('off')
    expect(String(chats[0]!.input)).toMatch(/How it went:[\s\S]*The person asks: more pressing/)
    expect(String(chats[0]!.system_prompt)).toMatch(/A training schema is one JSON object/)
  })

  it('shows the model its mistakes, then gives up without saving anything', async () => {
    const broken = JSON.stringify({ ...proposal(), weeks: 99 })
    const ok = lmStudio([broken, JSON.stringify(proposal())])
    const settings = store.getSettings()
    await expect(generateSchema({ training: store.training, settings, fetchImpl: ok.fetchImpl })).resolves.toMatchObject({ draft: { name: 'Block 2' } })
    expect(String(ok.chats[1]!.input)).toMatch(/It has these problems:\n- weeks: must be a whole number from 1 to 16/)

    const bad = lmStudio([broken, broken, broken])
    await expect(generateSchema({ training: store.training, settings, fetchImpl: bad.fetchImpl })).rejects.toThrow(/still had problems after 3 tries: weeks/)
  })

  it('keeps the lift ids the PRs are under, mapping a renamed lift back', async () => {
    const s = proposal()
    s.lifts = [{ id: 'back-squat', name: 'Back Squat', increment: 5 }, { id: 'press', name: 'Strict press', increment: 2.5 }]
    s.days[0]!.sessions[0]!.items[0]!.lift = 'back-squat'
    const { fetchImpl, chats } = lmStudio([JSON.stringify(s)])
    const { draft } = await generateSchema({ training: store.training, settings: store.getSettings(), fetchImpl })
    const saved = store.training.overview(draft.id)
    expect(saved.schema.lifts.map((l) => l.id)).toEqual(['squat', 'press'])
    expect(saved.lifts[0]).toMatchObject({ lift: 'squat', weeks: [{ week: 1, top: 70 }, expect.anything(), expect.anything(), expect.anything()] })
    expect(String(chats[0]!.input)).toMatch(/Lift ids \(fixed; .*squat \(Back squat, PR 100 lb\)/)
    expect(store.training.lifts().map((l) => l.id)).toEqual(['squat', 'press']) // nothing new until it's followed
  })

  it('leaves rest days out instead of keeping a made-up rest session', async () => {
    const s = proposal() as unknown as { days: { weekday: number; sessions: { id: string; title: string; kind: string; items: unknown[] }[] }[] }
    s.days.push({ weekday: 7, sessions: [{ id: 'rest', title: 'Rest', kind: 'rest', items: [{ id: 'walk', name: 'Walk', check: true }] }] })
    const { fetchImpl } = lmStudio([JSON.stringify(s)])
    const { draft } = await generateSchema({ training: store.training, settings: store.getSettings(), fetchImpl })
    expect(store.training.overview(draft.id).schema.days.map((d) => d.weekday)).toEqual([1, 3, 4])
  })

  it('takes an item with nothing to log as a tick', async () => {
    const s = proposal() as unknown as { days: { sessions: { items: Record<string, unknown>[] }[] }[] }
    delete s.days[0]!.sessions[0]!.items[1]!.check
    const { fetchImpl } = lmStudio([JSON.stringify(s)])
    const { draft } = await generateSchema({ training: store.training, settings: store.getSettings(), fetchImpl })
    expect(store.training.overview(draft.id).schema.days[0]!.sessions[0]!.items[1]).toMatchObject({ id: 'mobility', check: true })
  })

  it('reads percent as fractions, and a flat { pct } phase as one that doesn\'t step', async () => {
    const s = proposal()
    Object.assign(s.days[0]!.sessions[0]!.items[0]!.progression!.phases[0]!, { startPct: 70, stepPct: 2.5 })
    s.days[0]!.sessions[0]!.items[0]!.progression!.phases.push({ weeks: [3, 3], sets: 3, reps: 5, pct: 0.6 } as never)
    const { fetchImpl } = lmStudio([JSON.stringify(s)])
    const { draft } = await generateSchema({ training: store.training, settings: store.getSettings(), fetchImpl })
    expect(store.training.overview(draft.id).schema.days[0]!.sessions[0]!.items[0]!.progression!.phases[0]).toMatchObject({ startPct: 0.7, stepPct: 0.025 })
    expect(store.training.overview(draft.id).schema.days[0]!.sessions[0]!.items[0]!.progression!.phases[1]).toEqual({ weeks: [3, 3], sets: 3, reps: 5, startPct: 0.6, stepPct: 0 })
  })

  it('needs a schema to build on', async () => {
    const empty = new Store({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-training-empty-')) })
    await expect(generateSchema({ training: empty.training, settings: empty.getSettings(), fetchImpl: lmStudio([]).fetchImpl })).rejects.toThrow(/no active training schema/)
  })
})
