import { describe, it, expect, vi } from 'vitest'
import {
  TtlCache, fromOff, fromUsda, isBarcode, lookupBarcode, offNutrients, searchFoods, searchOff, usdaNutrients, usdaPortions,
} from './foods.ts'
import type { SearchResult } from './foods.ts'

// Shapes observed from the live APIs.
const USDA_BANANA = {
  fdcId: 173944,
  description: 'Bananas, raw',
  dataType: 'SR Legacy',
  foodNutrients: [
    { nutrientId: 1008, value: 89, unitName: 'KCAL' },
    { nutrientId: 1003, value: 1.09, unitName: 'G' },
    { nutrientId: 1004, value: 0.33, unitName: 'G' },
    { nutrientId: 1005, value: 22.84, unitName: 'G' },
    { nutrientId: 1079, value: 2.6, unitName: 'G' },
  ],
}

const OFF_YOGURT = {
  code: '0818290011121',
  product_name: 'Nonfat Greek Yogurt',
  brands: ['Chobani'],
  serving_size: '1 container (150 g)',
  serving_quantity: 150,
  nutriments: {
    'energy-kcal_100g': 52.9, proteins_100g: 9.41, fat_100g: 0, carbohydrates_100g: 3.53,
    // no fiber_100g: the database simply does not say
  },
}

const OFF_EMPTY = { code: '1', product_name: 'Fresh Banana', nutriments: {} }

function fakeFetch(routes: Record<string, unknown>) {
  return vi.fn<(url: string) => Promise<unknown>>(async (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k))
    if (!key) return { ok: false, status: 404, json: async () => ({}) }
    const body = routes[key]
    if (body instanceof Error) throw body
    if (typeof body === 'number') return { ok: false, status: body, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  }) as unknown as typeof fetch
}

describe('USDA normalisation', () => {
  it('reads a full nutrient panel', () => {
    expect(fromUsda(USDA_BANANA).per100g).toEqual({
      calories: 89, protein: 1.09, fat: 0.33, carbs: 22.84, fiber: 2.6,
    })
  })

  it('finds energy under the Foundation (Atwater) id too', () => {
    expect(usdaNutrients([{ nutrientId: 2047, value: 120 }]).calories).toBe(120)
  })

  it('falls back to the legacy nutrient number', () => {
    expect(usdaNutrients([{ nutrientNumber: '203', value: 31 }]).protein).toBe(31)
  })

  it('converts kilojoules', () => {
    expect(usdaNutrients([{ nutrientId: 1008, value: 418.4, unitName: 'kJ' }]).calories).toBe(100)
  })

  it('keeps a stable id tied to the source', () => {
    const food = fromUsda(USDA_BANANA)
    expect(food.id).toBe('usda:173944')
    expect(food.source).toBe('usda')
  })
})

describe('Open Food Facts normalisation', () => {
  it('reads per-100g values', () => {
    const food = fromOff(OFF_YOGURT)
    expect(food.per100g!.protein).toBe(9.41)
    expect(food.brand).toBe('Chobani')
  })

  it('keeps missing fiber as unknown, not zero', () => {
    expect(fromOff(OFF_YOGURT).per100g!.fiber).toBeNull()
  })

  it('offers the labelled serving', () => {
    expect(fromOff(OFF_YOGURT).servings).toEqual([{ label: '1 container (150 g)', grams: 150 }])
  })

  it('converts kilojoules when kcal is absent', () => {
    expect(offNutrients({ 'energy-kj_100g': 836.8 }).calories).toBe(200)
  })

  it('reads a comma-separated brand string', () => {
    expect(fromOff({ ...OFF_YOGURT, brands: 'Fage, Total' }).brand).toBe('Fage')
  })
})

