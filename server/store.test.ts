import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Store, ValidationError } from './store.ts'
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

  it('will not let a database food drift from its own weight', () => {
    const e = store.addEntry(banana())
    expect(() => store.updateEntry(e.id, { nutrients: BANANA_100G })).toThrow(/follow from the amount/)
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

  it('updates only the goals given', () => {
    store.setGoals({ protein: 180 })
    expect(store.getGoals()).toMatchObject({ protein: 180, calories: 2000 })
  })

  it('refuses a nonsense goal', () => {
    expect(() => store.setGoals({ calories: -1 })).toThrow(ValidationError)
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

  it('imports entries, foods, presets, goals and settings, then renames the JSON aside', () => {
    const legacyLog = {
      entries: { [DAY]: [{ ...banana(), id: 'e1', createdAt: 1, nutrients: BANANA_100G }] },
      foods: [{ id: 'custom:a', name: 'Apple', source: 'custom', per100g: BANANA_100G }],
      mealPresets: [{ id: 'meal:m1', name: 'Breakfast', createdAt: 1, items: [{ name: 'Eggs', per100g: BANANA_100G, grams: 100, source: 'usda' }] }],
      goals: { calories: 2200, protein: 170, fat: 70, carbs: 220, fiber: 32 },
    }
    fs.writeFileSync(path.join(freshDir, 'log.json'), JSON.stringify(legacyLog))
    fs.writeFileSync(path.join(freshDir, 'settings.json'), JSON.stringify({ usdaApiKey: 'sk-usda-SECRET', autoLookup: false }))

    const migrated = new Store({ dir: freshDir })

    expect(migrated.getDay(DAY).entries).toHaveLength(1)
    expect(migrated.listFoods().map((f) => f.name)).toEqual(['Apple'])
    expect(migrated.listPresets().map((p) => p.name)).toEqual(['Breakfast'])
    expect(migrated.getGoals()).toEqual(legacyLog.goals)
    expect(migrated.getPublicSettings()).toMatchObject({ hasUsdaKey: true, autoLookup: false })
    expect(fs.existsSync(path.join(freshDir, 'log.json'))).toBe(false)
    expect(fs.existsSync(path.join(freshDir, 'log.json.migrated'))).toBe(true)
    expect(fs.existsSync(path.join(freshDir, 'settings.json.migrated'))).toBe(true)
  })

  it('is retried on next open if nothing was migrated yet', () => {
    const first = new Store({ dir: freshDir })
    first.setGoals({ protein: 175 })
    const reopened = new Store({ dir: freshDir })
    expect(reopened.getGoals().protein).toBe(175)
  })
})
