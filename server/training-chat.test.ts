import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store } from './store.ts'
import { applyProposal, checkEdits, coachContext, coachReply, previewEdits, undoProposal } from './training-chat.ts'
import { SAMPLE_EQUIPMENT, SAMPLE_SCHEMA } from '../src/lib/training/sample.ts'
import type { PlanEdit } from '../src/types.ts'

let dir: string
let store: Store

// The sample's week 1: Monday legs, Wednesday press + WOD, Thursday ride.
const MON = '2026-11-02'
const WED = '2026-11-04'
const THU = '2026-11-05'
const SAT = '2026-11-07'

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-coach-'))
  store = new Store({ dir })
  store.setSettings({ equipment: SAMPLE_EQUIPMENT })
  store.training.save(SAMPLE_SCHEMA)
  store.training.setPr('squat', { pr: 100 })
  store.training.setPr('press', { pr: 60 })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const plan = () => store.training.activePlan()!
const titles = (date: string) => store.training.day(date).sessions.map((s) => s.title)
const apply = (edits: PlanEdit[], today = MON) => {
  const checked = checkEdits(store.training, plan(), edits, today, store.getSettings())
  expect(checked.errors).toEqual([])
  store.training.addOverrides(plan().id, checked.overrides, null)
  return checked
}

describe('one-off changes', () => {
  it('moves a session to another day, where it can be logged, and says so on both days', () => {
    apply([{ op: 'move', sessionId: 'legs', from: MON, to: SAT }])
    expect(titles(MON)).toEqual([])
    expect(titles(SAT)).toEqual(['Legs'])
    expect(store.training.day(SAT).sessions[0]!.items[0]!.sets![0]!.weight).toBe(70) // week 1's weights, from where it came
    expect(store.training.day(MON).adjustments.map((a) => a.text)).toEqual(['Legs moved to Sat, Nov 7'])
    expect(store.training.day(SAT).adjustments.map((a) => a.text)).toEqual(['Legs moved here from Mon, Nov 2'])
    expect(store.training.day(SAT).strip.find((d) => d.date === SAT)!.sessions.map((s) => s.title)).toEqual(['Legs'])
    store.training.logSet({ date: SAT, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    expect(store.getDay(SAT).workouts.sessions).toHaveLength(1)
    expect(store.getDay(SAT).workouts.planned).toEqual(['Legs'])
    expect(store.getDay(SAT).workouts.fromPlan).toEqual([store.getDay(SAT).workouts.sessions[0]!.id])
  })

  it('skips a session or a whole day, lightens weights, and stands one item in for another', () => {
    apply([
      { op: 'skip', date: WED, sessionId: 'wod-wed' },
      { op: 'load', from: MON, to: '2026-11-08', factor: 0.9, lifts: ['squat'] },
      { op: 'swap', from: THU, to: THU, itemId: 'dead-hang', item: { id: 'ring-hang', name: 'Ring hang', sets: { sets: [{ seconds: 20 }] } } },
    ])
    expect(titles(WED)).toEqual(['Press'])
    expect(store.training.day(MON).sessions[0]!.items[0]!.sets![0]!.weight).toBe(65) // 70 × 0.9, to the nearest 5
    expect(store.training.day(WED).sessions[0]!.items[0]!.sets![0]!.weight).toBe(40) // press untouched: 65% of 60
    const thu = store.training.day(THU).sessions[0]!.items
    expect(thu.map((i) => i.name)).toEqual(['Zone 2 ride', 'Ring hang'])
    expect(thu[1]!.sets![0]).toMatchObject({ seconds: 20 })
    expect(store.training.day(THU).adjustments.map((a) => a.text)).toEqual(['Ring hang in place of Dead hang until Thu, Nov 5'])
  })

  it('offers WODs for the gear on hand while traveling', () => {
    apply([{ op: 'equipment', from: WED, to: WED, equipment: { gear: ['bike'], dumbbells: [], kettlebells: [] } }])
    const picks = store.training.day(WED).sessions.find((s) => s.id === 'wod-wed')!.items[0]!.wod!.picks
    expect(picks.length).toBeGreaterThan(0)
    for (const p of picks) expect(p.lines.join(' ')).not.toMatch(/DB|lb\)/)
  })

  it('refuses edits that name what isn\'t there, or days outside the plan', () => {
    const { errors } = checkEdits(store.training, plan(), [
      { op: 'move', sessionId: 'nope', from: WED, to: SAT },
      { op: 'skip', date: '2020-01-01' },
      { op: 'load', from: WED, to: SAT, factor: 3 },
      { op: 'swap', from: WED, to: WED, itemId: 'strict-press', item: { id: 'x', name: 'Mystery' } },
    ] as PlanEdit[], WED, store.getSettings())
    expect(errors).toEqual([
      'edit 1 (move): there\'s no session "nope" on 2026-11-04',
      'edit 2 (skip): date must be within the plan, 2026-11-02 to 2026-11-29',
      'edit 3 (load): factor must be 0.5 to 1.2 (0.9 is 10% lighter)',
      expect.stringMatching(/^edit 4 \(swap\): item.*needs exactly one of/),
    ])
  })

  it('lets a newer stand-in for the same item and day replace an older one', () => {
    apply([{ op: 'swap', from: THU, to: THU, itemId: 'dead-hang', item: { id: 'hang-a', name: 'Dead hang', sets: { sets: [{ seconds: 20 }] } } }])
    apply([{ op: 'swap', from: THU, to: THU, itemId: 'dead-hang', item: { id: 'hang-b', name: 'Dead hang', sets: '3x15s' as never } }])
    expect(store.training.day(THU).sessions[0]!.items[1]!.sets!.map((x) => x.seconds)).toEqual([15, 15, 15])
    expect(store.training.day(THU).adjustments.map((a) => a.text)).toEqual(['Dead hang: 3×15 s until Thu, Nov 5'])
  })

  it('takes back one change on its own', () => {
    apply([{ op: 'skip', date: WED }])
    const [adj] = store.training.day(WED).adjustments
    store.training.removeOverride(adj!.id)
    expect(titles(WED)).toEqual(['Press', 'WOD'])
  })

  it('changes a day that has already passed, so the record matches what was done', () => {
    const checked = checkEdits(store.training, plan(), [{ op: 'removeItem', itemId: 'mobility', fromWeek: 1 }], WED, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, WED)).toEqual(['Mon, Nov 2, Nov 9, Nov 16, Nov 23 · no Hip mobility'])
    apply([{ op: 'skip', date: MON, sessionId: 'legs' }], WED)
    expect(titles(MON)).toEqual([])
  })
})

