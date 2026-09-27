import { describe, it, expect, vi } from 'vitest'
import {
  TtlCache, fromOff, fromUsda, offNutrients, searchFoods, usdaNutrients, usdaPortions,
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
    expect(food.per100g.protein).toBe(9.41)
    expect(food.brand).toBe('Chobani')
  })

  it('keeps missing fiber as unknown, not zero', () => {
    expect(fromOff(OFF_YOGURT).per100g.fiber).toBeNull()
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
