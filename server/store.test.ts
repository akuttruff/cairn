import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store, ValidationError } from './store.ts'
import { DEFAULT_GOALS, addDays, startOfWeek } from '../src/lib/nutrition.ts'
import type { NewEntry, Nutrients } from '../src/types.ts'

let dir: string
let store: Store

/** A second, read-only-in-spirit connection, for asserting on rows directly. */
const openRaw = (): DatabaseSync => new DatabaseSync(path.join(dir, 'macros.sqlite'))
const allRows = (table: string): unknown[] => {
  const db = openRaw()
  try {
    return db.prepare(`SELECT * FROM ${table}`).all()
  } finally {
    db.close()
  }
}

const BANANA_100G: Nutrients = { calories: 89, protein: 1.09, fat: 0.33, carbs: 22.8, fiber: 2.6 }
const DAY = '2026-09-26'

const banana = (over: Partial<NewEntry> = {}): NewEntry => ({
  date: DAY, meal: 'breakfast', name: 'Bananas, raw', grams: 118,
  per100g: BANANA_100G, source: 'usda', foodId: 'usda:173944', ...over,
})

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-store-'))
  store = new Store({ dir })
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('logging', () => {
  it('scales a database food to the weight eaten', () => {
    const e = store.addEntry(banana())
    expect(e.nutrients.calories).toBe(105)
    expect(e.nutrients.fiber).toBe(3.1)
  })

  it('accepts a manual portion with no weight', () => {
    const e = store.addEntry({
      date: DAY, meal: 'lunch', name: 'Burrito', grams: null, source: 'custom',
      nutrients: { calories: 650, protein: 30, fat: 22, carbs: 80, fiber: null },
    })
    expect(e.grams).toBeNull()
    expect(e.nutrients.fiber).toBeNull()
  })

  it('totals the day and reports what is unknown', () => {
    store.addEntry(banana())
    store.addEntry({
      date: DAY, meal: 'snack', name: 'Greek yogurt', grams: 150, source: 'off',
      per100g: { calories: 52.9, protein: 9.41, fat: 0, carbs: 3.53, fiber: null },
    })
    const day = store.getDay(DAY)
    expect(day.totals.calories).toBe(184.4)
    expect(day.missing.fiber).toBe(1)
    expect(day.entries.map((e) => e.meal)).toEqual(['breakfast', 'snack'])
  })

  it('keeps days separate', () => {
    store.addEntry(banana())
    expect(store.getDay('2026-09-27').entries).toEqual([])
  })

  it('persists across restarts', () => {
    store.addEntry(banana())
    expect(new Store({ dir }).getDay(DAY).entries).toHaveLength(1)
  })
})

describe('validation', () => {
  const bad: [string, Partial<NewEntry>][] = [
    ['an impossible date', { date: '2026-02-30' }],
    ['a path in the date', { date: '../../etc/passwd' }],
    ['an unknown meal', { meal: 'brunch' as NewEntry['meal'] }],
    ['a blank name', { name: '   ' }],
    ['negative grams', { grams: -5 }],
    ['per100g without grams', { grams: null }],
    ['a negative nutrient', { per100g: { ...BANANA_100G, protein: -1 } }],
    ['a nonsense nutrient', { per100g: { ...BANANA_100G, fat: 'lots' as unknown as number } }],
  ]
  it.each(bad)('refuses %s', (_label, over) => {
    expect(() => store.addEntry(banana(over))).toThrow(ValidationError)
  })

  it('caps a very long name rather than storing it whole', () => {
    expect(store.addEntry(banana({ name: 'x'.repeat(5000) })).name).toHaveLength(200)
  })
})

describe('editing', () => {
  it('rescales when the weight changes', () => {
    const e = store.addEntry(banana())
    const updated = store.updateEntry(e.id, { grams: 236 })
    expect(updated.nutrients.calories).toBe(210)
    expect(store.getDay(DAY).totals.calories).toBe(210)
  })

  it('moves an entry to another meal', () => {
    const e = store.addEntry(banana())
    expect(store.updateEntry(e.id, { meal: 'snack' }).meal).toBe('snack')
  })

  it('edits a manual portion directly', () => {
    const e = store.addEntry({
      date: DAY, meal: 'lunch', name: 'Burrito', grams: null, source: 'custom',
      nutrients: { calories: 650, protein: 30, fat: 22, carbs: 80, fiber: null },
    })
    const updated = store.updateEntry(e.id, {
      nutrients: { calories: 600, protein: 30, fat: 20, carbs: 75, fiber: 9 },
    })
    expect(updated.nutrients.fiber).toBe(9)
  })

  describe('correcting the numbers of a database food', () => {
    const noFiber = { ...BANANA_100G, fiber: null }

    it('lets you add a nutrient the source left out, changing only that one', () => {
      const e = store.addEntry(banana({ per100g: noFiber }))
      const before = e.nutrients
      const fixed = store.updateEntry(e.id, { nutrients: { ...before, fiber: 3 } })
      expect(fixed.nutrients).toEqual({ ...before, fiber: 3 })
      expect(fixed.per100g!.calories).toBe(89) // untouched: unchanged values aren't re-derived
    })

    it('keeps the fix when the weight is edited afterwards', () => {
      const e = store.addEntry(banana({ per100g: noFiber })) // 118 g
      store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: 3.1 } })
      const doubled = store.updateEntry(e.id, { grams: 236 })
      expect(doubled.nutrients.fiber).toBe(6.2)
    })

    it('corrects the saved food it was logged from, so the next log has it too', () => {
      store.saveFood({ id: 'usda:173944', name: 'Bananas, raw', source: 'usda', per100g: noFiber })
      const e = store.addEntry(banana({ per100g: noFiber }))
      store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: 3.1 } })
      const saved = store.listFoods().find((f) => f.id === 'usda:173944')!
      expect(saved.per100g!.fiber).toBeCloseTo(2.627, 2)
      expect(saved.per100g!.calories).toBe(89)
      const next = store.addEntry(banana({ per100g: saved.per100g }))
      expect(next.nutrients.fiber).toBe(3.1)
    })

    it('fixes a per-serving food from an online lookup, by serving', () => {
      const BOWL = { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null }
      store.saveFood({ id: 'web:bowl', name: 'Bowl', source: 'web', perServing: { label: '1 bowl', grams: null, nutrients: BOWL } })
      const e = store.addEntry({
        date: DAY, meal: 'lunch', name: 'Bowl', grams: null, foodId: 'web:bowl', source: 'web',
        perUnit: BOWL, amount: { quantity: 2, unit: '1 bowl', unitGrams: null },
      })
      const fixed = store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: 18 } }) // 2 bowls
      expect(fixed.perUnit!.fiber).toBe(9)
      expect(store.listFoods()[0]!.perServing!.nutrients.fiber).toBe(9)
      expect(store.updateEntry(e.id, { quantity: 1 }).nutrients.fiber).toBe(9)
    })

    it('can clear a value back to unknown, and refuses nonsense', () => {
      const e = store.addEntry(banana())
      expect(store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: null } }).nutrients.fiber).toBeNull()
      expect(() => store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: -1 } })).toThrow(ValidationError)
    })

    it('leaves a food that was never saved alone', () => {
      const e = store.addEntry(banana({ per100g: noFiber }))
      store.updateEntry(e.id, { nutrients: { ...e.nutrients, fiber: 3 } })
      expect(store.listFoods()).toEqual([])
    })
  })

  it('deletes', () => {
    const e = store.addEntry(banana())
    store.deleteEntry(e.id)
    expect(store.getDay(DAY).entries).toEqual([])
  })

  it('refuses an unknown id', () => {
    expect(() => store.deleteEntry('nope')).toThrow(ValidationError)
  })
})

