import fs from 'node:fs'
import path from 'node:path'
import { Store } from '../server/store.ts'
import { fingerprint } from '../server/notes.ts'
import { checkEdits, previewEdits } from '../server/training-chat.ts'
import { addDays, localDate } from '../src/lib/nutrition.ts'
import { weekdayOf } from '../src/lib/training/resolve.ts'
import { DEFAULT_WORKOUT_KINDS } from '../src/types.ts'
import type { CoachStats, Meal, Nutrients, PlanEdit, TrainingSchema } from '../src/types.ts'

/**
 * Fills the development database (.data-dev, the one `npm run dev` uses)
 * with a week of demo data so the app can be screenshotted with something
 * on screen: meals with their macros, water, workouts and some saved foods, and a training plan with its logged sets and a
 * conversation with the coach. Run with `npm run seed:demo`; it starts from an empty database every time. Nothing here is
 * anyone's real log, plan or PRs.
 */

const dir = path.resolve(process.cwd(), '.data-dev')
fs.rmSync(dir, { recursive: true, force: true })
const store = new Store({ dir })

const today = localDate()
const day = (back: number): string => addDays(today, -back)
const n = (calories: number, protein: number, fat: number, carbs: number, fiber: number): Nutrients => ({ calories, protein, fat, carbs, fiber })

// Per 100 g, roughly as the USDA has them.
const FOODS: Record<string, { per100g: Nutrients; brand?: string }> = {
  'Greek yogurt, plain': { per100g: n(59, 10, 0.4, 3.6, 0) },
  'Blueberries': { per100g: n(57, 0.7, 0.3, 14.5, 2.4) },
  'Granola': { per100g: n(471, 10, 20, 64, 7), brand: 'Simply Nature' },
  'Rolled oats': { per100g: n(379, 13, 7, 67, 10) },
  'Banana': { per100g: n(89, 1.1, 0.3, 23, 2.6) },
  'Eggs, scrambled': { per100g: n(149, 10, 11, 1.6, 0) },
  'Sourdough toast': { per100g: n(270, 9, 1.5, 53, 2.5) },
  'Chicken breast, grilled': { per100g: n(165, 31, 3.6, 0, 0) },
  'Brown rice, cooked': { per100g: n(123, 2.7, 1, 26, 1.6) },
  'Black beans': { per100g: n(132, 8.9, 0.5, 24, 8.7) },
  'Salmon, baked': { per100g: n(206, 22, 12, 0, 0) },
  'Broccoli, steamed': { per100g: n(35, 2.4, 0.4, 7.2, 3.3) },
  'Sweet potato, roasted': { per100g: n(90, 2, 0.1, 21, 3.3) },
  'Lentil soup': { per100g: n(56, 3.5, 1, 8.5, 2.5) },
  'Apple': { per100g: n(52, 0.3, 0.2, 14, 2.4) },
  'Almonds': { per100g: n(579, 21, 50, 22, 12.5) },
  'Cottage cheese': { per100g: n(98, 11, 4.3, 3.4, 0) },
  'Tofu stir-fry': { per100g: n(110, 9, 6, 6, 2) },
  'Turkey sandwich': { per100g: n(210, 14, 6, 25, 2) },
  'Dark chocolate': { per100g: n(598, 7.8, 43, 46, 11) },
}

const log = (date: string, meal: Meal, name: string, grams: number): void => {
  const f = FOODS[name]!
  store.addEntry({ date, meal, name, brand: f.brand, grams, per100g: f.per100g, source: 'custom' })
}

