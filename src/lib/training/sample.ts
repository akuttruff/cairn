import type { Equipment, TrainingSchema } from '../../types.ts'

/**
 * A small made-up schema with one of everything, for the tests and the
 * docs' example: a progression with a deload and a test week, a spelled-out
 * lift, a WOD slot, ride minutes and a tick. Nobody's real numbers.
 */
export const SAMPLE_SCHEMA: TrainingSchema = {
  schemaVersion: 1,
  name: 'Sample block',
  startDate: '2026-11-02',
  firstWeek: 1,
  weeks: 4,
  deloadWeeks: [3],
  testWeek: 4,
  lifts: [{ id: 'squat', name: 'Back squat', increment: 5 }, { id: 'press', name: 'Strict press', increment: 2.5 }],
  days: [
    {
      weekday: 1,
      sessions: [{
        id: 'legs', title: 'Legs', kind: 'weightlifting', items: [
          {
            id: 'back-squat', name: 'Back squat', lift: 'squat', notes: 'Pins just below the bottom.',
            progression: { phases: [{ weeks: [1, 2], sets: 5, reps: 5, startPct: 0.7, stepPct: 0.05 }], deload: { sets: 3, reps: 5, pct: 0.6 }, test: 'ladder' },
          },
          { id: 'mobility', name: 'Hip mobility', check: true },
        ],
      }],
    },
    {
      weekday: 3,
      sessions: [
        {
          id: 'press-day', title: 'Press', kind: 'weightlifting', items: [{
            id: 'strict-press', name: 'Strict press', lift: 'press',
            weeks: {
              1: { sets: [{ reps: 5, pct: 0.65 }, { reps: 5, pct: 0.65 }] },
              2: { sets: [{ reps: 3, pct: 0.75 }, { reps: 3, pct: 0.75 }] },
              4: { sets: [{ test: 'ladder' }] },
            },
          }],
        },
        { id: 'wod-wed', title: 'WOD', kind: 'wod', items: [{ id: 'wod-slot', name: 'Short WOD', wod: { maxMinutes: 15, focus: ['upper', 'bike'], lowImpact: true } }] },
      ],
    },
    {
      weekday: 4,
      sessions: [{
        id: 'ride', title: 'Zone 2', kind: 'cycling', items: [
          { id: 'zone2', name: 'Zone 2 ride', minutes: { 1: 40, 2: 45, 3: 30, 4: 45 } },
          { id: 'dead-hang', name: 'Dead hang', weeks: { 1: { sets: [{ seconds: 30 }] }, 2: { sets: [{ seconds: 40 }] } } },
        ],
      }],
    },
  ],
}

export const SAMPLE_EQUIPMENT: Equipment = {
  gear: ['barbell', 'plates', 'rack', 'dumbbells', 'pullup-bar', 'bands', 'bike', 'jump-rope'],
  dumbbells: [10, 20, 30],
  kettlebells: [],
}