describe('foods', () => {
  it('saves and lists foods alphabetically', () => {
    store.saveFood({ id: 'custom:b', name: 'Oats', source: 'custom', per100g: BANANA_100G })
    store.saveFood({ id: 'custom:a', name: 'Apple', source: 'custom', per100g: BANANA_100G })
    expect(store.listFoods().map((f) => f.name)).toEqual(['Apple', 'Oats'])
  })

  it('updates in place by id', () => {
    store.saveFood({ id: 'custom:a', name: 'Apple', source: 'custom', per100g: BANANA_100G })
    store.saveFood({ id: 'custom:a', name: 'Green apple', source: 'custom', per100g: BANANA_100G })
    expect(store.listFoods().map((f) => f.name)).toEqual(['Green apple'])
  })

  it('offers recent foods with the weight last used', () => {
    store.addEntry(banana({ grams: 136 }))
    const [recent] = store.recentFoods()
    expect(recent!.name).toBe('Bananas, raw')
    expect(recent!.servings![0]!.grams).toBe(136)
  })

  it('lists each recent food once', () => {
    store.addEntry(banana())
    store.addEntry(banana({ date: '2026-09-27' }))
    expect(store.recentFoods()).toHaveLength(1)
  })

  it('offers at most the requested number of recent foods, newest first', () => {
    for (let i = 0; i < 5; i++) store.addEntry(banana({ name: `Food ${i}`, foodId: `usda:${i}` }))
    expect(store.recentFoods(3).map((f) => f.name)).toEqual(['Food 4', 'Food 3', 'Food 2'])
  })

  it('leaves out an entry that has no basis to log it again', () => {
    store.addEntry({ date: DAY, meal: 'lunch', name: 'Burrito', grams: null, source: 'custom', nutrients: BANANA_100G })
    expect(store.recentFoods()).toEqual([])
  })

  it("reports a drink's calories beside the day without counting them in it", () => {
    store.addEntry(banana()) // 105 kcal, 26.9 g carbs
    store.addAlcohol(DAY, 'wine')
    store.addAlcohol(DAY, 'liquor')
    const day = store.getDay(DAY)
    expect(day.alcohol).toMatchObject({ drinks: 2, calories: 225 })
    expect(day.totals.calories).toBe(105) // food only
    expect(day.goals.calories).toEqual({ min: 1800, max: 1800 }) // and the goal is untouched (1700 + the 100 buffer)
  })

  it('does not snapshot a saved food into history', () => {
    // Editing a saved food must never rewrite what was already eaten.
    store.addEntry(banana())
    store.saveFood({ id: 'usda:173944', name: 'Bananas, raw', source: 'usda',
      per100g: { ...BANANA_100G, calories: 999 } })
    expect(store.getDay(DAY).totals.calories).toBe(105)
  })
})

describe('goals and settings', () => {
  it('keeps which charts to draw: a default set, any subset in a fixed order, even none', () => {
    expect(store.getPublicSettings().charts).toEqual(['calories', 'protein', 'fiber', 'water'])
    expect(store.getRange(DAY, DAY).charts).toEqual(['calories', 'protein', 'fiber', 'water'])
    store.setSettings({ charts: ['water', 'carbs', 'fat', 'carbs'] }) // any order, repeats
    expect(new Store({ dir }).getRange(DAY, DAY).charts).toEqual(['fat', 'carbs', 'water'])
    store.setSettings({ charts: [] })
    expect(new Store({ dir }).getPublicSettings().charts).toEqual([]) // none is a choice, not "unset"
    expect(() => store.setSettings({ charts: ['sodium'] as never })).toThrow(/charts must be a list of/)
  })

  it('keeps the chosen app icon, Ring by default, and refuses one that does not exist', () => {
    expect(store.getPublicSettings().appIcon).toBe('ring')
    store.setSettings({ appIcon: 'dawn' })
    expect(new Store({ dir }).getPublicSettings().appIcon).toBe('dawn')
    expect(() => store.setSettings({ appIcon: 'unicorn' as never })).toThrow(/appIcon must be one of/)
  })

  it('starts with sensible goals', () => {
    expect(store.getGoals().fiber).toBe(30)
  })

  it('updates only the goals given, leaving the rest as they were', () => {
    store.setGoals({ fiber: 40, trainingCarbs: 50 })
    const goals = store.getGoals()
    expect(goals).toMatchObject({ fiber: 40, trainingCarbs: 50, protein: DEFAULT_GOALS.protein, carbs: DEFAULT_GOALS.carbs })
    expect(new Store({ dir }).getGoals()).toEqual(goals)
  })

  it('refuses a nonsense goal', () => {
    expect(() => store.setGoals({ fiber: -1 })).toThrow(ValidationError)
    expect(() => store.setGoals({ protein: 'lots' as unknown as number })).toThrow(ValidationError)
    expect(() => store.setGoals({ trainingCarbs: Number.NaN })).toThrow(ValidationError)
  })

  it('never exposes the USDA key', () => {
    store.setSettings({ usdaApiKey: 'SECRETKEY', lmStudioToken: 'sk-lm-SECRET' })
    const pub = store.getPublicSettings()
    expect(pub).toEqual({ hasUsdaKey: true, hasLmStudioToken: true, lmStudioUrl: 'http://127.0.0.1:1234', researchModel: '', autoLookup: true, appIcon: 'ring',
      charts: ['calories', 'protein', 'fiber', 'water'],
    })
    expect(JSON.stringify(pub)).not.toMatch(/SECRET/)
  })

  it('keeps the key out of every non-settings table', () => {
    store.setSettings({ usdaApiKey: 'SECRETKEY' })
    store.addEntry(banana())
    const nonSettings = [...allRows('entries'), ...allRows('foods'), ...allRows('meal_presets'), ...allRows('meal_preset_items'), ...allRows('goals')]
    expect(JSON.stringify(nonSettings)).not.toMatch(/SECRET/)
  })
})