// A week of meals, today first. Today is a training day with a full log; the others vary.
const MENUS: [string, Meal, number][][] = [
  [['Greek yogurt, plain', 'breakfast', 170], ['Blueberries', 'breakfast', 100], ['Granola', 'breakfast', 40], ['Chicken breast, grilled', 'lunch', 150], ['Brown rice, cooked', 'lunch', 180], ['Black beans', 'lunch', 90], ['Salmon, baked', 'dinner', 150], ['Sweet potato, roasted', 'dinner', 200], ['Broccoli, steamed', 'dinner', 120], ['Apple', 'snack', 180], ['Almonds', 'snack', 28]],
  [['Rolled oats', 'breakfast', 60], ['Banana', 'breakfast', 118], ['Turkey sandwich', 'lunch', 230], ['Tofu stir-fry', 'dinner', 350], ['Dark chocolate', 'snack', 20]],
  [['Eggs, scrambled', 'breakfast', 150], ['Sourdough toast', 'breakfast', 60], ['Lentil soup', 'lunch', 400], ['Chicken breast, grilled', 'dinner', 160], ['Broccoli, steamed', 'dinner', 150], ['Cottage cheese', 'snack', 150]],
  [['Greek yogurt, plain', 'breakfast', 200], ['Granola', 'breakfast', 45], ['Turkey sandwich', 'lunch', 230], ['Apple', 'lunch', 180], ['Salmon, baked', 'dinner', 140], ['Brown rice, cooked', 'dinner', 160], ['Almonds', 'snack', 30]],
  [['Rolled oats', 'breakfast', 60], ['Blueberries', 'breakfast', 80], ['Tofu stir-fry', 'lunch', 300], ['Chicken breast, grilled', 'dinner', 150], ['Sweet potato, roasted', 'dinner', 180], ['Dark chocolate', 'snack', 25]],
  [['Eggs, scrambled', 'breakfast', 120], ['Banana', 'breakfast', 118], ['Lentil soup', 'lunch', 350], ['Sourdough toast', 'lunch', 50], ['Salmon, baked', 'dinner', 150], ['Broccoli, steamed', 'dinner', 120], ['Cottage cheese', 'snack', 120]],
  [['Greek yogurt, plain', 'breakfast', 170], ['Granola', 'breakfast', 40], ['Chicken breast, grilled', 'lunch', 140], ['Black beans', 'lunch', 100], ['Tofu stir-fry', 'dinner', 320], ['Apple', 'snack', 160]],
]
// Two weeks of it, so the week before this one is complete too.
// Today's menu is written out in full; the other menus are lighter sketches, so their portions are scaled up.
for (let back = 0; back < 14; back++) for (const [name, meal, grams] of MENUS[back % MENUS.length]!) log(day(back), meal, name, back % 7 === 0 ? grams : Math.round(grams * 1.5))

// Water, in 16 oz glasses and 32 oz bottles.
const WATER = [[32, 32, 16], [32, 32, 32], [32, 32, 16], [32, 32, 32], [32, 32, 32], [32, 32], [32, 32, 32]]
for (let back = 0; back < 14; back++) for (const ounces of WATER[back % WATER.length]!) store.addWater(day(back), ounces)