describe('optional work', () => {
  it("makes a session optional for every week, so the day counts as done without it", () => {
    const checked = checkEdits(store.training, plan(), [{ op: 'setOptional', sessionId: 'wod-wed', optional: true }], MON, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, MON)).toEqual(['Optional from now on: WOD'])
    store.training.revise(plan().id, checked.revised!, 'coach', null)
    const wed = store.training.day(WED)
    expect(wed.sessions.find((s) => s.id === 'wod-wed')).toMatchObject({ optional: true })
    for (let i = 0; i < 2; i++) store.training.logSet({ date: WED, itemId: 'strict-press', setIndex: i, reps: 5, weight: 40 })
    expect(store.training.day(WED).strip.find((d) => d.date === WED)!.sessions.map((s) => [s.id, s.done, s.optional ?? false])).toEqual([['press-day', true, false], ['wod-wed', false, true]])
  })
})

describe('naming and focus', () => {
  it('renames a session for every week, and says so', () => {
    const checked = checkEdits(store.training, plan(), [{ op: 'renameSession', sessionId: 'press-day', title: 'Overhead squat' }], MON, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, MON)).toEqual(['Renamed: Press → Overhead squat'])
    store.training.revise(plan().id, checked.revised!, 'coach', null)
    expect(titles(WED)[0]).toBe('Overhead squat')
    expect(checkEdits(store.training, plan(), [{ op: 'renameSession', sessionId: 'press-day', title: 'Workout' }], MON, store.getSettings()).errors.join()).toMatch(/name the session by what's in it/)
  })

  it('renames a session for only some weeks, when what is in it changes', () => {
    const checked = checkEdits(store.training, plan(), [{ op: 'renameSession', sessionId: 'press-day', title: 'Press test', fromWeek: 1, toWeek: 1 }], MON, store.getSettings())
    expect(checked.errors).toEqual([])
    store.training.revise(plan().id, checked.revised!, 'coach', null)
    expect(titles(WED)[0]).toBe('Press test')
    expect(titles('2026-11-11')[0]).toBe('Press')
  })

})