describe('safety', () => {
  it('keeps its files private', () => {
    store.addEntry(banana())
    expect(fs.statSync(dir).mode & 0o077).toBe(0)
    expect(fs.statSync(path.join(dir, 'macros.sqlite')).mode & 0o077).toBe(0)
  })

  it('snapshots once per calendar day, not on every write', () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-store-'))
    try {
      vi.setSystemTime(new Date('2026-09-26T10:00:00Z'))
      const first = new Store({ dir: freshDir }) // snapshots once, on construction
      first.addEntry(banana())
      first.addEntry(banana())
      expect(fs.readdirSync(path.join(freshDir, 'backups'))).toHaveLength(1)

      new Store({ dir: freshDir }) // reopening the same day must not add a second snapshot
      expect(fs.readdirSync(path.join(freshDir, 'backups'))).toHaveLength(1)

      vi.setSystemTime(new Date('2026-09-27T10:00:00Z'))
      new Store({ dir: freshDir })
      expect(fs.readdirSync(path.join(freshDir, 'backups'))).toHaveLength(2)
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true })
    }
  })

  it('picks up an edit made to the file while running', () => {
    store.addEntry(banana())
    const other = new Store({ dir })
    other.addEntry(banana())
    expect(store.getDay(DAY).entries).toHaveLength(2)
  })
})

describe('servings', () => {
  const BOWL = { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null }
  const bowl = (over: Partial<NewEntry> = {}): NewEntry => ({
    date: DAY, meal: 'lunch', name: 'Chicken burrito bowl', brand: 'Chipotle', grams: null,
    perUnit: BOWL, amount: { quantity: 1, unit: '1 bowl', unitGrams: null }, source: 'web', ...over,
  })

  it('logs a food known only per serving, by how many servings', () => {
    const e = store.addEntry(bowl({ amount: { quantity: 1.5, unit: '1 bowl', unitGrams: null } }))
    expect(e.nutrients).toEqual({ calories: 990, protein: 75, fat: 31.5, carbs: 102, fiber: null })
    expect(e.grams).toBeNull()
    expect(e.source).toBe('web')
  })

  it('works out the weight when the serving has one', () => {
    const e = store.addEntry(bowl({ amount: { quantity: 2, unit: '1 cup', unitGrams: 163 } }))
    expect(e.grams).toBe(326)
  })

  it('needs an amount to go with per-serving nutrition', () => {
    expect(() => store.addEntry(bowl({ amount: undefined }))).toThrow(/amount is required/)
    expect(() => store.addEntry(bowl({ amount: { quantity: 0, unit: '1 bowl', unitGrams: null } }))).toThrow(/quantity/)
  })

  it('records the unit of a food logged by weight, and rescales in it', () => {
    const e = store.addEntry(banana({ grams: 236, amount: { quantity: 2, unit: '1 medium', unitGrams: 118 } }))
    const edited = store.updateEntry(e.id, { quantity: 1 })
    expect(edited.amount).toEqual({ quantity: 1, unit: '1 medium', unitGrams: 118 })
    expect(edited.grams).toBe(118)
    expect(edited.nutrients.calories).toBe(105)
  })

  it('rescales a per-serving entry by quantity', () => {
    const e = store.addEntry(bowl())
    expect(store.updateEntry(e.id, { quantity: 0.5 }).nutrients.calories).toBe(330)
  })

  it('switches to plain weight when the grams are edited directly', () => {
    const e = store.addEntry(banana({ grams: 118, amount: { quantity: 1, unit: '1 medium', unitGrams: 118 } }))
    expect(store.updateEntry(e.id, { grams: 150 }).amount).toBeUndefined()
  })

  it('offers a per-serving food again under Recent, in its serving', () => {
    store.addEntry(bowl())
    const [recent] = store.recentFoods()
    expect(recent!.perServing).toEqual({ label: '1 bowl', grams: null, nutrients: BOWL })
    expect(recent!.per100g).toBeUndefined()
  })

  it('saves a per-serving food with its sources, keeping only http(s) links', () => {
    const food = store.saveFood({
      id: '', name: 'Burrito bowl', source: 'web',
      perServing: { label: '1 bowl', grams: null, nutrients: BOWL },
      sources: [{ title: 'Chipotle', url: 'https://www.chipotle.com/nutrition-calculator' }, { title: 'x', url: 'javascript:alert(1)' }],
      note: 'Sum of published ingredient values',
    })
    expect(food.sources).toEqual([{ title: 'Chipotle', url: 'https://www.chipotle.com/nutrition-calculator' }])
    expect(food.perServing!.label).toBe('1 bowl')
  })

  it('refuses a food with no nutrition basis at all', () => {
    expect(() => store.saveFood({ id: '', name: 'Nothing', source: 'custom' })).toThrow(/per100g or perServing/)
  })

  it('keeps the LM Studio settings, rejecting a non-http address', () => {
    store.setSettings({ lmStudioUrl: 'http://192.168.1.5:1234/', researchModel: 'qwen/qwen3.8-27b' })
    expect(store.getSettings()).toMatchObject({ lmStudioUrl: 'http://192.168.1.5:1234', researchModel: 'qwen/qwen3.8-27b' })
    expect(() => store.setSettings({ lmStudioUrl: 'file:///etc' })).toThrow(/http/)
  })
})

