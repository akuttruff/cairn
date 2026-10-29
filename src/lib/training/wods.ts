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
  // --- Garage: barbell, rack, pull-up bar, rings, bands and a jump rope, no bike ---
  {
    id: 'cindy', name: 'Cindy', format: 'amrap', minutes: 20,
    parts: [{ move: 'pull-up', amount: 5 }, { move: 'push-up', amount: 10 }, { move: 'air-squat', amount: 15 }],
  },
  {
    id: 'grace-ish', name: 'Grace-ish', format: 'chipper', minutes: 8,
    parts: [{ move: 'ground-to-overhead', amount: 30, weight: 65 }],
  },
  {
    id: 'isabel-ish', name: 'Isabel-ish', format: 'chipper', minutes: 8,
    parts: [{ move: 'hang-power-snatch', amount: 30, weight: 45 }],
  },
  {
    id: 'deadlift-and-knees', name: 'Deadlift & Knees', format: 'ladder', scheme: [21, 15, 9], minutes: 10,
    parts: [{ move: 'deadlift', weight: 115 }, { move: 'knees-to-chest' }],
  },
  {
    id: 'helen-in-the-garage', name: 'Helen in the Garage', format: 'rft', rounds: 3, minutes: 14,
    parts: [{ move: 'single-under', amount: 90 }, { move: 'sdhp', amount: 15, weight: 55 }, { move: 'banded-pull-up', amount: 12 }],
  },
  {
    id: 'ring-cycle', name: 'Ring Cycle', format: 'emom', minutes: 16,
    parts: [{ move: 'ring-row', amount: 8 }, { move: 'ring-dip', amount: 6 }, { move: 'single-under', amount: 40 }, { move: 'hollow-rock', amount: 10 }],
  },
  {
    id: 'front-rack-and-rope', name: 'Front Rack & Rope', format: 'amrap', minutes: 12,
    parts: [{ move: 'front-squat', amount: 8, weight: 75 }, { move: 'single-under', amount: 40 }],
  },
  {
    id: 'squat-and-skip', name: 'Squat & Skip', format: 'emom', minutes: 10,
    parts: [{ move: 'back-squat', amount: 5, weight: 95 }, { move: 'single-under', amount: 30 }],
  },
  {
    id: 'dt-light', name: 'DT-light', format: 'rft', rounds: 5, minutes: 18,
    parts: [{ move: 'deadlift', amount: 12, weight: 75 }, { move: 'hang-power-clean', amount: 9, weight: 75 }, { move: 'push-jerk', amount: 6, weight: 75 }],
  },
  {
    id: 'overhead-ladder', name: 'Overhead Ladder', format: 'ladder', scheme: [15, 12, 9, 6, 3], minutes: 12,
    parts: [{ move: 'overhead-squat', weight: 45 }, { move: 'banded-pull-up' }],
  },
  {
    id: 'clean-rope-burpee', name: 'Clean, Rope, Burpee', format: 'intervals', minutes: 16,
    text: '4 rounds: 3 min work, 1 min rest. In each 3 min, as many rounds as you can of:',
    parts: [{ move: 'power-clean', amount: 5, weight: 75 }, { move: 'single-under', amount: 30 }, { move: 'burpee', amount: 5 }],
  },
  {
    id: 'bar-rows-and-press', name: 'Bar Rows & Press', format: 'amrap', minutes: 15,
    parts: [{ move: 'barbell-row', amount: 10, weight: 75 }, { move: 'strict-press', amount: 8, weight: 55 }, { move: 'toes-to-bar', amount: 8 }],
  },
  {
    id: 'lunge-and-hang', name: 'Lunge & Hang', format: 'rft', rounds: 4, minutes: 16,
    parts: [{ move: 'barbell-lunge', amount: 10, weight: 75 }, { move: 'knees-to-chest', amount: 10 }, { move: 'single-under', amount: 50 }],
  },
  {
    id: 'garage-chipper', name: 'Garage Chipper', format: 'chipper', minutes: 25,
    parts: [
      { move: 'single-under', amount: 100 }, { move: 'air-squat', amount: 50 }, { move: 'ring-row', amount: 40 },
      { move: 'deadlift', amount: 30, weight: 95 }, { move: 'banded-pull-up', amount: 20 }, { move: 'thruster', amount: 10, weight: 65 },
    ],
  },

  // --- Living room: the bike, dumbbell pairs to 30 lb, a mat ---
  {
    id: 'dumbbell-dt', name: 'Dumbbell DT', format: 'rft', rounds: 5, minutes: 15,
    parts: [{ move: 'db-deadlift', amount: 12, weight: 30 }, { move: 'db-hang-clean', amount: 9, weight: 25 }, { move: 'db-push-press', amount: 6, weight: 25 }],
  },
  {
    id: 'sprint-and-squat', name: 'Sprint & Squat', format: 'intervals', minutes: 15,
    text: '5 rounds: 1 min hard on the bike, then:',
    parts: [{ move: 'goblet-squat', amount: 12, weight: 25 }, { move: 'push-up', amount: 10 }],
  },
  {
    id: 'living-room-murph', name: 'Living-room Murph-lite', format: 'chipper', minutes: 25,
    parts: [
      { move: 'bike-cal', amount: 20 }, { move: 'db-row', amount: 40, weight: 20 }, { move: 'push-up', amount: 40 },
      { move: 'air-squat', amount: 80 }, { move: 'bike-cal', amount: 20 },
    ],
  },
  {
    id: 'devil-ladder', name: 'Devil Ladder', format: 'ladder', scheme: [10, 8, 6, 4, 2], minutes: 12,
    parts: [{ move: 'devil-press', weight: 20 }, { move: 'bike-cal' }],
  },
  {
    id: 'lunge-and-spin', name: 'Lunge & Spin', format: 'amrap', minutes: 14,
    parts: [{ move: 'db-reverse-lunge', amount: 12, weight: 20 }, { move: 'bike-cal', amount: 12 }, { move: 'hollow-rock', amount: 12 }],
  },
  {
    id: 'clean-and-jerk-emom', name: 'Clean & Jerk EMOM', format: 'emom', minutes: 12,
    parts: [{ move: 'db-clean-jerk', amount: 6, weight: 25 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'hinge-and-row', name: 'Hinge & Row', format: 'rft', rounds: 4, minutes: 16,
    parts: [{ move: 'db-rdl', amount: 12, weight: 30 }, { move: 'db-row', amount: 12, weight: 25 }, { move: 'bike-cal', amount: 12 }],
  },
  {
    id: 'overhead-burn', name: 'Overhead Burn', format: 'amrap', minutes: 10,
    parts: [{ move: 'db-overhead-squat', amount: 10, weight: 20 }, { move: 'bike-cal', amount: 10 }, { move: 'hollow-rock', amount: 10 }],
  },
  {
    id: 'thirty-thirty', name: 'Thirty-Thirty', format: 'intervals', minutes: 20,
    text: '10 rounds: 30 s all out on the bike, 30 s easy. Then 3 rounds of:',
    parts: [{ move: 'db-floor-press', amount: 15, weight: 25 }, { move: 'glute-bridge', amount: 20 }, { move: 'plank', amount: 45 }],
  },
  {
    id: 'snatch-ladder', name: 'Snatch Ladder', format: 'ladder', scheme: [20, 16, 12, 8, 4], minutes: 14,
    parts: [{ move: 'db-snatch', weight: 25 }, { move: 'bike-cal' }],
  },
  {
    id: 'man-maker-ride', name: 'Man Maker Ride', format: 'rft', rounds: 5, minutes: 18,
    parts: [{ move: 'man-maker', amount: 5, weight: 20 }, { move: 'bike-cal', amount: 15 }, { move: 'sit-up', amount: 15 }],
  },
  {
    id: 'push-pull-legs', name: 'Push, Pull, Legs', format: 'emom', minutes: 18,
    parts: [{ move: 'db-strict-press', amount: 10, weight: 20 }, { move: 'db-row', amount: 12, weight: 25 }, { move: 'goblet-squat', amount: 15, weight: 30 }],
  },
  {
    id: 'high-pull-ride', name: 'High Pull Ride', format: 'amrap', minutes: 20,
    parts: [{ move: 'db-high-pull', amount: 15, weight: 20 }, { move: 'db-thruster', amount: 12, weight: 20 }, { move: 'bike-cal', amount: 15 }],
  },
  // --- More for a split setup: an office (bike, dumbbell pairs to 30 lb, a mat, a rope) and a garage
  // (barbell, rack, pull-up bar, rings, bands, a rope). Each keeps to one room's gear. ---

  // Short upper-body and engine pieces (up to 15 min: no legs, so they fit an upper/bike slot)
  {
    id: 'office-hours', name: 'Office Hours', format: 'emom', minutes: 12,
    parts: [{ move: 'bike-cal', amount: 12 }, { move: 'db-strict-press', amount: 10, weight: 20 }, { move: 'v-up', amount: 12 }],
  },
  {
    id: 'rope-and-press', name: 'Rope & Press', format: 'amrap', minutes: 12,
    parts: [{ move: 'single-under', amount: 60 }, { move: 'db-push-press', amount: 10, weight: 25 }, { move: 'sit-up', amount: 10 }],
  },
  {
    id: 'floor-and-flight', name: 'Floor & Flight', format: 'rft', rounds: 4, minutes: 12,
    parts: [{ move: 'db-floor-press', amount: 12, weight: 30 }, { move: 'bike-cal', amount: 14 }, { move: 'mountain-climber', amount: 20 }],
  },
  {
    id: 'bent-and-bike', name: 'Bent & Bike', format: 'ladder', scheme: [12, 9, 6, 3], minutes: 10,
    parts: [{ move: 'db-row', weight: 30 }, { move: 'bike-cal' }, { move: 'hand-release-push-up' }],
  },
  {
    id: 'interval-stack', name: 'Interval Stack', format: 'intervals', minutes: 12,
    text: '4 rounds, 40 s on and 20 s off for each, as many reps as you can:',
    parts: [{ move: 'bike-cal' }, { move: 'push-up' }, { move: 'hollow-rock' }],
  },
  {
    id: 'renegade-rope', name: 'Renegade Rope', format: 'emom', minutes: 10,
    parts: [{ move: 'renegade-row', amount: 8, weight: 20 }, { move: 'single-under', amount: 40 }],
  },
  {
    id: 'rings-and-rope', name: 'Rings & Rope', format: 'amrap', minutes: 12,
    parts: [{ move: 'ring-row', amount: 8 }, { move: 'ring-dip', amount: 5 }, { move: 'single-under', amount: 50 }],
  },
  {
    id: 'climbing-ladder', name: 'Climbing Ladder', format: 'ladder', scheme: [2, 4, 6, 8, 10], minutes: 12,
    parts: [{ move: 'banded-pull-up' }, { move: 'hand-release-push-up' }, { move: 'knees-to-chest' }],
  },
  {
    id: 'press-and-skip', name: 'Press & Skip', format: 'emom', minutes: 12,
    parts: [{ move: 'push-press', amount: 6, weight: 55 }, { move: 'single-under', amount: 50 }, { move: 'hollow-rock', amount: 12 }],
  },
  {
    id: 'rows-rope-rocks', name: 'Rows, Rope, Rocks', format: 'rft', rounds: 5, minutes: 14,
    parts: [{ move: 'barbell-row', amount: 10, weight: 65 }, { move: 'single-under', amount: 40 }, { move: 'hollow-rock', amount: 12 }],
  },
  {
    id: 'dip-ladder', name: 'Dip Ladder', format: 'ladder', scheme: [10, 8, 6, 4, 2], minutes: 10,
    parts: [{ move: 'ring-dip' }, { move: 'ring-row' }, { move: 'pike-push-up' }],
  },
  {
    id: 'strict-and-pull', name: 'Strict & Pull', format: 'emom', minutes: 14,
    parts: [{ move: 'strict-press', amount: 5, weight: 55 }, { move: 'banded-pull-up', amount: 6 }],
  },

  // Legs and whole-body pieces (8-25 min, no bike or rope: they fit a legs/full slot)
  {
    id: 'front-rack-flight', name: 'Front-Rack Flight', format: 'rft', rounds: 5, minutes: 18,
    parts: [{ move: 'front-squat', amount: 8, weight: 75 }, { move: 'banded-pull-up', amount: 8 }, { move: 'push-up', amount: 10 }],
  },
  {
    id: 'deadlift-dash', name: 'Deadlift Dash', format: 'amrap', minutes: 15,
    parts: [{ move: 'deadlift', amount: 10, weight: 115 }, { move: 'run', amount: 200 }, { move: 'hand-release-push-up', amount: 10 }],
  },
  {
    id: 'snatch-practice', name: 'Snatch Practice', format: 'emom', minutes: 12,
    text: 'Light and crisp: the bar path matters more than the time.',
    parts: [{ move: 'hang-power-snatch', amount: 3, weight: 45 }, { move: 'overhead-squat', amount: 5, weight: 35 }],
  },
  {
    id: 'clean-practice', name: 'Clean Practice', format: 'emom', minutes: 12,
    text: 'Light and crisp: fast elbows, then stand it up.',
    parts: [{ move: 'hang-power-clean', amount: 3, weight: 55 }, { move: 'front-squat', amount: 5, weight: 55 }],
  },
  {
    id: 'lunge-lines', name: 'Lunge Lines', format: 'rft', rounds: 4, minutes: 20,
    parts: [{ move: 'barbell-lunge', amount: 12, weight: 45 }, { move: 'barbell-row', amount: 10, weight: 65 }, { move: 'run', amount: 200 }],
  },
  {
    id: 'squat-stack', name: 'Squat Stack', format: 'ladder', scheme: [15, 12, 9, 6], minutes: 15,
    parts: [{ move: 'back-squat', weight: 85 }, { move: 'ring-row' }],
  },
  {
    id: 'bar-and-burpee', name: 'Bar & Burpee', format: 'amrap', minutes: 16,
    parts: [{ move: 'power-clean', amount: 6, weight: 65 }, { move: 'burpee', amount: 8 }, { move: 'knees-to-chest', amount: 10 }],
  },
  {
    id: 'garage-triplet', name: 'Garage Triplet', format: 'rft', rounds: 5, minutes: 20,
    parts: [{ move: 'thruster', amount: 10, weight: 45 }, { move: 'ring-row', amount: 10 }, { move: 'air-squat', amount: 15 }],
  },
  {
    id: 'hinge-and-hang', name: 'Hinge & Hang', format: 'amrap', minutes: 20,
    parts: [{ move: 'deadlift', amount: 8, weight: 105 }, { move: 'toes-to-bar', amount: 8 }, { move: 'run', amount: 200 }],
  },
  {
    id: 'long-legs', name: 'Long Legs', format: 'chipper', minutes: 25,
    parts: [{ move: 'air-squat', amount: 50 }, { move: 'reverse-lunge', amount: 40 }, { move: 'deadlift', amount: 30, weight: 95 }, { move: 'front-squat', amount: 20, weight: 65 }, { move: 'burpee', amount: 10 }],
  },
  {
    id: 'goblet-ladder', name: 'Goblet Ladder', format: 'ladder', scheme: [6, 9, 12, 15], minutes: 14,
    parts: [{ move: 'goblet-squat', weight: 30 }, { move: 'db-rdl', weight: 30 }, { move: 'push-up' }],
  },
  {
    id: 'walk-the-line', name: 'Walk the Line', format: 'rft', rounds: 4, minutes: 18,
    parts: [{ move: 'db-walking-lunge', amount: 20, weight: 20 }, { move: 'db-hang-clean', amount: 10, weight: 25 }, { move: 'db-push-press', amount: 10, weight: 25 }],
  },
  {
    id: 'devils-and-dash', name: 'Devils & Dash', format: 'amrap', minutes: 15,
    parts: [{ move: 'devil-press', amount: 6, weight: 20 }, { move: 'run', amount: 200 }, { move: 'goblet-squat', amount: 12, weight: 30 }],
  },
  {
    id: 'office-chipper', name: 'Office Chipper', format: 'chipper', minutes: 22,
    parts: [
      { move: 'goblet-squat', amount: 40, weight: 25 }, { move: 'db-row', amount: 30, weight: 30 }, { move: 'reverse-lunge', amount: 40 },
      { move: 'db-push-press', amount: 30, weight: 20 }, { move: 'sit-up', amount: 40 }, { move: 'db-swing', amount: 30, weight: 30 },
    ],
  },
  {
    id: 'swing-and-squat', name: 'Swing & Squat', format: 'emom', minutes: 16,
    parts: [{ move: 'db-swing', amount: 15, weight: 30 }, { move: 'goblet-squat', amount: 12, weight: 30 }, { move: 'push-up', amount: 10 }, { move: 'plank', amount: 30 }],
  },
  {
    id: 'snatch-and-lunge', name: 'Snatch & Lunge', format: 'amrap', minutes: 18,
    parts: [{ move: 'db-snatch', amount: 10, weight: 25 }, { move: 'db-reverse-lunge', amount: 12, weight: 20 }, { move: 'burpee', amount: 8 }],
  },
  {
    id: 'hinge-builder', name: 'Hinge Builder', format: 'rft', rounds: 5, minutes: 16,
    parts: [{ move: 'db-rdl', amount: 12, weight: 30 }, { move: 'db-row', amount: 10, weight: 30 }, { move: 'glute-bridge', amount: 15 }],
  },
  {
    id: 'thrusters-and-miles', name: 'Thrusters & Miles', format: 'rft', rounds: 4, minutes: 20,
    parts: [{ move: 'run', amount: 400 }, { move: 'db-thruster', amount: 15, weight: 20 }, { move: 'v-up', amount: 10 }],
  },
  {
    id: 'bodyweight-legs', name: 'Bodyweight Legs', format: 'amrap', minutes: 15,
    parts: [{ move: 'air-squat', amount: 20 }, { move: 'reverse-lunge', amount: 12 }, { move: 'glute-bridge', amount: 15 }, { move: 'burpee', amount: 10 }],
  },
  {
    id: 'down-and-up', name: 'Down & Up', format: 'ladder', scheme: [10, 8, 6, 4, 2], minutes: 10,
    parts: [{ move: 'burpee' }, { move: 'air-squat' }],
  },

  // Longer mixed pieces, with the bike or the rope
  {
    id: 'office-long-ride', name: 'Office Long Ride', format: 'amrap', minutes: 25,
    parts: [{ move: 'bike-cal', amount: 20 }, { move: 'goblet-squat', amount: 15, weight: 25 }, { move: 'db-push-press', amount: 12, weight: 20 }, { move: 'sit-up', amount: 15 }],
  },
  {
    id: 'spin-and-squat', name: 'Spin & Squat', format: 'emom', minutes: 20,
    parts: [{ move: 'bike-cal', amount: 14 }, { move: 'goblet-squat', amount: 15, weight: 25 }, { move: 'db-row', amount: 12, weight: 25 }, { move: 'plank', amount: 40 }],
  },
  {
    id: 'rope-chipper', name: 'Rope Chipper', format: 'chipper', minutes: 22,
    parts: [
      { move: 'single-under', amount: 150 }, { move: 'deadlift', amount: 30, weight: 95 }, { move: 'ring-row', amount: 30 },
      { move: 'front-squat', amount: 30, weight: 65 }, { move: 'single-under', amount: 150 },
    ],
  },
  {
    id: 'snatch-and-skip', name: 'Snatch & Skip', format: 'amrap', minutes: 14,
    parts: [{ move: 'hang-power-snatch', amount: 5, weight: 45 }, { move: 'single-under', amount: 40 }, { move: 'air-squat', amount: 10 }],
  },
  {
    id: 'bike-and-bells-ladder', name: 'Bike & Bells Ladder', format: 'ladder', scheme: [20, 16, 12, 8, 4], minutes: 16,
    parts: [{ move: 'bike-cal' }, { move: 'db-deadlift', weight: 30 }, { move: 'sit-up' }],
  },
]
