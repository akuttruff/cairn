import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store, ValidationError } from './store.ts'
import type { NewEntry, Nutrients } from '../src/types.ts'

let dir: string
let store: Store

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
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

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
    expect(() => store.updateEntry(e.id, { nutrients: BANANA_100G })).toThrow(/follow from the weight/)
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
    store.setSettings({ usdaApiKey: 'SECRETKEY' })
    const pub = store.getPublicSettings()
    expect(pub).toEqual({ hasUsdaKey: true })
    expect(JSON.stringify(pub)).not.toMatch(/SECRET/)
  })

  it('keeps the key out of the food log', () => {
    store.setSettings({ usdaApiKey: 'SECRETKEY' })
    store.addEntry(banana())
    expect(fs.readFileSync(path.join(dir, 'log.json'), 'utf8')).not.toMatch(/SECRET/)
  })
})

describe('safety', () => {
  it('keeps its files private', () => {
    store.addEntry(banana())
    expect(fs.statSync(dir).mode & 0o077).toBe(0)
    expect(fs.statSync(path.join(dir, 'log.json')).mode & 0o077).toBe(0)
  })

  it('backs up before losing more than one entry at once', () => {
    store.addEntry(banana())
    store.addEntry(banana())
    store.addEntry(banana())
    // Simulate a bug that clears the day in memory.
    const bugged = new Store({ dir })
    ;(bugged as unknown as { log: { entries: Record<string, unknown> } }).log.entries = {}
    bugged.setGoals({ protein: 160 }) // any write
    expect(fs.readdirSync(path.join(dir, 'backups'))).toHaveLength(1)
  })

  it('does not back up an ordinary single delete', () => {
    const e = store.addEntry(banana())
    store.deleteEntry(e.id)
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false)
  })

  it('picks up an edit made to the file while running', () => {
    store.addEntry(banana())
    const other = new Store({ dir })
    other.addEntry(banana())
    expect(store.getDay(DAY).entries).toHaveLength(2)
  })
})