describe('the record', () => {
  it('takes a workout added by hand off the card, and one from a session with its ticks, and undoes both', () => {
    const extra = store.addWorkout({ date: MON, kind: 'weightlifting' })
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    const fromPlan = store.getDay(MON).workouts.sessions.find((w) => w.note === 'Legs')!
    expect(store.getDay(MON).workouts.sessions).toHaveLength(2)
    expect(store.training.recordOf(plan(), MON).workouts.map((w) => [w.kind, w.session])).toEqual(expect.arrayContaining([['weightlifting', null], ['weightlifting', 'legs']]))

    const edits: PlanEdit[] = [{ op: 'removeWorkout', workoutId: extra.id }, { op: 'removeWorkout', workoutId: fromPlan.id }]
    const checked = checkEdits(store.training, plan(), edits, WED, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, WED)).toEqual([
      'Mon, Nov 2: remove the weightlifting workout from the Workouts card',
      'Mon, Nov 2: remove the weightlifting workout "Legs" from the Workouts card, and untick its session',
    ])
    const id = store.training.addMessage(plan().id, 'assistant', 'Done.', { edits, preview: [] })
    applyProposal(store.training, id, WED, store.getSettings(), () => {})
    expect(store.getDay(MON).workouts.sessions).toHaveLength(0)
    expect(store.training.day(MON).sessions[0]!.items[0]!.sets![0]!.log).toBeNull()
    undoProposal(store.training, id)
    expect(store.getDay(MON).workouts.sessions.map((w) => w.id).sort()).toEqual([extra.id, fromPlan.id].sort())
    expect(store.training.day(MON).sessions[0]!.items[0]!.sets![0]!.log).toMatchObject({ weight: 70 })
  })

  it('ticks a whole session off, and unticks it', () => {
    const tick = checkEdits(store.training, plan(), [{ op: 'logSession', date: THU, sessionId: 'ride' }], THU, store.getSettings())
    expect(previewEdits(store.training, plan(), tick, THU)).toEqual(['Thu, Nov 5: tick off Zone 2'])
    store.training.logSession(THU, 'ride', null)
    expect(store.training.day(THU).sessions[0]!.done).toBe(true)
    expect(store.getDay(THU).workouts.sessions.map((w) => w.kind)).toEqual(['cycling'])
    store.training.unlogSession(THU, 'ride', null)
    expect(store.training.day(THU).sessions[0]!.done).toBe(false)
    expect(store.getDay(THU).workouts.sessions).toHaveLength(0)
    expect(checkEdits(store.training, plan(), [{ op: 'removeWorkout', workoutId: 'nope' }], THU, store.getSettings()).errors).toEqual(['edit 1 (removeWorkout): there\'s no logged workout "nope"'])
  })

  it('shows the coach what was logged each day, and which workouts came from where', () => {
    store.addWorkout({ date: MON, kind: 'yoga' })
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    const ctx = coachContext(store.training, plan(), WED, store.getSettings())
    expect(ctx).toMatch(/session legs "Legs" \[weightlifting\] -- partly done/)
    expect(ctx).toMatch(/logged workout \[workout [\w-]+\] yoga -- added by hand with the \+ button/)
    expect(ctx).toMatch(/logged workout \[workout [\w-]+\] weightlifting "Legs" -- from session legs/)
    expect(ctx).toMatch(/Wed, Nov 4 2026-11-04 \(TODAY\)/)
  })
})