describe('searchFoods', () => {
  const routes = {
    'api.nal.usda.gov': { foods: [USDA_BANANA] },
    'search.openfoodfacts.org': { hits: [OFF_YOGURT, OFF_EMPTY] },
  }

  it('returns both sources, separately', async () => {
    const r = await searchFoods('banana', 'KEY', new TtlCache(60_000), fakeFetch(routes))
    expect(r.usda.map((f) => f.name)).toEqual(['Bananas, raw'])
    expect(r.errors).toEqual([])
  })

  it('drops products that carry no calories', async () => {
    // Half the live results for "banana" had no nutrition at all.
    const r = await searchFoods('banana', 'KEY', new TtlCache(60_000), fakeFetch(routes))
    expect(r.off.map((f) => f.name)).toEqual(['Nonfat Greek Yogurt'])
  })

  it('still answers when one source is down', async () => {
    const f = fakeFetch({ ...routes, 'api.nal.usda.gov': new TypeError('fetch failed') })
    const r = await searchFoods('banana', 'KEY', new TtlCache(60_000), f)
    expect(r.off).toHaveLength(1)
    expect(r.errors).toEqual([{ source: 'usda', message: 'fetch failed' }])
  })

  it('explains a rate limit rather than failing vaguely', async () => {
    const f = fakeFetch({ ...routes, 'api.nal.usda.gov': 429 })
    const r = await searchFoods('banana', 'DEMO_KEY', new TtlCache(60_000), f)
    expect(r.errors[0]!.message).toMatch(/USDA API key/)
  })

  it('serves a repeat search from cache', async () => {
    const f = fakeFetch(routes)
    const cache = new TtlCache<SearchResult>(60_000)
    await searchFoods('Banana ', 'KEY', cache, f)
    await searchFoods('banana', 'KEY', cache, f)
    expect(f).toHaveBeenCalledTimes(2) // once per source, not four times
  })

  it('does not cache a partial failure', async () => {
    const f = fakeFetch({ ...routes, 'api.nal.usda.gov': 500 })
    const cache = new TtlCache<SearchResult>(60_000)
    await searchFoods('banana', 'KEY', cache, f)
    expect(cache.get('banana')).toBeUndefined()
  })

  it('sends the API key and a User-Agent', async () => {
    const f = fakeFetch(routes)
    await searchFoods('banana', 'MYKEY', new TtlCache(60_000), f)
    const calls = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls
    const usda = calls.find(([u]) => u.includes('nal.usda.gov'))!
    expect(usda[0]).toContain('api_key=MYKEY')
    expect((usda[1].headers as Record<string, string>)['User-Agent']).toMatch(/macros/)
  })
})

