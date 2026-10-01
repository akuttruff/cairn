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

  it('does not snapshot a saved food into history', () => {
    // Editing a saved food must never rewrite what was already eaten.
    store.addEntry(banana())
    store.saveFood({ id: 'usda:173944', name: 'Bananas, raw', source: 'usda',
      per100g: { ...BANANA_100G, calories: 999 } })
    expect(store.getDay(DAY).totals.calories).toBe(105)
  })
})

describe('goals and settings', () => {
  it('starts with sensible goals', () => {
    expect(store.getGoals().fiber).toBe(30)
  })

  it('updates only the goals given, leaving the rest as they were', () => {
    store.setGoals({ fiber: 40 })
    const goals = store.getGoals()
    expect(goals.fiber).toBe(40)
    expect(goals.training).toEqual(DEFAULT_GOALS.training)
  })

  it('replaces a whole day-type profile when one is given', () => {
    store.setGoals({ training: { protein: { min: 140, max: 150 }, carbs: { min: 100, max: 110 }, fat: { min: 45, max: 50 } } })
    expect(store.getGoals().training).toEqual({ protein: { min: 140, max: 150 }, carbs: { min: 100, max: 110 }, fat: { min: 45, max: 50 } })
  })

  it('refuses a nonsense goal', () => {
    expect(() => store.setGoals({ fiber: -1 })).toThrow(ValidationError)
    expect(() => store.setGoals({ training: { protein: { min: 10, max: 5 }, carbs: { min: 0, max: 10 }, fat: { min: 0, max: 10 } } })).toThrow(ValidationError)
  })

  it('never exposes the USDA key', () => {
    store.setSettings({ usdaApiKey: 'SECRETKEY', lmStudioToken: 'sk-lm-SECRET' })
    const pub = store.getPublicSettings()
    expect(pub).toEqual({ hasUsdaKey: true, hasLmStudioToken: true, lmStudioUrl: 'http://127.0.0.1:1234', researchModel: '', autoLookup: true })
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

  it('adds the day-type range columns to a database that predates them', () => {
    // Build exactly what an older Store version would have left: a goals
    // table with only the old flat columns, none of today's range ones.
    const db = new DatabaseSync(path.join(freshDir, 'macros.sqlite'))
    db.exec(`CREATE TABLE goals (id INTEGER PRIMARY KEY CHECK (id = 1),
      calories REAL NOT NULL, protein REAL NOT NULL, fat REAL NOT NULL, carbs REAL NOT NULL, fiber REAL NOT NULL)`)
    db.prepare('INSERT INTO goals (id,calories,protein,fat,carbs,fiber) VALUES (1,2000,150,65,200,30)').run()
    db.close()

    const upgraded = new Store({ dir: freshDir })
    // The old flat columns are left in place but unused (fiber's column name
    // is unchanged, so that value survives); water, alcohol and the new
    // per-day-type ranges default to today's DEFAULT_GOALS.
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
      drinks: 0, byKind: { beer: 0, wine: 0, liquor: 0 }, weekTotal: 0, weekGoal: 7, lastLogId: null,
    })
  })

  it('counts drinks by kind, and in total', () => {
    store.addAlcohol(DAY, 'wine')
    store.addAlcohol(DAY, 'wine')
    const last = store.addAlcohol(DAY, 'beer')
    expect(store.getDay(DAY).alcohol).toEqual({
      drinks: 3, byKind: { beer: 1, wine: 2, liquor: 0 }, weekTotal: 3, weekGoal: 7, lastLogId: last.id,
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

describe('ranges', () => {
  const D1 = '2026-09-21'
  const D2 = '2026-09-22'
  const D3 = '2026-09-23'

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
  })

  it('carries the current goals along, same as a day view', () => {
    store.setGoals({ rest: { protein: { min: 140, max: 150 }, carbs: { min: 100, max: 110 }, fat: { min: 45, max: 50 } } })
    // No day ticked as training, so every day in range resolves to rest: 140*4 + 100*4 + 45*9 = 1365.
    expect(store.getRange(D1, D3).goals.calories.min).toBe(1365)
    // Tick one of the three: the blended goal moves a third of the way to the training profile.
    store.setDayType(D2, 'training')
    const trainingMin = 120 * 4 + 220 * 4 + 60 * 9 // today's default training profile: 1900
    expect(store.getRange(D1, D3).goals.calories.min).toBeCloseTo((1365 * 2 + trainingMin) / 3, 1)
  })

  it('scores each logged day against its own goal, and says how the days were split', () => {
    // A rest-day target a banana can meet: 1-2 g protein, 20-30 g carbs, up to 1 g fat.
    store.setGoals({ rest: { protein: { min: 1, max: 2 }, carbs: { min: 20, max: 30 }, fat: { min: 0, max: 1 } } })
    store.addEntry(banana({ date: D1 })) // 118 g: 105 kcal, 1.3 g protein, 26.9 g carbs, 0.4 g fat, 3.1 g fiber
    store.setDayType(D3, 'training')
    const range = store.getRange(D1, D3)
    expect(range.dayTypes).toEqual({ training: 1, rest: 2 })
    expect(range.days[0]!.goals.carbs).toEqual({ min: 20, max: 30 })
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
