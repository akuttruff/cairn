import { describe, it, expect } from 'vitest'
import { detectBrand, plainTerms, tidyBrand, tidyName } from './brands.ts'

describe('detectBrand', () => {
  it.each([
    ["trader joe's greek yogurt", "Trader Joe's", 'greek yogurt'],
    ['Trader Joe’s mandarin orange chicken', "Trader Joe's", 'mandarin orange chicken'],
    ['trader joes hummus', "Trader Joe's", 'hummus'],
    ["TJ's everything bagel", "Trader Joe's", 'everything bagel'],
    ['hummus trader joes', "Trader Joe's", 'hummus'],
    ['kirkland almonds', 'Kirkland Signature', 'almonds'],
    ['costco rotisserie chicken', 'Kirkland Signature', 'rotisserie chicken'],
    ['whole foods market peanut butter', 'Whole Foods', 'peanut butter'],
    ['365 almond milk', 'Whole Foods', 'almond milk'],
    ["trader joe's", "Trader Joe's", ''],
  ])('%s → %s / %s', (q, brand, rest) => {
    const m = detectBrand(q)
    expect(m?.brand.name).toBe(brand)
    expect(m?.rest).toBe(rest)
  })

  it('ignores a brand name in the middle of a phrase, and ordinary foods', () => {
    expect(detectBrand('greek yogurt')).toBeNull()
    expect(detectBrand('bullseye target cookies')).toBeNull()
    expect(detectBrand('aldiana')).toBeNull() // whole words only
  })

  it('maps a store to every brand it sells under', () => {
    expect(detectBrand('whole foods oats')!.brand.tags).toEqual(
      ['365-everyday-value', 'whole-foods-market', '365-by-whole-foods-market'])
  })
})

describe('plainTerms', () => {
  it('strips search syntax so a query cannot change the filter', () => {
    expect(plainTerms('peanut (butter): "crunchy" OR brands_tags:x')).toBe('peanut butter crunchy or brands tags x')
    expect(plainTerms('-salted')).toBe('salted')
  })

  it('keeps apostrophes and hyphenated words', () => {
    expect(plainTerms("joe's semi-sweet")).toBe("joe's semi-sweet")
  })
})

describe('tidyBrand', () => {
  it('gives known brands one spelling', () => {
    expect(tidyBrand('Trader joe’s')).toBe("Trader Joe's")
    expect(tidyBrand('TRADER JOES')).toBe("Trader Joe's")
  })

  it('leaves other brands as printed, and blanks as nothing', () => {
    expect(tidyBrand('Chobani')).toBe('Chobani')
    expect(tidyBrand('Target')).toBe('Target')
    expect(tidyBrand('  ')).toBeUndefined()
  })
})

describe('tidyName', () => {
  it('removes the brand from the front or repeated at the end', () => {
    expect(tidyName('Trader Joe’s Mandarin Orange Chicken', "Trader Joe's")).toBe('Mandarin Orange Chicken')
    expect(tidyName("Spinach Dip - Trader Joe's - Trader Joe's - Trader Joe's", "Trader Joe's")).toBe('Spinach Dip')
    expect(tidyName('Trader Joes greek yogurt plain', "Trader Joe's")).toBe('Greek yogurt plain')
  })

  it('keeps the name when it is nothing but the brand', () => {
    expect(tidyName("Trader Joe's", "Trader Joe's")).toBe("Trader Joe's")
  })

  it('leaves names alone that merely contain the brand', () => {
    expect(tidyName("Joe's O's cereal", "Trader Joe's")).toBe("Joe's O's cereal")
  })
})

describe('store names vs brand names', () => {
  it('reads a store name in a query as its house brand', () => {
    expect(detectBrand('target granola')?.brand.name).toBe('Good & Gather')
    expect(detectBrand("sam's club water")?.brand.name).toBe("Member's Mark")
  })

  it('normalizes misspelled brands on labels, but not store names', () => {
    expect(tidyBrand('Trader joe')).toBe("Trader Joe's")
    expect(tidyBrand('Kirkland')).toBe('Kirkland Signature')
    expect(tidyBrand('Costco')).toBe('Costco')
    expect(tidyBrand('Target')).toBe('Target')
  })
})