describe('meal presets', () => {
  const eggs = { name: 'Eggs', per100g: { calories: 155, protein: 13, fat: 11, carbs: 1.1, fiber: 0 }, grams: 100, source: 'usda' as const }
  const toast = {
    name: 'Toast', perUnit: { calories: 75, protein: 3, fat: 1, carbs: 13, fiber: 1 },
    amount: { quantity: 2, unit: '1 slice', unitGrams: 28 }, grams: null, source: 'custom' as const,
  }

  it('saves a group of foods together, and lists it', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs, toast] })
    expect(preset.id).toMatch(/^meal:/)
    expect(preset.items).toHaveLength(2)
    expect(preset.items[0]).toMatchObject({ name: 'Eggs', grams: 100 })
    expect(store.listPresets().map((p) => p.name)).toEqual(['Breakfast'])
  })

  it('needs at least one food', () => {
    expect(() => store.savePreset({ name: 'Empty', items: [] })).toThrow(/at least one food/)
  })

  it('validates each item the same way addEntry does', () => {
    expect(() => store.savePreset({ name: 'Bad', items: [{ name: 'x' }] })).toThrow(/needs per100g, perUnit or nutrients/)
    expect(() => store.savePreset({ name: 'Bad', items: [{ name: 'x', per100g: eggs.per100g }] }))
      .toThrow(/item 1: grams is required/)
  })

  it('applies every item to one date and meal, in one action', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs, toast] })
    const entries = store.applyPreset(preset.id, DAY, 'breakfast')
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.name)).toEqual(['Eggs', 'Toast'])
    expect(entries.every((e) => e.date === DAY && e.meal === 'breakfast')).toBe(true)
    expect(store.getDay(DAY).entries).toHaveLength(2)
    // Nutrients are computed fresh, exactly as a normal log would.
    expect(entries[1]!.nutrients).toEqual({ calories: 150, protein: 6, fat: 2, carbs: 26, fiber: 2 })
  })

  it('applies to a different date and meal each time, unchanged by earlier uses', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs] })
    store.applyPreset(preset.id, DAY, 'breakfast')
    store.applyPreset(preset.id, '2026-09-27', 'snack')
    expect(store.getDay(DAY).entries).toHaveLength(1)
    expect(store.getDay('2026-09-27').entries).toHaveLength(1)
    expect(store.getDay('2026-09-27').entries[0]!.meal).toBe('snack')
  })

  it('checks date and meal before logging anything, not partway through', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs, toast] })
    expect(() => store.applyPreset(preset.id, DAY, 'brunch')).toThrow(/meal must be one of/)
    expect(store.getDay(DAY).entries).toHaveLength(0) // neither item was logged
  })

  it('logs nothing if any food in the meal fails partway through', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs, toast] })
    // Break the second item behind the store's back: per-serving numbers with no amount.
    const db = openRaw()
    db.prepare('UPDATE meal_preset_items SET amount_quantity = NULL WHERE preset_id = ? AND position = 1').run(preset.id)
    db.close()
    expect(() => store.applyPreset(preset.id, DAY, 'breakfast')).toThrow(/amount is required/)
    expect(store.getDay(DAY).entries).toHaveLength(0) // not even the eggs
  })

  it('rejects applying a meal that does not exist', () => {
    expect(() => store.applyPreset('meal:missing', DAY, 'breakfast')).toThrow(/no such meal/)
  })

  it('updates a preset in place when saved again with its id', () => {
    const preset = store.savePreset({ name: 'Breakfast', items: [eggs] })
    const updated = store.savePreset({ id: preset.id, name: 'Big breakfast', items: [eggs, toast] })
    expect(updated.id).toBe(preset.id)
    expect(store.listPresets()).toHaveLength(1)
    expect(store.listPresets()[0]!.items).toHaveLength(2)
  })

  it('deletes a preset, leaving others and not touching foods it used', () => {
    store.saveFood({ id: '', name: 'Eggs', source: 'usda', per100g: eggs.per100g })
    const keep = store.savePreset({ name: 'Keep', items: [eggs] })
    const gone = store.savePreset({ name: 'Gone', items: [toast] })
    store.deletePreset(gone.id)
    expect(store.listPresets().map((p) => p.id)).toEqual([keep.id])
    expect(store.listFoods()).toHaveLength(1) // saveFood/deletePreset are independent
    expect(() => store.deletePreset(gone.id)).toThrow(/no such meal/)
  })

  it('survives a restart', () => {
    store.savePreset({ name: 'Breakfast', items: [eggs, toast] })
    const reopened = new Store({ dir })
    expect(reopened.listPresets().map((p) => p.name)).toEqual(['Breakfast'])
  })
})

describe('migrating from log.json', () => {
  // Migration only runs on the *first* open of a dir, so these tests write
  // the legacy files before that first `new Store()`, in a dir of their own.
  let freshDir: string
  beforeEach(() => {
    freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-migrate-'))
  })
  afterEach(() => fs.rmSync(freshDir, { recursive: true, force: true }))

  it('imports entries, foods and presets, then renames the JSON aside; goals reset to today\'s defaults', () => {
    const legacyLog = {
      entries: { [DAY]: [{ ...banana(), id: 'e1', createdAt: 1, nutrients: BANANA_100G }] },
      foods: [{ id: 'custom:a', name: 'Apple', source: 'custom', per100g: BANANA_100G }],
      mealPresets: [{ id: 'meal:m1', name: 'Breakfast', createdAt: 1, items: [{ name: 'Eggs', per100g: BANANA_100G, grams: 100, source: 'usda' }] }],
      // The old flat shape -- a single number per macro, no day types. No
      // longer compatible with the range-per-day-type goals of today, so
      // migration doesn't try to translate it; it's simply not imported.
      goals: { calories: 2200, protein: 170, fat: 70, carbs: 220, fiber: 32, water: 96 },
    }
    fs.writeFileSync(path.join(freshDir, 'log.json'), JSON.stringify(legacyLog))
    fs.writeFileSync(path.join(freshDir, 'settings.json'), JSON.stringify({ usdaApiKey: 'sk-usda-SECRET', autoLookup: false }))

    const migrated = new Store({ dir: freshDir })

    expect(migrated.getDay(DAY).entries).toHaveLength(1)
    expect(migrated.listFoods().map((f) => f.name)).toEqual(['Apple'])
    expect(migrated.listPresets().map((p) => p.name)).toEqual(['Breakfast'])
    expect(migrated.getGoals()).toEqual(DEFAULT_GOALS)
    expect(migrated.getPublicSettings()).toMatchObject({ hasUsdaKey: true, autoLookup: false })
    expect(fs.existsSync(path.join(freshDir, 'log.json'))).toBe(false)
    expect(fs.existsSync(path.join(freshDir, 'log.json.migrated'))).toBe(true)
    expect(fs.existsSync(path.join(freshDir, 'settings.json.migrated'))).toBe(true)
  })

  it('is retried on next open if nothing was migrated yet', () => {
    const first = new Store({ dir: freshDir })
    first.setGoals({ fiber: 40 })
    const reopened = new Store({ dir: freshDir })
    expect(reopened.getGoals().fiber).toBe(40)
  })

  it('adds the base-and-bump goal columns to a database that predates them', () => {
    // Build exactly what the oldest Store version would have left: a goals
    // table with only the original flat columns, none of today's.
    const db = new DatabaseSync(path.join(freshDir, 'macros.sqlite'))
    db.exec(`CREATE TABLE goals (id INTEGER PRIMARY KEY CHECK (id = 1),
      calories REAL NOT NULL, protein REAL NOT NULL, fat REAL NOT NULL, carbs REAL NOT NULL, fiber REAL NOT NULL)`)
    db.prepare('INSERT INTO goals (id,calories,protein,fat,carbs,fiber) VALUES (1,2000,150,65,200,30)').run()
    db.close()

    const upgraded = new Store({ dir: freshDir })
    // The old flat columns are left in place but unused (fiber's column name
    // is unchanged, so that value survives); water, alcohol and the base
    // macros and carb bump default to today's DEFAULT_GOALS.
    expect(upgraded.getGoals()).toEqual({ ...DEFAULT_GOALS, fiber: 30 })
  })
})