describe('session titles', () => {
  it('refuses a session named for nothing in it, and takes one named for what it is', () => {
    const session = (title: string) => ({ id: 'extra', title, kind: 'weightlifting', items: [{ id: 'dl', name: 'Deadlift', check: true as const }] })
    for (const title of ['Strength session', 'Workout', 'extra lifting', '']) {
      const { errors } = checkEdits(store.training, plan(), [{ op: 'addSession', weekday: 7, session: session(title), toWeek: 1 }], MON, store.getSettings())
      expect(errors.join()).toMatch(/name the session by what's in it/)
    }
    expect(checkEdits(store.training, plan(), [{ op: 'addSession', weekday: 7, session: session('Back squat + deadlift') }], MON, store.getSettings()).errors).toEqual([])
  })
})

describe('the WOD bank and the places', () => {
  it('sets the places, adds a WOD and hides one, all undone together', () => {
    const edits: PlanEdit[] = [
      { op: 'setPlaces', places: [{ name: 'Living room', gear: ['bike'], dumbbells: [20], kettlebells: [] }, { name: 'Garage', gear: ['barbell', 'plates', 'rack', 'pullup-bar', 'bands', 'jump-rope'], dumbbells: [], kettlebells: [] }] },
      { op: 'addWod', wod: { id: 'cindy-ish', name: 'Cindy-ish', format: 'amrap', minutes: 20, parts: [{ move: 'pull-up', amount: 5 }, { move: 'push-up', amount: 10 }, { move: 'air-squat', amount: 15 }] } },
      { op: 'hideWod', wodId: 'core-spin' },
    ]
    const checked = checkEdits(store.training, plan(), edits, MON, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, MON)).toEqual([
      'Living room: bike, dumbbells 20 lb',
      'Garage: barbell, plates, rack, pullup-bar, bands, jump-rope',
      '+ WOD Cindy-ish: 20-min AMRAP, 5 pull-ups, 10 push-ups, 15 air squats (Garage)',
      'No more Core Spin in the WOD picks',
    ])
    const before = store.getSettings().equipment
    const id = store.training.addMessage(plan().id, 'assistant', 'Set up.', { edits, preview: [] })
    applyProposal(store.training, id, MON, store.getSettings(), () => {})
    expect(store.getSettings().equipment.places!.map((p) => p.name)).toEqual(['Living room', 'Garage'])
    expect(plan().schema).toMatchObject({ wods: [{ id: 'cindy-ish' }], hiddenWods: ['core-spin'] })
    const picks = store.training.day(WED).sessions.find((s) => s.id === 'wod-wed')!.items[0]!.wod!.picks
    expect(picks.every((p) => p.place)).toBe(true)
    expect(picks.map((p) => p.id)).not.toContain('core-spin')
    undoProposal(store.training, id)
    expect(store.getSettings().equipment).toEqual(before)
    expect(plan().schema.wods).toBeUndefined()
  })

  it("refuses a WOD that's already there, or one to hide that isn't", () => {
    const { errors } = checkEdits(store.training, plan(), [
      { op: 'addWod', wod: { id: 'core-spin', name: 'Again', format: 'amrap', minutes: 10, parts: [{ move: 'push-up', amount: 5 }] } },
      { op: 'hideWod', wodId: 'nope' },
    ], MON, store.getSettings())
    expect(errors).toEqual(['addWod: there\'s already a WOD "core-spin"', 'hideWod: there\'s no WOD "nope"'])
  })
})

describe('previews', () => {
  it('spells out a move and a lighter week from the days before and after, saving nothing', () => {
    const checked = checkEdits(store.training, plan(), [
      { op: 'move', sessionId: 'legs', from: MON, to: SAT },
      { op: 'load', from: WED, to: WED, factor: 0.8, lifts: ['press'] },
    ], MON, store.getSettings())
    expect(previewEdits(store.training, plan(), checked, MON)).toEqual([
      'Wed, Nov 4 · Strict press: 2×5 @ 40 → 2×5 @ 32.5',
      'Mon, Nov 2 → Sat, Nov 7: Legs',
    ])
    expect(titles(MON)).toEqual(['Legs']) // rolled back
  })

  it('previews a lasting change from the week it starts, the same change on several days in one line', () => {
    const checked = checkEdits(store.training, plan(), [
      { op: 'addSession', weekday: 7, session: { id: 'sun', title: 'Easy run', kind: 'run', items: [{ id: 'easy', name: 'Easy run', minutes: { 2: 20, 3: 20, 4: 20 } }] }, fromWeek: 2 },
    ], MON, store.getSettings())
    expect(checked.errors).toEqual([])
    expect(previewEdits(store.training, plan(), checked, MON)).toEqual(['Sun, Nov 15, Nov 22, Nov 29: + Easy run (Easy run)'])
  })
})