// A training plan, made up for the demo: eight weeks, now in its third, with the sets done so far logged
// (logging a session's sets is what fills its workout dot and marks the training day).
const monday = addDays(today, 1 - weekdayOf(today))
const start = addDays(monday, -14)
const minutes = (list: number[]): Record<string, number> => Object.fromEntries(list.map((m, i) => [String(i + 1), m]))
const PLAN: TrainingSchema = {
  schemaVersion: 1, name: 'Spring strength block', startDate: start, firstWeek: 1, weeks: 8, deloadWeeks: [4], testWeek: 8,
  goals: 'Eight weeks toward new squat, press and deadlift PRs, a first strict pull-up, and an easy 5K.',
  lifts: [{ id: 'squat', name: 'Back squat', increment: 5 }, { id: 'press', name: 'Strict press', increment: 2.5 }, { id: 'deadlift', name: 'Deadlift', increment: 5 }, { id: 'clean', name: 'Power clean', increment: 2.5 }],
  days: [
    { weekday: 1, sessions: [
      { id: 'legs', title: 'Legs: squat + lunges', kind: 'weightlifting', items: [
        { id: 'back-squat', name: 'Back squat', lift: 'squat', notes: 'Rest 2-3 min between sets. Pins just below the bottom.',
          progression: { phases: [{ weeks: [1, 3], sets: 5, reps: 5, startPct: 0.7, stepPct: 0.025 }, { weeks: [5, 7], sets: 5, reps: 3, startPct: 0.8, stepPct: 0.025 }], deload: { sets: 3, reps: 5, pct: 0.6 }, test: 'ladder' } },
        { id: 'reverse-lunge', name: 'Reverse lunge', sets: { sets: [{ reps: 10, weight: 25 }, { reps: 10, weight: 25 }, { reps: 10, weight: 25 }], note: 'Per leg, a dumbbell in each hand' } },
      ] },
      { id: 'yoga-mon', title: 'Yoga', kind: 'yoga', optional: true, items: [{ id: 'yoga-hips', name: 'Yoga: hips & hamstrings', check: true }] },
    ] },
    { weekday: 2, sessions: [
      { id: 'pullups', title: 'Pull-ups', kind: 'wod', items: [
        { id: 'banded-pullups', name: 'Banded pull-ups', sets: { sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] } },
        { id: 'negatives', name: 'Negative pull-ups', sets: { sets: [{ reps: 3 }, { reps: 3 }, { reps: 3 }], note: 'Lower in 5 s' } },
        { id: 'dead-hang', name: 'Dead hang', sets: { sets: [{ seconds: 40 }, { seconds: 40 }] } },
      ] },
      { id: 'ride-tue', title: 'Zone 2 ride', kind: 'cycling', items: [{ id: 'zone2-tue', name: 'Zone 2 ride', minutes: minutes([40, 45, 50, 35, 50, 55, 60, 40]) }] },
    ] },
    { weekday: 3, sessions: [
      { id: 'press-day', title: 'Strict press', kind: 'weightlifting', items: [
        { id: 'strict-press', name: 'Strict press', lift: 'press', progression: { phases: [{ weeks: [1, 3], sets: 5, reps: 5, startPct: 0.65, stepPct: 0.035 }, { weeks: [5, 7], sets: 5, reps: 3, startPct: 0.75, stepPct: 0.035 }], deload: { sets: 3, reps: 5, pct: 0.6 }, test: 'ladder' } },
      ] },
      { id: 'wod-wed', title: 'WOD', kind: 'wod', items: [{ id: 'wod-wed-slot', name: 'Short WOD', wod: { maxMinutes: 15, focus: ['upper', 'bike'] } }] },
    ] },
    { weekday: 4, sessions: [
      { id: 'run-thu', title: 'Easy run', kind: 'run', items: [{ id: 'easy-run', name: 'Easy run', minutes: minutes([20, 22, 25, 20, 25, 28, 30, 20]) }] },
      { id: 'pilates-thu', title: 'Pilates', kind: 'pilates', optional: true, items: [{ id: 'pilates-core', name: 'Pilates core', check: true }] },
    ] },
    { weekday: 5, sessions: [
      { id: 'pull-day', title: 'Deadlift + cleans', kind: 'weightlifting', items: [
        { id: 'power-clean', name: 'Power clean', lift: 'clean', progression: { phases: [{ weeks: [1, 3], sets: 5, reps: 3, startPct: 0.7, stepPct: 0.03 }, { weeks: [5, 7], sets: 5, reps: 2, startPct: 0.8, stepPct: 0.03 }], deload: { sets: 3, reps: 3, pct: 0.6 }, test: 'single' } },
        { id: 'deadlift', name: 'Deadlift', lift: 'deadlift', progression: { phases: [{ weeks: [1, 3], sets: 4, reps: 5, startPct: 0.7, stepPct: 0.025 }, { weeks: [5, 7], sets: 4, reps: 3, startPct: 0.8, stepPct: 0.025 }], deload: { sets: 3, reps: 5, pct: 0.6 }, test: 'ladder' } },
      ] },
    ] },
    { weekday: 6, sessions: [{ id: 'wod-sat', title: 'WOD', kind: 'wod', items: [{ id: 'wod-sat-slot', name: 'Saturday WOD', wod: { maxMinutes: 25, minMinutes: 8 } }] }] },
    { weekday: 7, sessions: [{ id: 'ride-sun', title: 'Long easy ride', kind: 'cycling', optional: true, items: [{ id: 'long-ride', name: 'Long easy ride', minutes: minutes([60, 70, 75, 45, 80, 85, 90, 45]) }] }] },
  ],
}
store.setSettings({
  // Split between two rooms, so WODs show where they're done.
  equipment: { gear: [], dumbbells: [], kettlebells: [], places: [
    { name: 'Living room', gear: ['dumbbells', 'ab-mat', 'bike'], dumbbells: [15, 20, 25, 35], kettlebells: [] },
    { name: 'Garage', gear: ['barbell', 'plates', 'rack', 'pullup-bar', 'bands', 'rings', 'jump-rope'], dumbbells: [], kettlebells: [] },
  ] },
  workoutKinds: DEFAULT_WORKOUT_KINDS,
})
store.training.save(PLAN)
for (const [lift, pr] of [['squat', 155], ['press', 70], ['deadlift', 205], ['clean', 95]] as const) store.training.setPr(lift, { pr, date: addDays(start, -10) })
store.setGoals({ workoutPlan: { weightlifting: 3, wod: 3, run: 1, cycling: 2, yoga: 1, pilates: 1 } })

