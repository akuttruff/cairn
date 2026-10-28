import type { Wod } from '../../types.ts'

/**
 * The WOD bank: workouts written in movements (movements.ts), so each can be
 * checked against the gear on hand and adjusted -- a barbell movement
 * becomes its dumbbell version, a jump rope becomes bike calories. Weights
 * are light-to-moderate defaults in lb (the barbell's total, or each bell);
 * dumbbell weights snap to the nearest pair there is.
 */
export const WOD_BANK: Wod[] = [
  // --- Short and sharp (about 8-15 min) ---
  {
    id: 'bike-and-barbell', name: 'Bike & Barbell', format: 'rft', rounds: 5, minutes: 15,
    parts: [{ move: 'bike-cal', amount: 15 }, { move: 'deadlift', amount: 10, weight: 95 }, { move: 'sit-up', amount: 10 }],
  },
  {
    id: 'spooky-21s', name: 'Spooky 21s', format: 'ladder', scheme: [21, 15, 9], minutes: 12,
    parts: [{ move: 'thruster', weight: 45 }, { move: 'banded-pull-up' }, { move: 'bike-cal' }],
  },
  {
    id: 'fran-ish', name: 'Partner-free Fran-ish', format: 'ladder', scheme: [21, 15, 9], minutes: 8,
    parts: [{ move: 'db-thruster', weight: 20 }, { move: 'ring-row' }],
  },
  {
    id: 'press-pairing', name: 'Press Pairing', format: 'rft', rounds: 5, minutes: 14,
    parts: [{ move: 'db-push-press', amount: 10, weight: 25 }, { move: 'bike-cal', amount: 12 }, { move: 'v-up', amount: 10 }],
  },
  {
    id: 'upper-ladder', name: 'Upper Ladder', format: 'ladder', scheme: [15, 12, 9, 6, 3], minutes: 12,
    parts: [{ move: 'db-push-press', weight: 20 }, { move: 'ring-row' }, { move: 'bike-cal' }],
  },
  {
    id: 'spin-and-press', name: 'Spin & Press', format: 'amrap', minutes: 12,
    parts: [{ move: 'bike-cal', amount: 10 }, { move: 'db-strict-press', amount: 8, weight: 20 }, { move: 'hollow-rock', amount: 12 }],
  },
  {
    id: 'pull-push-pedal', name: 'Pull, Push, Pedal', format: 'emom', minutes: 15,
    parts: [{ move: 'banded-pull-up', amount: 6 }, { move: 'push-up', amount: 10 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'row-row-row', name: 'Row Your Boat', format: 'rft', rounds: 4, minutes: 13,
    parts: [{ move: 'ring-row', amount: 12 }, { move: 'db-row', amount: 10, weight: 25 }, { move: 'bike-cal', amount: 10 }, { move: 'plank', amount: 30 }],
  },
  {
    id: 'shoulder-shred', name: 'Shoulder Shred', format: 'rft', rounds: 3, minutes: 12,
    parts: [{ move: 'db-push-press', amount: 12, weight: 15 }, { move: 'ring-dip', amount: 8 }, { move: 'bike-cal', amount: 15 }],
  },
  {
    id: 'hollow-man', name: 'Hollow Man', format: 'amrap', minutes: 10,
    parts: [{ move: 'toes-to-bar', amount: 5 }, { move: 'hand-release-push-up', amount: 8 }, { move: 'hollow-hold', amount: 20 }, { move: 'bike-cal', amount: 8 }],
  },
  {
    id: 'quick-cycle', name: 'Quick Cycle', format: 'ladder', scheme: [12, 9, 6], minutes: 9,
    parts: [{ move: 'hang-power-clean', weight: 55 }, { move: 'push-press', weight: 55 }, { move: 'bike-cal' }],
  },
  {
    id: 'renegade', name: 'Renegade', format: 'rft', rounds: 4, minutes: 12,
    parts: [{ move: 'renegade-row', amount: 10, weight: 15 }, { move: 'db-floor-press', amount: 12, weight: 20 }, { move: 'bike-cal', amount: 10 }],
  },
  {
    id: 'dip-and-pull', name: 'Dip & Pull', format: 'emom', minutes: 12,
    parts: [{ move: 'ring-dip', amount: 5 }, { move: 'banded-pull-up', amount: 5 }, { move: 'bike-cal', amount: 10 }],
  },
  {
    id: 'core-spin', name: 'Core Spin', format: 'rft', rounds: 5, minutes: 12,
    parts: [{ move: 'bike-cal', amount: 12 }, { move: 'v-up', amount: 12 }, { move: 'superman', amount: 10 }],
  },

  // --- Middle distance (about 15-20 min) ---
  {
    id: 'dumbbell-grinder', name: 'Dumbbell Grinder', format: 'amrap', minutes: 20,
    parts: [{ move: 'db-snatch', amount: 10, weight: 25 }, { move: 'goblet-squat', amount: 10, weight: 25 }, { move: 'push-up', amount: 10 }, { move: 'bike-cal', amount: 15 }],
  },
  {
    id: 'barbell-cycling', name: 'Barbell Cycling', format: 'rft', rounds: 4, minutes: 16,
    parts: [{ move: 'front-squat', amount: 10, weight: 75 }, { move: 'push-press', amount: 10, weight: 55 }, { move: 'bike-cal', amount: 10 }, { move: 'single-under', amount: 20 }],
  },
  {
    id: 'ride-and-row', name: 'Ride & Row', format: 'amrap', minutes: 18,
    parts: [{ move: 'bike-cal', amount: 15 }, { move: 'ring-row', amount: 12 }, { move: 'db-push-press', amount: 10, weight: 20 }, { move: 'sit-up', amount: 15 }],
  },
  {
    id: 'clean-cycle', name: 'Clean Cycle', format: 'rft', rounds: 5, minutes: 17,
    parts: [{ move: 'hang-power-clean', amount: 8, weight: 55 }, { move: 'banded-pull-up', amount: 8 }, { move: 'bike-cal', amount: 14 }],
  },
  {
    id: 'devils-ride', name: "Devil's Ride", format: 'rft', rounds: 4, minutes: 16,
    parts: [{ move: 'devil-press', amount: 8, weight: 20 }, { move: 'bike-cal', amount: 15 }, { move: 'hollow-rock', amount: 15 }],
  },
  {
    id: 'emom-24', name: 'EMOM 24', format: 'emom', minutes: 24,
    parts: [{ move: 'bike-cal', amount: 12 }, { move: 'db-push-press', amount: 10, weight: 20 }, { move: 'v-up', amount: 15 }, { move: 'single-under', amount: 50 }],
  },
  {
    id: 'snatch-and-spin', name: 'Snatch & Spin', format: 'emom', minutes: 18,
    parts: [{ move: 'db-snatch', amount: 12, weight: 20 }, { move: 'bike-cal', amount: 12 }, { move: 'plank', amount: 40 }],
  },
  {
    id: 'thruster-ladder', name: 'Thruster Ladder', format: 'ladder', scheme: [3, 6, 9, 12, 15, 18], minutes: 16,
    parts: [{ move: 'db-thruster', weight: 15 }, { move: 'bike-cal' }],
    notes: 'Climb as far as you can in 16 minutes.',
  },
  {
    id: 'high-pull-highway', name: 'High-Pull Highway', format: 'amrap', minutes: 15,
    parts: [{ move: 'sdhp', amount: 10, weight: 55 }, { move: 'push-up', amount: 10 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'swing-state', name: 'Swing State', format: 'rft', rounds: 5, minutes: 15,
    parts: [{ move: 'kb-swing', amount: 15, weight: 25 }, { move: 'banded-pull-up', amount: 6 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'man-maker-mile', name: 'Man-Maker Mile', format: 'rft', rounds: 4, minutes: 18,
    parts: [{ move: 'man-maker', amount: 6, weight: 15 }, { move: 'run', amount: 400 }],
  },
  {
    id: 'press-and-pull', name: 'Press & Pull', format: 'amrap', minutes: 16,
    parts: [{ move: 'strict-press', amount: 6, weight: 45 }, { move: 'ring-row', amount: 10 }, { move: 'bike-cal', amount: 10 }, { move: 'hollow-hold', amount: 20 }],
  },
  {
    id: 'skipping-stones', name: 'Skipping Stones', format: 'rft', rounds: 5, minutes: 15,
    parts: [{ move: 'single-under', amount: 60 }, { move: 'db-hang-clean', amount: 10, weight: 20 }, { move: 'push-up', amount: 10 }],
  },

  // --- Long (about 20-30 min) ---
  {
    id: 'chipper', name: 'Chipper', format: 'chipper', minutes: 25,
    parts: [
      { move: 'bike-cal', amount: 50 }, { move: 'db-walking-lunge', amount: 40, weight: 20 }, { move: 'ring-row', amount: 30 },
      { move: 'hang-power-clean', amount: 20, weight: 45 }, { move: 'burpee', amount: 10 },
    ],
  },
  {
    id: 'long-haul', name: 'Long Haul', format: 'intervals', minutes: 25,
    text: '3 rounds: 4 × (30 s bike sprint, 30 s easy), then 3 min rest. Then 3 rounds of:',
    parts: [{ move: 'db-swing', amount: 15, weight: 25 }, { move: 'hollow-hold', amount: 30 }],
  },
  {
    id: 'upper-chipper', name: 'Upper Chipper', format: 'chipper', minutes: 22,
    parts: [
      { move: 'bike-cal', amount: 40 }, { move: 'ring-row', amount: 40 }, { move: 'db-push-press', amount: 30, weight: 20 },
      { move: 'push-up', amount: 20 }, { move: 'v-up', amount: 30 }, { move: 'bike-cal', amount: 40 },
    ],
  },
  {
    id: 'pyramid-ride', name: 'Pyramid Ride', format: 'intervals', minutes: 24,
    text: 'Bike 1-2-3-4-3-2-1 min hard with equal easy spinning between. Then 3 rounds of:',
    parts: [{ move: 'banded-pull-up', amount: 8 }, { move: 'push-up', amount: 12 }],
  },
  {
    id: 'twenty-minute-triplet', name: 'Twenty-Minute Triplet', format: 'amrap', minutes: 20,
    parts: [{ move: 'bike-cal', amount: 12 }, { move: 'db-hang-clean', amount: 10, weight: 20 }, { move: 'toes-to-bar', amount: 8 }],
  },
  {
    id: 'long-emom', name: 'Long EMOM', format: 'emom', minutes: 30,
    parts: [
      { move: 'bike-cal', amount: 14 }, { move: 'db-snatch', amount: 10, weight: 20 }, { move: 'ring-row', amount: 10 },
      { move: 'push-up', amount: 10 }, { move: 'plank', amount: 45 },
    ],
  },
  {
    id: 'saturday-steady', name: 'Saturday Steady', format: 'rft', rounds: 3, minutes: 24,
    parts: [
      { move: 'bike-cal', amount: 25 }, { move: 'db-push-press', amount: 15, weight: 20 }, { move: 'ring-row', amount: 15 },
      { move: 'sit-up', amount: 20 }, { move: 'db-row', amount: 12, weight: 25 },
    ],
  },
  {
    id: 'run-and-gun', name: 'Run & Gun', format: 'rft', rounds: 5, minutes: 22,
    parts: [{ move: 'run', amount: 400 }, { move: 'db-thruster', amount: 12, weight: 20 }, { move: 'banded-pull-up', amount: 8 }],
  },
  {
    id: 'barbell-complex', name: 'Barbell Complex', format: 'emom', minutes: 20,
    notes: 'Odd minutes: 3 deadlifts + 3 hang power cleans + 3 push press, light. Even minutes: the bike.',
    parts: [{ move: 'deadlift', amount: 3, weight: 65 }, { move: 'hang-power-clean', amount: 3, weight: 65 }, { move: 'push-press', amount: 3, weight: 65 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'legs-day-out', name: 'Legs Day Out', format: 'rft', rounds: 4, minutes: 20,
    parts: [{ move: 'goblet-squat', amount: 15, weight: 25 }, { move: 'db-reverse-lunge', amount: 12, weight: 15 }, { move: 'bike-cal', amount: 15 }, { move: 'glute-bridge', amount: 20 }],
  },
  {
    id: 'box-and-bells', name: 'Box & Bells', format: 'amrap', minutes: 18,
    parts: [{ move: 'box-jump', amount: 10 }, { move: 'kb-goblet-squat', amount: 12, weight: 25 }, { move: 'kb-swing', amount: 15, weight: 25 }],
  },
  {
    id: 'row-chipper', name: 'Row Chipper', format: 'chipper', minutes: 24,
    parts: [
      { move: 'row-cal', amount: 40 }, { move: 'thruster', amount: 30, weight: 45 }, { move: 'chest-to-bar', amount: 20 },
      { move: 'row-cal', amount: 30 }, { move: 'double-under', amount: 50 },
    ],
  },
  {
    id: 'death-by-bike', name: 'Bike Builder', format: 'emom', minutes: 16,
    notes: 'Add 1 calorie each minute: 5 the first minute, 6 the second, until you can\'t finish one in the minute.',
    parts: [{ move: 'bike-cal', amount: 5 }],
  },
]
