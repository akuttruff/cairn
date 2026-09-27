import { describe, it, expect } from 'vitest'
import { matchMine } from './match.ts'
import type { Food } from '../types.ts'

const food = (name: string, brand?: string): Food => ({
  id: name, name, brand, source: 'off',
  per100g: { calories: 100, protein: 1, fat: 1, carbs: 1, fiber: null },
})

const MINE = [food('Mandarin Orange Chicken', "Trader Joe's"), food('Hummus', "Trader Joe's"), food('Hummus', 'Sabra')]

describe('matchMine', () => {
  it('matches every word across name and brand, apostrophes optional', () => {
    expect(matchMine(MINE, 'trader joes hummus').map((f) => f.brand)).toEqual(["Trader Joe's"])
    expect(matchMine(MINE, 'orange chick')).toHaveLength(1)
    expect(matchMine(MINE, 'hummus')).toHaveLength(2)
  })

  it('understands store-brand shorthand', () => {
    expect(matchMine(MINE, 'tjs hummus').map((f) => f.brand)).toEqual(["Trader Joe's"])
    expect(matchMine(MINE, "trader joe's")).toHaveLength(2)
    expect(matchMine([food('Oats', '365 Everyday Value')], 'whole foods oats')).toHaveLength(1)
  })

  it('finds nothing for words that are not there, or no words', () => {
    expect(matchMine(MINE, 'yogurt')).toEqual([])
    expect(matchMine(MINE, '  ')).toEqual([])
  })

  it('lists a food once even if it is both saved and recent', () => {
    expect(matchMine([...MINE, food('Hummus', 'Sabra')], 'sabra')).toHaveLength(1)
  })
})