// Every planned set done on the days so far (a few skipped, as they are), and today's session started.
for (let d = start; d <= today; d = addDays(d, 1)) {
  const offset = Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000)
  if (offset === 4 || offset === 9) continue // a missed day or two
  for (const session of store.training.day(d).sessions) {
    if (session.optional && offset % 3 !== 0) continue
    for (const item of session.items) {
      if (item.type === 'sets') {
        for (const s of item.sets!) {
          if (d === today && s.index > 1) break
          store.training.logSet({ date: d, itemId: item.id, setIndex: s.index, reps: s.reps === 'max' ? 8 : s.reps, weight: s.weight, seconds: s.seconds })
        }
      } else if (d !== today) {
        if (item.type === 'wod' && item.wod!.picks[0]) store.training.setWod({ date: d, itemId: item.id, wodId: item.wod!.picks[0].id })
        store.training.logSet({ date: d, itemId: item.id, setIndex: 0 })
      }
    }
    if (d === today) break
  }
}
// Meditation, most days.
for (let back = 0; back < 14; back++) {
  if (back % 7 !== 2 && back % 7 !== 5) store.addMeditation({ date: day(back), minutes: back === 0 ? 10 : 15 })
}

// A conversation with the coach: a question answered, and a change proposed for this week, worked out as the app would.
const plan = store.training.activePlan()!
const stats = (seconds: number, out: number): CoachStats => ({ model: 'qwen/qwen3.8-27b', seconds, inputTokens: 6240, outputTokens: out, reasoningTokens: 0, tokensPerSecond: 24.6, firstTokenSeconds: 2.1 })
store.training.addMessage(plan.id, 'user', 'How is my training going?')
store.training.addMessage(plan.id, 'assistant', 'Really well. You have hit every planned squat and press set for two weeks, and your Saturday WODs have been consistent. Next week is the deload, so expect the weights to drop on purpose; that is what sets up the heavier triples after it.', null, null, stats(9.4, 74))
const friday = addDays(monday, 4)
const saturday = addDays(monday, 5)
store.training.addMessage(plan.id, 'user', "I'm away Saturday. Can I do the WOD on Friday instead, and go a bit lighter on deadlifts that day?")
const edits: PlanEdit[] = [{ op: 'move', sessionId: 'wod-sat', from: saturday, to: friday }, { op: 'load', from: friday, to: friday, factor: 0.9, lifts: ['deadlift'] }]
const checked = checkEdits(store.training, plan, edits, today, store.getSettings())
if (checked.errors.length) throw new Error(checked.errors.join('; '))
store.training.addMessage(plan.id, 'assistant', 'Here is a Friday that fits both: the WOD moves to after your pulls, and deadlifts drop 10% so the WOD stays honest.', { edits, preview: previewEdits(store.training, plan, checked, today) }, null, stats(14.8, 118))
for (const [back, miles] of [[0, 1.4], [1, 2.1], [2, 1.2], [3, 1.8], [5, 2.4], [6, 1.5], [7, 1.6], [8, 2.0], [10, 1.3], [11, 1.9], [13, 2.2]] as const) store.addDogWalk({ date: day(back), miles })
store.addAlcohol(day(2), 'wine')
store.addAlcohol(day(5), 'beer')

// A few foods saved for one-tap logging.
for (const name of ['Rolled oats', 'Greek yogurt, plain', 'Chicken breast, grilled', 'Almonds']) {
  const f = FOODS[name]!
  try { store.saveFood({ id: `demo-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, name, brand: f.brand, source: 'custom', per100g: f.per100g }) } catch (e) { console.warn(`food not saved: ${(e as Error).message}`) }
}

store.setSettings({ lmStudioUrl: 'http://127.0.0.1:1234', researchModel: 'qwen/qwen3.8-27b' })

// Notes a small model would write on the week before this one, this week so far, and the month; saved against the
// data as it stands, so the app shows them instead of asking a model that is not running.
const note = (start: string, end: string, text: string): void => store.saveNotes(start, end, fingerprint(store.getRange(start, end)), text, 'qwen/qwen3.5-9b')
const sunday = addDays(today, -new Date(`${today}T12:00:00`).getDay())
note(addDays(sunday, -7), addDays(sunday, -1), 'A steady week: protein landed within a few grams of the goal every day, and fiber cleared it on all seven. Calories ran under the ceiling on the rest days and right at it on the two lifting days, which is the shape you want.\n\nWater was the weak spot, with three days under 80 oz. The dog walks and the two yoga sessions kept the rest days from being sedentary.')
note(sunday, addDays(sunday, 6), 'One day in, and it is a good one: a training day with the carbs spent before the lift, protein three grams short, fiber met. Keep the second bottle of water earlier in the afternoon.')
note(`${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, 30), 'Fourteen days logged this month. The pattern is clear and worth keeping: protein on target, fiber comfortably over, calories under on rest days. The lifting days are the only ones that press the calorie ceiling, and they should.')
console.log(`seeded ${dir} for ${day(6)} to ${today}`)