describe('online lookup cache', () => {
  const RESULT = { query: 'chipotle bowl', foods: [{ id: 'web:1', name: 'Bowl', source: 'web' as const }], model: 'm', seconds: 90 }

  it('remembers a lookup, across restarts', () => {
    expect(store.getLookup('bowl chipotle')).toBeUndefined()
    store.setLookup('bowl chipotle', RESULT)
    expect(new Store({ dir }).getLookup('bowl chipotle')).toEqual(RESULT)
  })

  it('shares one cache between running copies of the app', () => {
    const other = new Store({ dir })
    store.setLookup('a', RESULT)
    other.setLookup('b', RESULT)
    expect(store.getLookup('b')).toEqual(RESULT)
    expect(other.getLookup('a')).toEqual(RESULT)
  })

  it('forgets a lookup after 30 days', () => {
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'))
    store.setLookup('old', RESULT)
    vi.setSystemTime(new Date('2026-10-05T00:00:00Z'))
    expect(store.getLookup('old')).toBeUndefined()
  })

  it('keeps only the newest 200', () => {
    for (let i = 0; i < 205; i++) {
      vi.setSystemTime(new Date(2026, 8, 1, 0, 0, i))
      store.setLookup(`q${i}`, RESULT)
    }
    expect(store.getLookup('q0')).toBeUndefined()
    expect(store.getLookup('q204')).toEqual(RESULT)
    expect((allRows('lookup_cache') as unknown[]).length).toBe(200)
  })

  it('shows the corrected copy of a saved food in a cached lookup that found it', () => {
    const BOWL = { calories: 660, protein: 50, fat: 21, carbs: 68, fiber: null }
    const found = { id: 'web:bowl', name: 'Bowl', source: 'web' as const, perServing: { label: '1 bowl', grams: null, nutrients: BOWL } }
    store.setLookup('bowl chipotle', { ...RESULT, foods: [found] })
    const atBefore = (allRows('lookup_cache')[0] as { at: number }).at
    store.saveFood({ ...found, perServing: { ...found.perServing, nutrients: { ...BOWL, fiber: 12 } } })
    expect(store.getLookup('bowl chipotle')!.foods[0]!.perServing!.nutrients.fiber).toBe(12)
    expect((allRows('lookup_cache')[0] as { at: number }).at).toBe(atBefore)
  })

  it('imports the old lookups.json once, re-keyed, dropping empty answers', () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'macros-lookups-'))
    try {
      fs.writeFileSync(path.join(freshDir, 'lookups.json'), JSON.stringify({
        'chipotle chicken bowl': { at: Date.now(), result: RESULT },
        'unicorn steak': { at: Date.now(), result: { ...RESULT, foods: [] } },
      }))
      const migrated = new Store({ dir: freshDir })
      expect(migrated.getLookup('bowl chicken chipotle')).toEqual(RESULT)
      expect(migrated.getLookup('steak unicorn')).toBeUndefined()
      expect(fs.existsSync(path.join(freshDir, 'lookups.json'))).toBe(false)
      expect(fs.existsSync(path.join(freshDir, 'lookups.json.migrated'))).toBe(true)
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true })
    }
  })
})

describe('alcohol', () => {
  it('starts at zero', () => {
    expect(store.getDay(DAY).alcohol).toEqual({
      drinks: 0, byKind: { beer: 0, wine: 0, liquor: 0 }, calories: 0, weekTotal: 0, weekGoal: 7, lastLogId: null,
    })
  })

  it('counts drinks by kind, and in total', () => {
    store.addAlcohol(DAY, 'wine')
    store.addAlcohol(DAY, 'wine')
    const last = store.addAlcohol(DAY, 'beer')
    expect(store.getDay(DAY).alcohol).toEqual({
      drinks: 3, byKind: { beer: 1, wine: 2, liquor: 0 }, calories: 400, weekTotal: 3, weekGoal: 7, lastLogId: last.id,
    })
  })

  it('keeps days separate', () => {
    store.addAlcohol(DAY, 'beer')
    expect(store.getDay('2026-09-27').alcohol.drinks).toBe(0)
  })

  it('undoes the most recent drink', () => {
    store.addAlcohol(DAY, 'beer')
    const second = store.addAlcohol(DAY, 'liquor')
    store.deleteAlcohol(second.id)
    expect(store.getDay(DAY).alcohol.byKind).toEqual({ beer: 1, wine: 0, liquor: 0 })
  })

  it('refuses a kind it does not know, and an unknown log', () => {
    expect(() => store.addAlcohol(DAY, 'mead')).toThrow(ValidationError)
    expect(() => store.deleteAlcohol('nope')).toThrow(/no such log/)
  })

  it('survives a restart', () => {
    store.addAlcohol(DAY, 'wine')
    expect(new Store({ dir }).getDay(DAY).alcohol.drinks).toBe(1)
  })

  describe('the weekly cap', () => {
    it('defaults to 7 and is editable', () => {
      expect(store.getGoals().alcoholWeekly).toBe(7)
      store.setGoals({ alcoholWeekly: 4 })
      expect(store.getGoals().alcoholWeekly).toBe(4)
    })

    it('refuses a nonsense goal', () => {
      expect(() => store.setGoals({ alcoholWeekly: -1 })).toThrow(ValidationError)
    })

    it("totals the calendar week (Monday-start) a day falls in, not just that day", () => {
      const weekStart = startOfWeek(DAY)
      store.addAlcohol(weekStart, 'beer') // earlier in the same week
      store.addAlcohol(DAY, 'wine')
      store.addAlcohol(addDays(weekStart, 6), 'liquor') // later in the same week
      store.addAlcohol(addDays(weekStart, -1), 'beer') // last week -- must not count
      expect(store.getDay(DAY).alcohol.weekTotal).toBe(3)
    })

    it('reflects a changed goal in the day view', () => {
      store.setGoals({ alcoholWeekly: 3 })
      expect(store.getDay(DAY).alcohol.weekGoal).toBe(3)
    })
  })
})