describe('usdaPortions', () => {
  it('turns portions into labelled gram weights', async () => {
    const f = fakeFetch({
      'food/173944': {
        foodPortions: [
          { gramWeight: 118, amount: 1, modifier: 'medium (7" to 7-7/8" long)', measureUnit: { name: 'undetermined' } },
          { gramWeight: 150, amount: 1, modifier: 'sliced', measureUnit: { name: 'cup' } },
          { gramWeight: 0, amount: 1, modifier: 'nothing' },
        ],
      },
    })
    expect(await usdaPortions('173944', 'KEY', f)).toEqual([
      { label: '1 medium (7" to 7-7/8" long)', grams: 118 },
      { label: '1 cup sliced', grams: 150 },
    ])
  })

  it('refuses a malformed id rather than building a URL from it', async () => {
    const f = fakeFetch({})
    expect(await usdaPortions('../../x', 'KEY', f)).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('TtlCache', () => {
  it('expires entries', () => {
    let now = 0
    const cache = new TtlCache<number>(1000, 10, () => now)
    cache.set('a', 1)
    now = 999
    expect(cache.get('a')).toBe(1)
    now = 1001
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the oldest when full', () => {
    const cache = new TtlCache<number>(60_000, 2)
    cache.set('a', 1); cache.set('b', 2); cache.set('c', 3)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })
})

const TJ_CHICKEN = {
  code: '0400233893323',
  product_name: 'Trader Joe\u2019s Mandarin Orange Chicken',
  brands: 'Trader joe\u2019s',
  serving_size: '140.0g',
  serving_quantity: 140,
  nutriments: { 'energy-kcal_100g': 228.6, proteins_100g: 15, fat_100g: 11.4, carbohydrates_100g: 17.1, fiber_100g: 0.7 },
}

/** Answers OFF searches by the decoded `q`, so tests can see what was asked. */
function offByQuery(answer: (q: string) => unknown) {
  return vi.fn<(url: string) => Promise<unknown>>(async (url) => {
    const q = new URL(url).searchParams.get('q') ?? ''
    return { ok: true, status: 200, json: async () => answer(q) }
  }) as unknown as typeof fetch & { mock: { calls: [string][] } }
}

describe('store brands', () => {
  it('searches only that brand for the rest of the words', async () => {
    const f = offByQuery(() => ({ hits: [TJ_CHICKEN] }))
    const foods = await searchOff("Trader Joe's mandarin orange chicken", f)
    expect(new URL(f.mock.calls[0]![0]).searchParams.get('q'))
      .toBe('(brands_tags:"trader-joe-s") mandarin orange chicken')
    expect(foods[0]).toMatchObject({ name: 'Mandarin Orange Chicken', brand: "Trader Joe's" })
    expect(foods[0]!.servings).toEqual([{ label: '140.0g', grams: 140 }])
  })

  it('falls back to a plain search when the brand has no match', async () => {
    const f = offByQuery((q) => (q.startsWith('(') ? { hits: [] } : { hits: [TJ_CHICKEN] }))
    const foods = await searchOff('tjs orange chicken', f)
    expect(f.mock.calls).toHaveLength(2)
    expect(new URL(f.mock.calls[1]![0]).searchParams.get('q')).toBe('tjs orange chicken')
    expect(foods).toHaveLength(1)
  })

  it('cannot be steered by search syntax typed into the box', async () => {
    const f = offByQuery(() => ({ hits: [] }))
    await searchOff('chicken) OR (brands_tags:"x"', f)
    expect(new URL(f.mock.calls[0]![0]).searchParams.get('q')).toBe('chicken or brands tags x')
  })

  it('drops duplicate entries of one product', async () => {
    const f = offByQuery(() => ({ hits: [TJ_CHICKEN, { ...TJ_CHICKEN, code: '400233893323' }, { ...TJ_CHICKEN, code: '999' }] }))
    expect(await searchOff('trader joes orange chicken', f)).toHaveLength(1)
  })

  it('skips USDA for a brand search, sparing its hourly allowance', async () => {
    const f = fakeFetch({ 'search.openfoodfacts.org': { hits: [TJ_CHICKEN] } })
    const r = await searchFoods("trader joe's orange chicken", 'DEMO_KEY', new TtlCache(60_000), f)
    const calls = (f as unknown as { mock: { calls: [string][] } }).mock.calls
    expect(calls.some(([u]) => u.includes('nal.usda.gov'))).toBe(false)
    expect(r).toMatchObject({ brand: "Trader Joe's", usda: [], errors: [] })
    expect(r.off).toHaveLength(1)
  })
})

describe('barcodes', () => {
  it('recognises UPC and EAN numbers', () => {
    expect(isBarcode('0400233893323')).toBe(true)
    expect(isBarcode('04002 33893')).toBe(true)
    expect(isBarcode('1234567')).toBe(false)
    expect(isBarcode('7 up')).toBe(false)
  })

  it('looks up one product by its code', async () => {
    const f = fakeFetch({ 'world.openfoodfacts.org/api/v2/product/0400233893323': { status: 1, product: TJ_CHICKEN } })
    const foods = await lookupBarcode('0400233893323', f)
    expect(foods).toHaveLength(1)
    expect(foods[0]!.id).toBe('off:0400233893323')
  })

  it('treats the empty shell returned for an unknown code as no product', async () => {
    const f = fakeFetch({ 'world.openfoodfacts.org': { status: 1, product: { code: '1234567890123' } } })
    expect(await lookupBarcode('1234567890123', f)).toEqual([])
  })

  it('routes a barcode search to the lookup, not USDA', async () => {
    const f = fakeFetch({ 'world.openfoodfacts.org': { status: 1, product: TJ_CHICKEN } })
    const r = await searchFoods('0400233893323', 'KEY', new TtlCache(60_000), f)
    expect(r.barcode).toBe(true)
    expect(r.off[0]!.name).toBe('Mandarin Orange Chicken')
    const calls = (f as unknown as { mock: { calls: [string][] } }).mock.calls
    expect(calls).toHaveLength(1)
  })
})
