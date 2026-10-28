import type { Gear, WodFocus } from '../../types.ts'

/**
 * The movements WODs are written in. Each says what it needs, how it's
 * counted, what it mostly works, and whether it jumps or runs -- and what
 * stands in for it when the gear isn't there or impact is off (the bike,
 * usually, at a rough equal effort).
 */

/**
 * A stand-in: `factor` of the amount, and how far it strays from the original -- 1 for a near
 * equal (cardio for cardio, a strict pull-up for a banded one), 3 (the default) for another movement.
 */
export interface Sub { to: string; factor: number; cost?: number }

export interface Movement {
  id: string
  name: string
  unit: 'reps' | 'cal' | 'm' | 's'
  /** Any one of these sets of gear will do; an empty list needs nothing. */
  needs: Gear[][]
  focus: WodFocus
  impact?: boolean
  /** Loaded with dumbbells or kettlebells, so a WOD's weight is per bell. */
  bells?: 'dumbbells' | 'kettlebells'
  /** What to do instead, `factor` of this one's amount: the first of these the gear (and the impact rule) allows. */
  sub?: Sub | Sub[]
}

const BAR: Gear[] = ['barbell', 'plates']
const RACKED: Gear[] = ['barbell', 'plates', 'rack']
const DB: Gear[] = ['dumbbells']