describe('water', () => {
  it('starts at zero, against the default goal', () => {
    expect(store.getDay(DAY).water).toEqual({ ounces: 0, goal: 96, lastLogId: null })
  })

  it('logs a bottle and adds it to the day total', () => {
    const log = store.addWater(DAY, 32)
    expect(log.ounces).toBe(32)
    const water = store.getDay(DAY).water
    expect(water.ounces).toBe(32)
    expect(water.lastLogId).toBe(log.id)
  })

  it('sums multiple logs for the same day', () => {
    store.addWater(DAY, 32)
    store.addWater(DAY, 32)
    expect(store.getDay(DAY).water.ounces).toBe(64)
  })

  it('keeps days separate', () => {
    store.addWater(DAY, 32)
    expect(store.getDay('2026-09-27').water.ounces).toBe(0)
  })

  it('undoes the most recent log', () => {
    store.addWater(DAY, 32)
    const second = store.addWater(DAY, 16)
    store.deleteWater(second.id)
    const water = store.getDay(DAY).water
    expect(water.ounces).toBe(32)
    expect(water.lastLogId).not.toBe(second.id)
  })

  it('refuses a nonsense amount', () => {
    expect(() => store.addWater(DAY, 0)).toThrow(ValidationError)
    expect(() => store.addWater(DAY, -5)).toThrow(ValidationError)
    expect(() => store.addWater(DAY, 500)).toThrow(ValidationError)
  })

  it('refuses to undo a log that does not exist', () => {
    expect(() => store.deleteWater('nope')).toThrow(/no such log/)
  })

  it('goal defaults to 96oz (3 x 32oz bottles) and is editable', () => {
    expect(store.getGoals().water).toBe(96)
    store.setGoals({ water: 64 })
    expect(store.getGoals().water).toBe(64)
  })

  it('refuses a nonsense goal', () => {
    expect(() => store.setGoals({ water: -1 })).toThrow(ValidationError)
  })

  it('survives a restart', () => {
    store.addWater(DAY, 32)
    expect(new Store({ dir }).getDay(DAY).water.ounces).toBe(32)
  })
})

describe('workouts', () => {
  it('starts empty, against the weekly goal', () => {
    expect(store.getDay(DAY).workouts).toEqual({
      sessions: [], minutes: 0, weekStart: startOfWeek(DAY), planIsCustom: false,
      plan: { wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 },
      weekByKind: { wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 0, pilates: 0 },
      weekTotal: 0, weekGoal: 9, lastLogId: null,
    })
  })

  it('logs sessions with or without minutes, newest first, and totals the minutes noted', () => {
    store.addWorkout({ date: DAY, kind: 'cycling', minutes: 30 })
    const run = store.addWorkout({ date: DAY, kind: 'run', note: '  easy 5k  ' })
    const w = store.getDay(DAY).workouts
    expect(w.sessions.map((s) => s.kind)).toEqual(['run', 'cycling'])
    expect(w.sessions[0]).toMatchObject({ minutes: null, note: 'easy 5k' })
    expect(w.minutes).toBe(30)
    expect(w.lastLogId).toBe(run.id)
  })

  it('counts the calendar week (Monday-start) toward the weekly goal', () => {
    const monday = startOfWeek(DAY)
    store.addWorkout({ date: monday, kind: 'yoga' })
    store.addWorkout({ date: addDays(monday, 6), kind: 'run' }) // Sunday, same week
    store.addWorkout({ date: addDays(monday, 7), kind: 'run' }) // next Monday
    expect(store.getDay(monday).workouts.weekTotal).toBe(2)
  })

  it('ticks the day as a training day for a WOD or lifting session, and leaves it alone otherwise', () => {
    store.addWorkout({ date: DAY, kind: 'cycling' })
    expect(store.getDay(DAY).dayType).toBe('rest')
    store.addWorkout({ date: DAY, kind: 'wod', minutes: 45 })
    expect(store.getDay(DAY).dayType).toBe('training')
    store.addWorkout({ date: '2026-09-27', kind: 'weightlifting' })
    expect(store.getDay('2026-09-27').dayType).toBe('training')
    // The box stays the user's: unticking by hand sticks.
    store.setDayType(DAY, 'rest')
    expect(store.getDay(DAY).dayType).toBe('rest')
  })

  it('removes a session, and refuses one that does not exist', () => {
    const s = store.addWorkout({ date: DAY, kind: 'yoga' })
    store.deleteWorkout(s.id)
    expect(store.getDay(DAY).workouts.sessions).toEqual([])
    expect(() => store.deleteWorkout(s.id)).toThrow(/no such log/)
  })

  it('refuses an unknown kind, a bad date or nonsense minutes', () => {
    expect(() => store.addWorkout({ date: DAY, kind: 'jousting' })).toThrow(/kind must be one of/)
    expect(() => store.addWorkout({ date: 'today', kind: 'run' })).toThrow(ValidationError)
    expect(() => store.addWorkout({ date: DAY, kind: 'run', minutes: -5 })).toThrow(/positive number/)
    expect(() => store.addWorkout({ date: DAY, kind: 'run', minutes: 5000 })).toThrow(/positive number/)
  })

  it('survives a restart', () => {
    store.addWorkout({ date: DAY, kind: 'wod', minutes: 20 })
    expect(new Store({ dir }).getDay(DAY).workouts.sessions[0]).toMatchObject({ kind: 'wod', minutes: 20 })
  })
})