describe('the coach', () => {
  const MODELS = { models: [{ type: 'llm', key: 'mid/coach', loaded_instances: [{ id: 'mid/coach' }], capabilities: { reasoning: { allowed_options: ['off', 'on'] } } }] }
  function lmStudio(replies: string[]) {
    const chats: Record<string, unknown>[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify(MODELS), { status: 200 })
      chats.push(JSON.parse(String(init!.body)))
      const enc = new TextEncoder()
      const reply = replies[chats.length - 1] ?? ''
      return new Response(new ReadableStream({ start(c) {
        const events = [
          { type: 'prompt_processing.start' }, { type: 'prompt_processing.progress', progress: 0.5 },
          { type: 'message.start' }, { type: 'message.delta', content: reply },
          { type: 'chat.end', result: { stats: { input_tokens: 5000, total_output_tokens: 40, reasoning_output_tokens: 0, tokens_per_second: 25, time_to_first_token_seconds: 1.5 } } },
        ]
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
        c.close()
      } }), { status: 200 })
    }) as unknown as typeof fetch
    return { fetchImpl, chats }
  }
  const statuses: string[] = []
  const say = (text: string, replies: string[]) => {
    const lm = lmStudio(replies)
    statuses.length = 0
    const onStatus = (s: { phase: string; progress: number | null }) => { statuses.push(`${s.phase}${s.progress !== null ? ` ${s.progress}` : ''}`) }
    return { lm, run: coachReply({ training: store.training, settings: { ...store.getSettings(), planChatModel: 'mid/coach' }, fetchImpl: lm.fetchImpl, text, today: MON, onStatus }) }
  }

  it('says what it is doing while it answers: reading the plan, writing, checking the change', async () => {
    const reply = JSON.stringify({ reply: 'I can skip it.', edits: [{ op: 'skip', date: WED, sessionId: 'wod-wed' }] })
    await say('skip the wod', [reply]).run
    expect([...new Set(statuses)]).toEqual(['reading', 'reading 0', 'reading 0.5', 'writing', 'checking'])
  })

  it('answers a question in plain words, with the plan and how it has gone in its prompt', async () => {
    const { lm, run } = say('How am I doing?', ['You have not started yet, but the plan builds sensibly toward the test week.'])
    const messages = await run
    expect(messages[1]!.stats).toMatchObject({ model: 'mid/coach', inputTokens: 5000, outputTokens: 40, tokensPerSecond: 25, firstTokenSeconds: 1.5 })
    expect(messages.map((m) => [m.role, m.text, m.proposal])).toEqual([
      ['user', 'How am I doing?', null],
      ['assistant', 'You have not started yet, but the plan builds sensibly toward the test week.', null],
    ])
    const input = String(lm.chats[0]!.input)
    expect(input).toMatch(/session legs "Legs" \[weightlifting\] -- not done: Back squat \[item back-squat\] 5×5 @ 70/)
    expect(input).toMatch(/How it has gone so far:/)
    expect(lm.chats[0]!.model).toBe('mid/coach')
  })

  it('sends a screenshot with the message to a model that can see, and keeps it with the message', async () => {
    const shot = 'data:image/png;base64,iVBORw0KGgo='
    const lm = lmStudio(['That screenshot shows Thursday\'s ride.'])
    const visionModels = { models: [{ type: 'llm', key: 'mid/coach', loaded_instances: [{ id: 'mid/coach' }], capabilities: { vision: true } }] }
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) =>
      url.endsWith('/api/v1/models') ? new Response(JSON.stringify(visionModels), { status: 200 }) : lm.fetchImpl(url, init)) as unknown as typeof fetch
    const messages = await coachReply({ training: store.training, settings: { ...store.getSettings(), planChatModel: 'mid/coach' }, fetchImpl, text: 'What is this?', image: shot, today: MON })
    expect(messages[0]).toMatchObject({ role: 'user', text: 'What is this?', image: true })
    expect(store.training.messageImage(messages[0]!.id)).toBe(shot)
    const input = lm.chats[0]!.input as { type: string; content?: string; data_url?: string }[]
    expect(input[1]).toEqual({ type: 'image', data_url: shot })
    expect(input[0]!.content).toMatch(/Person: What is this\? \[screenshot attached/)
  })

  it('says so when the model answers with nothing at all', async () => {
    const last = (await say('Anything?', ['']).run).at(-1)!
    expect(last).toMatchObject({ text: 'No answer came back that time.', proposal: null, note: expect.stringMatching(/^mid\/coach didn't say anything/) })
  })

  it('proposes a change with its preview, applies it, and undoes it', async () => {
    const reply = JSON.stringify({ reply: 'I can move legs to Saturday.', edits: [{ type: 'move', sessionId: 'legs', from: MON, to: SAT }] })
    const messages = await say('Move Monday to Saturday', [reply]).run
    const last = messages.at(-1)!
    expect(last).toMatchObject({ text: 'I can move legs to Saturday.', status: 'proposed', proposal: { preview: ['Mon, Nov 2 → Sat, Nov 7: Legs'] } })
    applyProposal(store.training, last.id, MON, store.getSettings(), () => { throw new Error('not a rewrite') })
    expect(titles(SAT)).toEqual(['Legs'])
    expect(store.training.message(last.id).status).toBe('applied')
    undoProposal(store.training, last.id)
    expect(titles(MON)).toEqual(['Legs'])
    expect(store.training.message(last.id).status).toBe('undone')
  })

  it('reads "pull" and "lower" as WOD focus tags, and names a tag it can\'t read', async () => {
    const slot = (focus: string[]) => ({ type: 'replaceItem', itemId: 'wod-slot', item: { id: 'wod-slot', name: 'Short WOD', wod: { maxMinutes: 15, focus } } })
    const good = JSON.stringify({ reply: 'Pulling and legs.', edits: [slot(['pull', 'lower', 'Upper'])] })
    const last = (await say('More pulling on Wednesdays', [good]).run).at(-1)!
    expect(last.proposal?.edits[0]).toMatchObject({ op: 'replaceItem', item: { wod: { focus: ['upper', 'legs'] } } })
    const { errors } = checkEdits(store.training, plan(), [{ ...slot(['hinge']), op: 'replaceItem' } as unknown as PlanEdit], MON, store.getSettings())
    expect(errors.join()).toMatch(/focus \["hinge"\] isn't a tag/)
  })

  it('shows the model its mistakes once, and makes no proposal when they stay', async () => {
    const bad = JSON.stringify({ reply: 'Done.', edits: [{ op: 'skip', date: '2020-01-01' }] })
    const { lm, run } = say('Skip something', [bad, bad])
    const last = (await run).at(-1)!
    expect(lm.chats).toHaveLength(2)
    expect(String(lm.chats[1]!.input)).toMatch(/Its edits have these problems:\n- edit 1 \(skip\): date must be within the plan/)
    expect(last).toMatchObject({ proposal: null, note: expect.stringMatching(/couldn't turn that into a change/) })
  })

  it('gets a starting weight and the weeks after it right, after being shown a set written per week', async () => {
    // What happened for real: one "set" per week, which was read as a dozen sets every week.
    const perWeek = JSON.stringify({ reply: 'Starting at 35.', edits: [{ op: 'replaceItem', itemId: 'strict-press', item: { id: 'strict-press', name: 'Strict press', lift: 'press',
      sets: { sets: [{ week: 1, reps: 5, sets: 3, weight: 35 }, { week: 2, reps: 5, sets: 4, weight: 40 }] } } }] })
    const right = JSON.stringify({ reply: 'Starting at 35.', edits: [{ op: 'setWeeks', itemId: 'strict-press', weeks: { 1: '3x5@35', 2: '4x5@40' } }] })
    const { lm, run } = say('Today 3x5 at 35, then build from there', [perWeek, right])
    const last = (await run).at(-1)!
    expect(String(lm.chats[1]!.input)).toMatch(/each entry is ONE set/)
    expect(last.proposal?.preview).toEqual(['Wed, Nov 4 · Strict press: 2×5 @ 40 → 3×5 @ 35', 'Wed, Nov 11 · Strict press: 2×3 @ 45 → 4×5 @ 40'])
    applyProposal(store.training, last.id, MON, store.getSettings(), () => {})
    expect(store.training.day(WED).sessions[0]!.items[0]!.sets!.map((x) => x.weight)).toEqual([35, 35, 35])
    const press = plan().schema.days[1]!.sessions[0]!.items[0]!
    expect(press).toMatchObject({ id: 'strict-press', weeks: { 4: { sets: [{ test: 'ladder' }] } } }) // the same item; the test week stays
  })

  it('puts what changes least first in the prompt, and today and the days around it last', async () => {
    const { lm, run } = say('Hi', ['Hi!'])
    await run
    const input = String(lm.chats[0]!.input)
    expect(input.indexOf('The WOD bank')).toBeLessThan(input.indexOf('The whole plan in outline'))
    expect(input.indexOf('The whole plan in outline')).toBeLessThan(input.indexOf('Today is'))
    expect(input.indexOf('Today is')).toBeLessThan(input.indexOf('Person: Hi'))
  })

  it('makes a lasting change as a revision, and undoes only the latest', async () => {
    const add = (id: string) => JSON.stringify({ reply: 'Added.', edits: [{ op: 'addItem', sessionId: 'legs', item: { id, name: id, check: true }, fromWeek: 2 }] })
    const first = (await say('add one', [add('calves')]).run).at(-1)!
    applyProposal(store.training, first.id, MON, store.getSettings(), () => {})
    const second = (await say('and another', [add('core')]).run).at(-1)!
    applyProposal(store.training, second.id, MON, store.getSettings(), () => {})
    expect(store.training.day('2026-11-09').sessions[0]!.items.map((i) => i.id)).toEqual(['back-squat', 'mobility', 'calves', 'core'])
    expect(() => undoProposal(store.training, first.id)).toThrow(/later change/)
    undoProposal(store.training, second.id)
    undoProposal(store.training, first.id)
    expect(store.training.day('2026-11-09').sessions[0]!.items.map((i) => i.id)).toEqual(['back-squat', 'mobility'])
  })

  it('hands a rewrite to the writer, and a followed rewrite becomes the active schema\'s new body', async () => {
    const reply = JSON.stringify({ reply: 'I can rewrite it.', edits: [{ op: 'rewrite', instruction: 'Three days a week', fromWeek: 2 }] })
    const last = (await say('rewrite it', [reply]).run).at(-1)!
    expect(last.proposal!.preview).toEqual(['Rewrite the plan from week 2: Three days a week'])
    const started: unknown[] = []
    applyProposal(store.training, last.id, MON, store.getSettings(), (r) => started.push(r))
    expect(started).toEqual([{ instruction: 'Three days a week', fromWeek: 2, messageId: last.id }])

    // What the writer saves: a draft marked as a rewrite of the active schema.
    const active = plan()
    const draft = store.training.save({ ...structuredClone(SAMPLE_SCHEMA), name: 'Rewritten', basedOn: active.id }, 'draft', { fromWeek: 2, messageId: last.id })
    expect(draft.rewriteFrom).toBe(2)
    store.training.logSet({ date: MON, itemId: 'back-squat', setIndex: 0, reps: 5, weight: 70 })
    store.training.activate(draft.id)
    expect(plan()).toMatchObject({ id: active.id, schema: { name: 'Rewritten' } })
    expect(store.training.list().map((s) => s.status)).toEqual(['active'])
    expect(store.training.day(MON).sessions[0]!.items[0]!.sets![0]!.log).toMatchObject({ weight: 70 }) // this block's logs stay
    undoProposal(store.training, last.id)
    expect(plan().schema.name).toBe('Sample block')
  })

  it('leaves the next schema a record of what was said and changed', async () => {
    apply([{ op: 'skip', date: WED, sessionId: 'wod-wed' }])
    await say('My shoulder hurts', ['Ease off pressing this week.']).run
    const report = store.training.report(plan().id, '2026-11-08')
    expect(report).toMatch(/One-off changes made with the coach:\n {2}skipped session wod-wed on 2026-11-04/)
    expect(report).toMatch(/What the person told the coach:\n {2}\d{4}-\d{2}-\d{2}: My shoulder hurts/)
  })
})

it('upgrades a database from before the coach', () => {
  const db = new DatabaseSync(path.join(dir, 'macros.sqlite'))
  try {
    db.exec('ALTER TABLE settings DROP COLUMN plan_chat_model')
    db.exec('ALTER TABLE training_schemas DROP COLUMN rewrite')
    db.exec('DROP TABLE training_chat')
    db.exec('PRAGMA user_version = 18')
  } finally {
    db.close()
  }
  const upgraded = new Store({ dir })
  expect(upgraded.getSettings().planChatModel).toBe('')
  expect(upgraded.training.list()[0]!.rewriteFrom).toBeNull()
  expect(upgraded.training.messages(upgraded.training.list()[0]!.id)).toEqual([])
})
