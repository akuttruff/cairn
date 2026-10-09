import { describe, it, expect, vi } from 'vitest'
import { fingerprint, notesInput, tidyNotes, writeNotes } from './notes.ts'
import { DEFAULT_WORKOUT_KINDS } from '../src/types.ts'
import type { RangeView, Settings } from '../src/types.ts'

const ZERO = { calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 }
const GOALS = {
  calories: { min: 1850, max: 1850 }, protein: { min: 130, max: 130 }, fat: { min: 50, max: 50 }, carbs: { min: 165, max: 165 },
  fiber: 25, water: 96, alcoholWeekly: 7, meditationMinutes: 10, dogWalks: 2, walkMiles: 1,
} as RangeView['goals']
const PLAN = { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 0, pilates: 0 }
const NONE = { wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 0, pilates: 0 }

function week(over: Partial<RangeView> = {}): RangeView {
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: `2026-10-0${5 + i > 9 ? '' : ''}${String(5 + i).padStart(2, '0')}`.replace('2026-10-0', '2026-10-'),
    entryCount: i < 3 ? 2 : 0, water: i < 3 ? 80 : 0, alcohol: i === 4 ? 2 : 0, workouts: i === 1 ? 1 : 0, workoutMinutes: 0,
    meditationMinutes: 0, dogWalks: 0, dogMiles: 0, dayType: (i === 1 ? 'training' : 'rest') as 'training' | 'rest',
    goals: GOALS, missing: ZERO, totals: i < 3 ? { calories: 1800, protein: 120 + i, fat: 55, carbs: 150, fiber: 22 } : ZERO,
  }))
  return {
    start: '2026-10-05', end: '2026-10-11', days, goals: GOALS, dayTypes: { training: 1, rest: 6 },
    scorecard: { calories: { met: 3, of: 3 }, protein: { met: 0, of: 3 }, fat: { met: 3, of: 3 }, carbs: { met: 3, of: 3 }, fiber: { met: 0, of: 3 } },
    charts: ['calories'], totalDays: 7, loggedDays: 3, averagedDays: 3, totals: ZERO, averages: { calories: 1800, protein: 121, fat: 55, carbs: 150, fiber: 22 },
    water: { total: 240, average: 80, met: 0, of: 3 }, alcohol: { total: 2, average: 0.3, calories: 250, byKind: { beer: 0, wine: 2, liquor: 0 } },
    workouts: { sessions: 1, days: 1, minutes: 0, kinds: DEFAULT_WORKOUT_KINDS, byKind: { ...NONE, wod: 1 }, goalByKind: PLAN, goal: 4 },
    meditation: { total: 0, average: 0, days: 0, met: 0, of: 0, streak: 0 },
    dog: { walks: 0, miles: 0, days: 0, met: 0, of: 0, streak: 0 },
    body: { weight: null, bodyFat: null, leanMass: null, bmi: null },
    ...over,
  } as RangeView
}

const SETTINGS = { lmStudioUrl: 'http://127.0.0.1:1234', lmStudioToken: 't', researchModel: 'qwen/qwen3.8-27b', notesModel: 'qwen/qwen3.5-9b' } as Settings

describe('notes on a week or month', () => {
  it('lays out the goals, the period and each day for the model, saying which days had nothing', () => {
    const input = notesInput(week())
    expect(input).toMatch(/^Week: 2026-10-05 to 2026-10-11\. Logged 3 of 7 days/)
    expect(input).toMatch(/protein min 130 g, fat min 50 g, carbs max 165 g/)
    expect(input).toMatch(/Goal days met: calories 3\/3, protein 0\/3/)
    expect(input).toMatch(/2026-10-05 rest: 1800\/120\/55\/150\/22/)
    expect(input).toMatch(/2026-10-11 rest: nothing logged/)
  })

  it('changes its fingerprint when a day\u2019s numbers do, and not otherwise', () => {
    const a = week()
    expect(fingerprint(week())).toBe(fingerprint(a))
    const b = week()
    b.days[0] = { ...b.days[0]!, totals: { ...b.days[0]!.totals, protein: 140 } }
    expect(fingerprint(b)).not.toBe(fingerprint(a))
  })

  it('keeps whole sentences and drops formatting the model was asked not to use', () => {
    expect(tidyNotes('## Notes\n**Protein** ran short on most days this week. Next week, add a shake on')).toBe('Notes\nProtein ran short on most days this week.')
    expect(tidyNotes('All good.')).toBe('All good.')
  })

  it('writes with the notes model, not the lookup one, and reasoning as cheap as it goes', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (url.endsWith('/api/v1/models')) {
        return new Response(JSON.stringify({ models: [
          { type: 'llm', key: 'qwen/qwen3.5-9b', loaded_instances: [{ id: 'qwen/qwen3.5-9b' }], capabilities: { reasoning: { allowed_options: ['off', 'on'] } } },
          { type: 'llm', key: 'qwen/qwen3.8-27b', loaded_instances: [{ id: 'qwen/qwen3.8-27b' }] },
        ] }), { status: 200 })
      }
      const enc = new TextEncoder()
      return new Response(new ReadableStream({ start(c) {
        for (const e of [{ type: 'message.delta', content: 'You logged three days. Protein ran short.' }, { type: 'chat.end' }]) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
        c.close()
      } }), { status: 200 })
    }) as unknown as typeof fetch
    const out = await writeNotes(week(), SETTINGS, fetchImpl)
    expect(out).toEqual({ text: 'You logged three days. Protein ran short.', model: 'qwen/qwen3.5-9b' })
    const chat = calls.find((c) => c.url.endsWith('/api/v1/chat'))!.body!
    expect(chat.model).toBe('qwen/qwen3.5-9b')
    expect(chat.reasoning).toBe('off')
    expect(String(chat.input)).toMatch(/^Week: 2026-10-05/)
  })
})