describe('meditation', () => {
  it('starts at zero, against the default goal', () => {
    expect(store.getDay(DAY).meditation).toEqual({ sessions: [], minutes: 0, goal: 50, lastLogId: null })
  })

  it('adds sits up toward the day goal, and undoes the latest', () => {
    store.addMeditation({ date: DAY, minutes: 5 })
    const second = store.addMeditation({ date: DAY, minutes: 10 })
    expect(store.getDay(DAY).meditation).toMatchObject({ minutes: 15, lastLogId: second.id })
    store.deleteMeditation(second.id)
    expect(store.getDay(DAY).meditation.minutes).toBe(5)
  })

  it('needs minutes, and sensible ones', () => {
    expect(() => store.addMeditation({ date: DAY })).toThrow(/minutes is required/)
    expect(() => store.addMeditation({ date: DAY, minutes: 0 })).toThrow(/positive number/)
  })

  it('adds a configurable calorie buffer to every day type, and keeps it through an upgrade', () => {
    expect(store.getGoals().calorieBuffer).toBe(100)
    expect(store.getDay(DAY).goals.calories.max).toBe(1800) // 1700 from the default macros + 100
    store.setGoals({ calorieBuffer: 250 })
    store.setDayType(DAY, 'training')
    expect(store.getDay(DAY).goals.calories.max).toBe(2090) // 1840 + 250
    expect(() => store.setGoals({ calorieBuffer: -10 })).toThrow(ValidationError)
    const db = openRaw()
    try {
      db.exec('ALTER TABLE goals DROP COLUMN calorie_buffer')
      db.exec('PRAGMA user_version = 5')
    } finally {
      db.close()
    }
    expect(new Store({ dir }).getGoals().calorieBuffer).toBe(100) // an older database gets the default
  })

  it('takes its goal, and the default weekly workout plan, from Settings', () => {
    store.setGoals({ meditationMinutes: 20, workoutPlan: { yoga: 3, wod: 1 } as never })
    const day = store.getDay(DAY)
    expect(day.meditation.goal).toBe(20)
    expect(day.workouts.plan).toEqual({ wod: 1, weightlifting: 0, run: 0, cycling: 0, yoga: 3, pilates: 0 }) // unnamed kinds are 0
    expect(day.workouts.weekGoal).toBe(4)
    expect(new Store({ dir }).getGoals().workoutPlan.yoga).toBe(3)
    expect(() => store.setGoals({ meditationMinutes: -1 })).toThrow(ValidationError)
    expect(() => store.setGoals({ workoutPlan: { yoga: 2.5 } as never })).toThrow(/whole number/)
    expect(() => store.setGoals({ workoutPlan: { jousting: 1 } as never })).toThrow(/unknown workout kind/)
  })

  it('counts weeks Sunday to Saturday: a Saturday closes the week, the next day starts a fresh one', () => {
    const sat = '2026-09-26'
    const sun = '2026-09-27'
    store.addWorkout({ date: '2026-09-20', kind: 'yoga' }) // the Sunday that opens Saturday's week
    store.addWorkout({ date: sat, kind: 'yoga' })
    store.addAlcohol(sat, 'wine')
    expect(store.getDay(sat).workouts).toMatchObject({ weekStart: '2026-09-20', weekTotal: 2 })
    expect(store.getDay(sat).alcohol.weekTotal).toBe(1)
    expect(store.getDay(sun).workouts).toMatchObject({ weekStart: sun, weekTotal: 0 })
    expect(store.getDay(sun).alcohol.weekTotal).toBe(0)
  })

  it('moves a week plan stored by its Monday (before weeks started on Sunday) to that Sunday', () => {
    const db = openRaw()
    try {
      db.prepare('INSERT INTO workout_plans (week_start, plan) VALUES (?, ?)').run('2026-09-21', JSON.stringify({ yoga: 6 }))
      db.exec('PRAGMA user_version = 7')
    } finally {
      db.close()
    }
    const upgraded = new Store({ dir })
    expect(upgraded.getDay('2026-09-23').workouts).toMatchObject({ weekStart: '2026-09-20', planIsCustom: true, weekGoal: 6 })
  })

  it("gives one week its own plan, leaving the default and every other week alone, and can put it back", () => {
    const week = startOfWeek(DAY)
    const nextWeek = addDays(week, 7)
    store.addWorkout({ date: DAY, kind: 'yoga' })
    store.addWorkout({ date: DAY, kind: 'run' })
    store.setWeekPlan(week, { yoga: 5, run: 1 })
    let w = store.getDay(DAY).workouts
    expect(w).toMatchObject({ planIsCustom: true, weekGoal: 6 })
    expect(w.plan).toMatchObject({ yoga: 5, run: 1, wod: 0 })
    expect(w.weekByKind).toMatchObject({ yoga: 1, run: 1 })
    // Another day in the same week sees it too; next week, and the default, don't.
    expect(store.getDay(addDays(week, 6)).workouts.planIsCustom).toBe(true)
    expect(store.getDay(nextWeek).workouts).toMatchObject({ planIsCustom: false, weekGoal: 9 })
    expect(store.getGoals().workoutPlan.yoga).toBe(4)
    store.clearWeekPlan(week)
    w = store.getDay(DAY).workouts
    expect(w).toMatchObject({ planIsCustom: false, weekGoal: 9 })
    expect(() => store.setWeekPlan(addDays(week, 1), { yoga: 1 })).toThrow(/must be a Sunday/)
  })

  it('upgrades a database from before workouts and meditation, keeping the goals already set', () => {
    store.setGoals({ protein: 140 })
    const db = openRaw()
    try {
      // Back to version 4's shape: no new goal columns, no new tables.
      db.exec('ALTER TABLE goals DROP COLUMN workouts_weekly')
      db.exec('ALTER TABLE goals DROP COLUMN meditation_minutes')
      db.exec('ALTER TABLE goals DROP COLUMN calorie_buffer')
      db.exec('ALTER TABLE goals DROP COLUMN workout_plan')
      db.exec('DROP TABLE workout_plans')
      db.exec('DROP TABLE workout_logs')
      db.exec('DROP TABLE meditation_logs')
      db.exec('PRAGMA user_version = 4')
    } finally {
      db.close()
    }
    const upgraded = new Store({ dir })
    expect(upgraded.getGoals()).toMatchObject({ protein: 140, meditationMinutes: 50 })
    expect(upgraded.getGoals().workoutPlan).toEqual({ wod: 2, weightlifting: 2, run: 0, cycling: 0, yoga: 4, pilates: 1 })
    upgraded.setWeekPlan(startOfWeek(DAY), { yoga: 1 }) // the per-week table is back too
    upgraded.addMeditation({ date: DAY, minutes: 10 })
    expect(upgraded.getDay(DAY).meditation.minutes).toBe(10)
  })
})

