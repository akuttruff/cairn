import fs from 'node:fs'
import path from 'node:path'
import { Store } from '../server/store.ts'
import { fingerprint } from '../server/notes.ts'
import { addDays, localDate } from '../src/lib/nutrition.ts'
import type { Meal, Nutrients } from '../src/types.ts'

/**
 * Fills the development database (.data-dev, the one `npm run dev` uses)
 * with a week of demo data so the app can be screenshotted with something
 * on screen: meals with their macros, water, workouts, a few body readings
 * and some saved foods. Run with `npm run seed:demo`; it starts from an
 * empty database every time. Nothing here is anyone's real log.
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

// Training days and rest days, with the workouts that make them so.
const WORKOUTS = [['weightlifting', 50], ['yoga', 45], ['wod', 40], ['run', 35], ['weightlifting', 55], ['yoga', 60], ['pilates', 45]] as const
for (let back = 0; back < 14; back++) {
  const [kind, minutes] = WORKOUTS[back % WORKOUTS.length]!
  store.addWorkout({ date: day(back), kind, minutes })
  if (kind === 'weightlifting' || kind === 'wod') store.setDayType(day(back), 'training')
  if (back % 7 !== 2 && back % 7 !== 5) store.addMeditation({ date: day(back), minutes: back === 0 ? 10 : 15 })
}
for (const [back, miles] of [[0, 1.4], [1, 2.1], [2, 1.2], [3, 1.8], [5, 2.4], [6, 1.5], [7, 1.6], [8, 2.0], [10, 1.3], [11, 1.9], [13, 2.2]] as const) store.addDogWalk({ date: day(back), miles })
store.addAlcohol(day(2), 'wine')
store.addAlcohol(day(5), 'beer')

// The scale, as Apple Health would send it: a reading most mornings.
store.addBodySamples([
  { type: 'Weight', value: 151.2, unit: 'lb', date: `${day(6)}T07:02:00` },
  { type: 'Weight', value: 150.8, unit: 'lb', date: `${day(4)}T07:10:00` },
  { type: 'Weight', value: 150.4, unit: 'lb', date: `${day(2)}T06:58:00` },
  { type: 'Weight', value: 150.0, unit: 'lb', date: `${day(0)}T07:05:00` },
  { type: 'Body Fat Percentage', value: 0.252, date: `${day(2)}T06:58:00` },
  { type: 'Body Fat Percentage', value: 0.25, date: `${day(0)}T07:05:00` },
  { type: 'Lean Body Mass', value: 51, unit: 'kg', date: `${day(0)}T07:05:00` },
])

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
note(`${today.slice(0, 7)}-01`, addDays(`${today.slice(0, 7)}-01`, 30), 'Fourteen days logged this month. The pattern is clear and worth keeping: protein on target, fiber comfortably over, calories under on rest days. The lifting days are the only ones that press the calorie ceiling, and they should.\n\nWeight is drifting down slowly, about a pound over the two weeks, with body fat a shade lower. Nothing to change.')
console.log(`seeded ${dir} for ${day(6)} to ${today}`)