export const MOVEMENTS: Movement[] = [
  // Monostructural
  // Cardio stands in for cardio at about the same effort: a calorie is about three single-unders.
  { id: 'bike-cal', name: 'cal bike', unit: 'cal', needs: [['bike']], focus: 'bike', sub: [{ to: 'row-cal', factor: 1, cost: 1 }, { to: 'single-under', factor: 3, cost: 1 }, { to: 'burpee', factor: 0.33, cost: 2 }] },
  { id: 'row-cal', name: 'cal row', unit: 'cal', needs: [['rower']], focus: 'bike', sub: [{ to: 'bike-cal', factor: 1, cost: 1 }, { to: 'single-under', factor: 3, cost: 1 }, { to: 'burpee', factor: 0.33, cost: 2 }] },
  { id: 'run', name: 'm run', unit: 'm', needs: [], focus: 'legs', impact: true, sub: [{ to: 'bike-cal', factor: 0.05, cost: 1 }, { to: 'row-cal', factor: 0.05, cost: 1 }, { to: 'single-under', factor: 0.15, cost: 1 }] },
  { id: 'single-under', name: 'single-unders', unit: 'reps', needs: [['jump-rope']], focus: 'bike', impact: true, sub: [{ to: 'bike-cal', factor: 1 / 3, cost: 1 }, { to: 'row-cal', factor: 1 / 3, cost: 1 }, { to: 'mountain-climber', factor: 1, cost: 2 }] },
  { id: 'double-under', name: 'double-unders', unit: 'reps', needs: [['jump-rope']], focus: 'bike', impact: true, sub: [{ to: 'single-under', factor: 2, cost: 1 }, { to: 'bike-cal', factor: 0.5, cost: 1 }] },
  { id: 'jumping-jack', name: 'jumping jacks', unit: 'reps', needs: [], focus: 'bike', impact: true, sub: { to: 'bike-cal', factor: 0.25 } },
  { id: 'burpee', name: 'burpees', unit: 'reps', needs: [], focus: 'full', impact: true, sub: [{ to: 'bike-cal', factor: 3, cost: 2 }, { to: 'row-cal', factor: 3, cost: 2 }, { to: 'mountain-climber', factor: 4, cost: 2 }] },
  { id: 'box-jump', name: 'box jumps', unit: 'reps', needs: [['box']], focus: 'legs', impact: true, sub: { to: 'db-step-up', factor: 1, cost: 1 } },

  // Barbell
  { id: 'deadlift', name: 'deadlifts', unit: 'reps', needs: [BAR], focus: 'legs', sub: { to: 'db-deadlift', factor: 1, cost: 1 } },
  { id: 'front-squat', name: 'front squats', unit: 'reps', needs: [RACKED], focus: 'legs', sub: { to: 'goblet-squat', factor: 1, cost: 1 } },
  { id: 'back-squat', name: 'back squats', unit: 'reps', needs: [RACKED], focus: 'legs', sub: { to: 'goblet-squat', factor: 1, cost: 1 } },
  { id: 'thruster', name: 'thrusters', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-thruster', factor: 1, cost: 1 } },
  { id: 'push-press', name: 'push press', unit: 'reps', needs: [BAR], focus: 'upper', sub: { to: 'db-push-press', factor: 1, cost: 1 } },
  { id: 'strict-press', name: 'strict press', unit: 'reps', needs: [BAR], focus: 'upper', sub: { to: 'db-strict-press', factor: 1, cost: 1 } },
  { id: 'push-jerk', name: 'push jerks', unit: 'reps', needs: [BAR], focus: 'upper', sub: { to: 'db-push-press', factor: 1, cost: 1 } },
  { id: 'hang-power-clean', name: 'hang power cleans', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-hang-clean', factor: 1, cost: 1 } },
  { id: 'power-clean', name: 'power cleans', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-hang-clean', factor: 1, cost: 1 } },
  { id: 'hang-power-snatch', name: 'hang power snatches', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-snatch', factor: 1, cost: 1 } },
  { id: 'overhead-squat', name: 'overhead squats', unit: 'reps', needs: [BAR], focus: 'legs', sub: { to: 'db-overhead-squat', factor: 1, cost: 1 } },
  { id: 'sdhp', name: 'sumo deadlift high pulls', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-high-pull', factor: 1, cost: 1 } },
  { id: 'barbell-row', name: 'bent-over rows', unit: 'reps', needs: [BAR], focus: 'upper', sub: { to: 'db-row', factor: 1, cost: 1 } },
  { id: 'barbell-lunge', name: 'back-rack reverse lunges', unit: 'reps', needs: [RACKED], focus: 'legs', sub: { to: 'db-reverse-lunge', factor: 1, cost: 1 } },
  { id: 'ground-to-overhead', name: 'ground-to-overheads (lowered, no drops)', unit: 'reps', needs: [BAR], focus: 'full', sub: { to: 'db-clean-jerk', factor: 1, cost: 1 } },

  // Dumbbells: with no dumbbells, the barbell version first (the same lift), then bodyweight.
  { id: 'db-thruster', name: 'DB thrusters', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: [{ to: 'thruster', factor: 1, cost: 1 }, { to: 'air-squat', factor: 1.5 }] },
  { id: 'db-push-press', name: 'DB push press', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'upper', sub: [{ to: 'push-press', factor: 1, cost: 1 }, { to: 'pike-push-up', factor: 1 }] },
  { id: 'db-strict-press', name: 'DB strict press', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'upper', sub: [{ to: 'strict-press', factor: 1, cost: 1 }, { to: 'pike-push-up', factor: 1 }] },
  { id: 'db-snatch', name: 'alternating DB snatches', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: [{ to: 'hang-power-snatch', factor: 1, cost: 1 }, { to: 'burpee', factor: 0.5 }] },
  { id: 'db-hang-clean', name: 'DB hang cleans', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: [{ to: 'hang-power-clean', factor: 1, cost: 1 }, { to: 'burpee', factor: 0.5 }] },
  { id: 'db-clean-jerk', name: 'DB clean and jerks', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: [{ to: 'ground-to-overhead', factor: 1, cost: 1 }, { to: 'burpee', factor: 0.5 }] },
  { id: 'db-deadlift', name: 'DB deadlifts', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'deadlift', factor: 1, cost: 1 }, { to: 'glute-bridge', factor: 1.5 }] },
  { id: 'db-rdl', name: 'DB Romanian deadlifts', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'deadlift', factor: 1, cost: 2 }, { to: 'glute-bridge', factor: 1.5 }] },
  { id: 'goblet-squat', name: 'goblet squats', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'front-squat', factor: 1, cost: 1 }, { to: 'air-squat', factor: 1.5 }] },
  { id: 'db-overhead-squat', name: 'single-arm DB overhead squats', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'overhead-squat', factor: 1, cost: 1 }, { to: 'air-squat', factor: 1 }] },
  { id: 'db-reverse-lunge', name: 'DB reverse lunges', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'barbell-lunge', factor: 1, cost: 1 }, { to: 'reverse-lunge', factor: 1 }] },
  { id: 'db-walking-lunge', name: 'DB walking lunges', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'legs', sub: [{ to: 'barbell-lunge', factor: 1, cost: 2 }, { to: 'reverse-lunge', factor: 1 }] },
  { id: 'db-step-up', name: 'DB step-ups', unit: 'reps', needs: [['dumbbells', 'box']], bells: 'dumbbells', focus: 'legs', sub: { to: 'reverse-lunge', factor: 1 } },
  { id: 'db-row', name: 'DB bent-over rows', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'upper', sub: [{ to: 'barbell-row', factor: 1, cost: 1 }, { to: 'superman', factor: 1 }] },
  { id: 'renegade-row', name: 'renegade rows', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'upper', sub: { to: 'push-up', factor: 1 } },
  { id: 'db-floor-press', name: 'DB floor press', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'upper', sub: { to: 'push-up', factor: 1 } },
  { id: 'db-high-pull', name: 'DB high pulls', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: [{ to: 'sdhp', factor: 1, cost: 1 }, { to: 'burpee', factor: 0.5 }] },
  { id: 'db-swing', name: 'DB swings (kettlebell-style)', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', sub: { to: 'glute-bridge', factor: 1 } },
  { id: 'devil-press', name: 'devil presses', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', impact: true, sub: { to: 'db-push-press', factor: 2 } },
  { id: 'man-maker', name: 'man makers', unit: 'reps', needs: [DB], bells: 'dumbbells', focus: 'full', impact: true, sub: { to: 'renegade-row', factor: 2 } },

  // Kettlebells
  { id: 'kb-swing', name: 'kettlebell swings', unit: 'reps', needs: [['kettlebells']], bells: 'kettlebells', focus: 'full', sub: { to: 'db-swing', factor: 1, cost: 1 } },
  { id: 'kb-goblet-squat', name: 'kettlebell goblet squats', unit: 'reps', needs: [['kettlebells']], bells: 'kettlebells', focus: 'legs', sub: { to: 'goblet-squat', factor: 1, cost: 1 } },

  // Gymnastics and bodyweight
  { id: 'pull-up', name: 'pull-ups', unit: 'reps', needs: [['pullup-bar']], focus: 'upper', sub: [{ to: 'banded-pull-up', factor: 1, cost: 1 }, { to: 'ring-row', factor: 1.5, cost: 2 }] },
  // Without a band, strict pull-ups on the same bar (about half as many), before rows.
  { id: 'banded-pull-up', name: 'banded pull-ups', unit: 'reps', needs: [['pullup-bar', 'bands']], focus: 'upper', sub: [{ to: 'pull-up', factor: 0.5, cost: 1 }, { to: 'ring-row', factor: 1.5, cost: 2 }] },
  { id: 'chest-to-bar', name: 'chest-to-bar pull-ups', unit: 'reps', needs: [['pullup-bar']], focus: 'upper', sub: { to: 'pull-up', factor: 1 } },
  { id: 'toes-to-bar', name: 'toes-to-bar', unit: 'reps', needs: [['pullup-bar']], focus: 'core', sub: { to: 'v-up', factor: 1.5 } },
  { id: 'knees-to-chest', name: 'hanging knee raises', unit: 'reps', needs: [['pullup-bar']], focus: 'core', sub: { to: 'v-up', factor: 1 } },
  { id: 'ring-row', name: 'ring rows', unit: 'reps', needs: [['rings']], focus: 'upper', sub: { to: 'db-row', factor: 1, cost: 2 } },
  { id: 'ring-dip', name: 'ring dips', unit: 'reps', needs: [['rings']], focus: 'upper', sub: { to: 'push-up', factor: 1.5 } },
  { id: 'push-up', name: 'push-ups', unit: 'reps', needs: [], focus: 'upper' },
  { id: 'hand-release-push-up', name: 'hand-release push-ups', unit: 'reps', needs: [], focus: 'upper' },
  { id: 'pike-push-up', name: 'pike push-ups', unit: 'reps', needs: [], focus: 'upper' },
  { id: 'air-squat', name: 'air squats', unit: 'reps', needs: [], focus: 'legs' },
  { id: 'reverse-lunge', name: 'reverse lunges', unit: 'reps', needs: [], focus: 'legs' },
  { id: 'glute-bridge', name: 'glute bridges', unit: 'reps', needs: [], focus: 'legs' },
  { id: 'sit-up', name: 'ab-mat sit-ups', unit: 'reps', needs: [], focus: 'core' },
  { id: 'v-up', name: 'V-ups', unit: 'reps', needs: [], focus: 'core' },
  { id: 'hollow-rock', name: 'hollow rocks', unit: 'reps', needs: [], focus: 'core' },
  { id: 'hollow-hold', name: 'hollow hold', unit: 's', needs: [], focus: 'core' },
  { id: 'plank', name: 'plank', unit: 's', needs: [], focus: 'core' },
  { id: 'superman', name: 'superman holds', unit: 'reps', needs: [], focus: 'core' },
  { id: 'mountain-climber', name: 'mountain climbers', unit: 'reps', needs: [], focus: 'core' },
]

export const MOVEMENT = new Map(MOVEMENTS.map((m) => [m.id, m]))