describe('ranges', () => {
  const D1 = '2026-09-21'
  const D2 = '2026-09-22'
  const D3 = '2026-09-23'

  it('totals workouts by kind and day, and scores meditation like water, with a streak up to the range end', () => {
    store.addWorkout({ date: D1, kind: 'wod', minutes: 40 })
    store.addWorkout({ date: D1, kind: 'cycling' })
    store.addWorkout({ date: D3, kind: 'run', minutes: 25 })
    store.addMeditation({ date: D2, minutes: 25 })
    store.addMeditation({ date: D2, minutes: 25 })
    store.addMeditation({ date: D3, minutes: 5 })
    const range = store.getRange(D1, D3)
    // Three days (Mon-Wed) of one week: three sevenths of its plan, rounded -- 2 WOD -> 1, 4 yoga -> 2, 1 pilates -> 0.
    expect(range.workouts).toEqual({
      sessions: 3, days: 2, minutes: 65, byKind: { wod: 1, weightlifting: 0, run: 1, cycling: 1, yoga: 0, pilates: 0 },
      goalByKind: { wod: 1, weightlifting: 1, run: 0, cycling: 0, yoga: 2, pilates: 0 }, goal: 4,
    })
    // A whole week gets its plan exactly, its own plan if it has one.
    const sunday = startOfWeek(D1)
    store.setWeekPlan(sunday, { yoga: 3, pilates: 2 })
    expect(store.getRange(sunday, addDays(sunday, 6)).workouts.goalByKind).toEqual({ wod: 0, weightlifting: 0, run: 0, cycling: 0, yoga: 3, pilates: 2 })
    expect(range.days.map((d) => d.workouts)).toEqual([2, 0, 1])
    // D2's two sits met the 50-minute goal, D3 didn't; D1 had none and is left out. D2-D3 is a two-day run.
    expect(range.meditation).toEqual({ total: 55, average: 18.3, days: 2, met: 1, of: 2, streak: 2 })
  })

  it('has one entry per calendar day, even ones with nothing logged', () => {
    store.addEntry(banana({ date: D1 }))
    const range = store.getRange(D1, D3)
    expect(range.days.map((d) => d.date)).toEqual([D1, D2, D3])
    expect(range.days[0]!.entryCount).toBe(1)
    expect(range.days[1]!.entryCount).toBe(0)
    expect(range.totalDays).toBe(3)
  })

  it('sums totals across the range, and averages only over days that were logged', () => {
    store.addEntry(banana({ date: D1 })) // 89 * 1.18 = 105.0 kcal
    store.addEntry(banana({ date: D3, grams: 236 })) // 89 * 2.36 = 210.0 kcal
    const range = store.getRange(D1, D3)
    expect(range.loggedDays).toBe(2)
    expect(range.totals.calories).toBeCloseTo(315, 0)
    // Not /3: the untouched middle day would drag a real average down.
    expect(range.averages.calories).toBeCloseTo(157.5, 1)
  })

  it('reports zeroed totals and averages over an untouched range, without dividing by zero', () => {
    const range = store.getRange(D1, D3)
    expect(range.loggedDays).toBe(0)
    expect(range.totals).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 })
    expect(range.averages).toEqual({ calories: 0, protein: 0, fat: 0, carbs: 0, fiber: 0 })
  })

  it("averages and scores only finished days: today's partial log and the days ahead don't drag the month down", () => {
    // A month seen on its 4th: three full days logged, today barely started, 27 days to come.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 4, 12)) // Oct 4, noon, local time
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03']) {
      store.addEntry(banana({ date, grams: 1000 })) // 890 kcal a day
      store.addWater(date, 96)
      store.addMeditation({ date, minutes: 50 })
    }
    store.addEntry(banana({ date: '2026-10-04', grams: 100 })) // today so far: 89 kcal
    const r = store.getRange('2026-10-01', '2026-10-31')
    expect(r).toMatchObject({ totalDays: 31, loggedDays: 4, averagedDays: 3 })
    expect(r.averages.calories).toBe(890) // not (3 x 890 + 89) / 4
    expect(r.totals.calories).toBeCloseTo(2759, 0) // totals still include today
    expect(r.water.average).toBe(96) // 288 over the 3 finished days, not 31
    expect(r.meditation.average).toBe(50)
    expect(r.scorecard.protein.of).toBe(3) // today isn't a miss yet
    // Nothing logged for meditation today doesn't break the streak; the run up to yesterday counts.
    expect(r.meditation.streak).toBe(3)
    store.addMeditation({ date: '2026-10-04', minutes: 25 })
    expect(store.getRange('2026-10-01', '2026-10-31').meditation.streak).toBe(4)
  })

  it("on a range's first day, today stands in so there is something to show", () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 1, 12))
    store.addEntry(banana({ date: '2026-10-01' }))
    const r = store.getRange('2026-10-01', '2026-10-31')
    expect(r.averagedDays).toBe(1)
    expect(r.averages.calories).toBeGreaterThan(0)
  })

  it('averages water and alcohol over every day in the range, not just logged ones', () => {
    store.addWater(D1, 32)
    store.addAlcohol(D1, 'wine')
    store.addAlcohol(D3, 'beer')
    const range = store.getRange(D1, D3)
    // Rounded to one decimal, like every other total in this app.
    // 32 oz on one day: logged, but short of the 96 oz goal; the other two days had none logged.
    expect(range.water).toEqual({ total: 32, average: 10.7, met: 0, of: 1 })
    expect(range.alcohol.total).toBe(2)
    expect(range.alcohol.average).toBeCloseTo(0.7, 5)
    expect(range.alcohol.byKind).toEqual({ beer: 1, wine: 1, liquor: 0 })
    // The drinks' calories are reported for the range, but stay out of the food totals and goals.
    expect(range.alcohol.calories).toBe(275)
    expect(range.totals.calories).toBe(0)
    expect(range.days[0]!.goals.calories.max).toBe(1800)
  })

  it('carries the current goals along, same as a day view', () => {
    store.setGoals({ protein: 140, fat: 45, carbs: 100, trainingCarbs: 20, calorieBuffer: 0 })
    // No day ticked as training, so every day in range is a rest day: 140*4 + 100*4 + 45*9 = 1365.
    expect(store.getRange(D1, D3).goals.calories.min).toBe(1365)
    // Tick one of the three: the blended goal moves a third of the way to the training day's 1445 (+20 g carbs).
    store.setDayType(D2, 'training')
    expect(store.getRange(D1, D3).goals.calories.min).toBeCloseTo((1365 * 2 + 1445) / 3, 1)
  })

  it('scores each logged day against its own goal, and says how the days were split', () => {
    // A target a banana can meet: at least 1 g protein; at most 1 g fat, 30 g carbs and (with the buffer) 233 kcal.
    store.setGoals({ protein: 1, fat: 1, carbs: 30, trainingCarbs: 10 })
    store.addEntry(banana({ date: D1 })) // 118 g: 105 kcal, 1.3 g protein, 26.9 g carbs, 0.4 g fat, 3.1 g fiber
    store.setDayType(D3, 'training')
    const range = store.getRange(D1, D3)
    expect(range.dayTypes).toEqual({ training: 1, rest: 2 })
    expect(range.days[0]!.goals.carbs).toEqual({ min: 30, max: 30 })
    expect(range.days[2]!.goals.carbs).toEqual({ min: 40, max: 40 }) // the training day's bump
    // Only D1 was logged: it met everything but fiber (3.1 g of the 30 g goal).
    expect(range.scorecard).toEqual({
      calories: { met: 1, of: 1 }, protein: { met: 1, of: 1 }, fat: { met: 1, of: 1 }, carbs: { met: 1, of: 1 }, fiber: { met: 0, of: 1 },
    })
  })

  it('rejects a malformed or backwards range', () => {
    expect(() => store.getRange('not-a-date', D3)).toThrow(ValidationError)
    expect(() => store.getRange(D1, 'nope')).toThrow(ValidationError)
    expect(() => store.getRange(D3, D1)).toThrow(/end must not be before start/)
  })

  it('rejects a range longer than a year', () => {
    expect(() => store.getRange('2025-01-01', '2026-01-02')).toThrow(/too long/)
    expect(() => store.getRange('2025-01-01', '2026-01-01')).not.toThrow()
  })
})
