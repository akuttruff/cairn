import { NUTRIENTS } from '../src/types.ts'
import type { Food, Nutrients, Serving } from '../src/types.ts'
import { detectBrand, plainTerms, tidyBrand, tidyName } from '../src/lib/brands.ts'

/**
 * Food search across two public databases, normalised to one shape.
 *
 *  - USDA FoodData Central (Foundation + SR Legacy): the reference for whole
 *    foods, with complete nutrient panels including fiber. Its search ranking
 *    is mediocre and the free demo key allows 30 requests an hour.
 *  - Open Food Facts: packaged and branded products. Broad, but crowd-sourced:
 *    many entries carry no nutrition at all, and fiber is often absent.
 *
 * A query naming a store brand ("trader joe's hummus") searches only that
 * brand's products, and a barcode looks up that one product; neither goes to
 * USDA, which has nothing useful for them.
 *
 * Results without calories are dropped -- they cannot be logged usefully --
 * but a missing fiber value is kept as null, never coerced to zero.
 */

const USER_AGENT = 'macros/0.1 (personal food log)'
const TIMEOUT_MS = 8000

const empty = (): Nutrients =>
  ({ calories: null, protein: null, fat: null, carbs: null, fiber: null })

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

const round2 = (n: number | null): number | null =>
  n == null ? null : Math.round(n * 100) / 100

/**
 * A nutrient value, to two places, within the bounds the store accepts
 * (cleanNutrients): crowd-sourced entries carry the odd negative or absurd
 * number, which is better shown as unknown than refused on Add.
 */
const nutrient = (n: number | null): number | null => {
  const v = round2(n)
  return v != null && v >= 0 && v < 100_000 ? v : null
}

// ---------------------------------------------------------------------------
// USDA
// ---------------------------------------------------------------------------

/**
 * USDA reports nutrients by id; Foundation foods use a different energy id
 * (Atwater) from SR Legacy, and some responses carry only the legacy
 * "nutrientNumber" string. Each key lists every id that can carry it, in
 * order of preference.
 */
const USDA_IDS: Record<keyof Nutrients, { ids: number[]; numbers: string[] }> = {
  calories: { ids: [1008, 2047, 2048], numbers: ['208', '957', '958'] },
  protein: { ids: [1003], numbers: ['203'] },
  fat: { ids: [1004], numbers: ['204'] },
  carbs: { ids: [1005], numbers: ['205'] },
  fiber: { ids: [1079], numbers: ['291'] },
}

interface UsdaNutrient {
  nutrientId?: number
  nutrientNumber?: string
  value?: number
  unitName?: string
}

interface UsdaFood {
  fdcId: number
  description: string
  dataType?: string
  brandOwner?: string
  foodNutrients?: UsdaNutrient[]
}

export function usdaNutrients(list: UsdaNutrient[] = []): Nutrients {
  const out = empty()
  for (const key of NUTRIENTS) {
    const { ids, numbers } = USDA_IDS[key]
    for (let i = 0; i < ids.length && out[key] == null; i += 1) {
      const hit = list.find((n) => n.nutrientId === ids[i] || n.nutrientNumber === numbers[i])
      if (!hit) continue
      let v = num(hit.value)
      // Energy occasionally arrives in kJ only.
      if (key === 'calories' && v != null && hit.unitName?.toLowerCase() === 'kj') v /= 4.184
      out[key] = nutrient(v)
    }
  }
  return out
}

export function fromUsda(food: UsdaFood): Food {
  return {
    id: `usda:${food.fdcId}`,
    name: food.description,
    brand: food.brandOwner || undefined,
    source: 'usda',
    sourceId: String(food.fdcId),
    per100g: usdaNutrients(food.foodNutrients),
  }
}

// ---------------------------------------------------------------------------
// Open Food Facts
// ---------------------------------------------------------------------------

interface OffProduct {
  code?: string
  product_name?: string
  brands?: string | string[]
  serving_size?: string
  serving_quantity?: number | string
  nutriments?: Record<string, unknown>
}

export function offNutrients(n: Record<string, unknown> = {}): Nutrients {
  let calories = num(n['energy-kcal_100g'])
  const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g'])
  if (calories == null && kj != null) calories = kj / 4.184
  return {
    calories: nutrient(calories),
    protein: nutrient(num(n['proteins_100g'])),
    fat: nutrient(num(n['fat_100g'])),
    carbs: nutrient(num(n['carbohydrates_100g'])),
    fiber: nutrient(num(n['fiber_100g'])),
  }
}

export function fromOff(p: OffProduct): Food {
  const brand = tidyBrand(Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0])
  const grams = Number(p.serving_quantity)
  const servings: Serving[] = Number.isFinite(grams) && grams > 0
    ? [{ label: p.serving_size?.trim() || `${grams} g`, grams }]
    : []
  return {
    id: `off:${p.code ?? p.product_name}`,
    name: tidyName(p.product_name || 'Unnamed product', brand),
    brand,
    source: 'off',
    sourceId: p.code,
    per100g: offNutrients(p.nutriments),
    servings: servings.length ? servings : undefined,
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchResult {
  usda: Food[]
  off: Food[]
  /** Per-source failures, so one database being down does not hide the other. */
  errors: { source: 'usda' | 'off'; message: string }[]
  /** Set when the query named a store brand and results are that brand's. */
  brand?: string
  /** Set when the query was a barcode. */
  barcode?: boolean
}

const usable = (f: Food): boolean => f.per100g?.calories != null

async function getJson(url: string, fetchImpl: typeof fetch, limited = 'rate limited; try again shortly'): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 429) throw new Error(limited)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

const USDA_LIMITED = 'rate limited; add a free USDA API key in Settings'

export async function searchUsda(query: string, apiKey: string, fetchImpl = fetch): Promise<Food[]> {
  const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
    + `?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}`
    + `&query=${encodeURIComponent(query)}`
    + '&dataType=Foundation,SR%20Legacy&pageSize=15'
  const data = await getJson(url, fetchImpl, USDA_LIMITED) as { foods?: UsdaFood[] }
  return (data.foods ?? []).map(fromUsda).filter(usable)
}

const OFF_FIELDS = 'code,product_name,brands,serving_size,serving_quantity,nutriments'

/** The same product is often entered twice, e.g. with and without leading zeros on the barcode. */
function dedupe(foods: Food[]): Food[] {
  const seen = new Set<string>()
  return foods.filter((f) => {
    const keys = [
      f.sourceId ? `code:${f.sourceId.replace(/^0+/, '')}` : null,
      `name:${f.name.toLowerCase()}|${(f.brand ?? '').toLowerCase()}|${Math.round(f.per100g?.calories ?? -1)}`,
    ].filter((k): k is string => k != null)
    if (keys.some((k) => seen.has(k))) return false
    for (const k of keys) seen.add(k)
    return true
  })
}

async function offQuery(q: string, fetchImpl: typeof fetch): Promise<Food[]> {
  const url = 'https://search.openfoodfacts.org/search'
    + `?q=${encodeURIComponent(q)}&page_size=24&fields=${OFF_FIELDS}`
  const data = await getJson(url, fetchImpl) as { hits?: OffProduct[] }
  return dedupe((data.hits ?? []).filter((p) => p.product_name).map(fromOff).filter(usable)).slice(0, 15)
}

/**
 * Packaged foods. A store brand in the query becomes a filter on that
 * brand's products; if that finds nothing, fall back to searching the words.
 */
export async function searchOff(query: string, fetchImpl = fetch): Promise<Food[]> {
  const match = detectBrand(query)
  if (match) {
    const filter = match.brand.tags.map((t) => `brands_tags:"${t}"`).join(' OR ')
    const rest = plainTerms(match.rest)
    const hits = await offQuery(rest ? `(${filter}) ${rest}` : `(${filter})`, fetchImpl)
    if (hits.length || !rest) return hits
  }
  return offQuery(plainTerms(query), fetchImpl)
}

export const isBarcode = (q: string): boolean => /^\d{8,14}$/.test(q.replace(/[\s-]/g, ''))

/** One product by the number under its barcode (UPC or EAN). */
export async function lookupBarcode(code: string, fetchImpl = fetch): Promise<Food[]> {
  const digits = code.replace(/[\s-]/g, '')
  if (!/^\d{8,14}$/.test(digits)) return []
  const url = `https://world.openfoodfacts.org/api/v2/product/${digits}?fields=${OFF_FIELDS}`
  const data = await getJson(url, fetchImpl) as { status?: number; product?: OffProduct }
  // Unknown codes still come back "found", as an empty shell.
  if (data.status !== 1 || !data.product?.product_name) return []
  return [fromOff({ ...data.product, code: data.product.code || digits })].filter(usable)
}

/** USDA portion sizes -- "1 medium", "1 cup, sliced" -- fetched on demand. */
export async function usdaPortions(fdcId: string, apiKey: string, fetchImpl = fetch): Promise<Serving[]> {
  if (!/^\d+$/.test(fdcId)) return []
  const url = `https://api.nal.usda.gov/fdc/v1/food/${fdcId}`
    + `?api_key=${encodeURIComponent(apiKey || 'DEMO_KEY')}`
  const data = await getJson(url, fetchImpl, USDA_LIMITED) as {
    foodPortions?: { gramWeight?: number; amount?: number; modifier?: string; portionDescription?: string; measureUnit?: { name?: string } }[]
  }
  const out: Serving[] = []
  for (const p of data.foodPortions ?? []) {
    const grams = num(p.gramWeight)
    if (grams == null || grams <= 0) continue
    const unit = p.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : ''
    const label = (p.portionDescription && p.portionDescription !== 'Quantity not specified')
      ? p.portionDescription
      : [p.amount, unit, p.modifier].filter(Boolean).join(' ')
    if (label) out.push({ label: label.trim(), grams: Math.round(grams * 10) / 10 })
  }
  return out
}

/**
 * Remembers results for a day. Food data barely changes, the same searches
 * recur constantly, and the USDA demo key allows only 30 requests an hour.
 */
export class TtlCache<T> {
  private map = new Map<string, { at: number; value: T }>()
  private ttlMs: number
  private max: number
  private now: () => number

  // Plain assignments rather than parameter properties: those need a
  // transform, and Node's type stripping would refuse this module.
  constructor(ttlMs: number, max = 500, now: () => number = () => Date.now()) {
    this.ttlMs = ttlMs
    this.max = max
    this.now = now
  }

  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: T): void {
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, { at: this.now(), value })
  }
}

export async function searchFoods(
  query: string,
  apiKey: string,
  cache: TtlCache<SearchResult>,
  fetchImpl = fetch,
): Promise<SearchResult> {
  const q = query.trim().toLowerCase()
  const cached = cache.get(q)
  if (cached) return cached

  const brand = detectBrand(q)?.brand.name
  const barcode = isBarcode(q)
  // Only generic food words go to USDA: it has no store brands or barcodes,
  // and the demo key's hourly allowance is too small to spend on them.
  const skipUsda = brand != null || barcode
  const [usda, off] = await Promise.allSettled([
    skipUsda ? Promise.resolve([]) : searchUsda(q, apiKey, fetchImpl),
    barcode ? lookupBarcode(q, fetchImpl) : searchOff(q, fetchImpl),
  ])
  const result: SearchResult = { usda: [], off: [], errors: [] }
  if (brand) result.brand = brand
  if (barcode) result.barcode = true
  if (usda.status === 'fulfilled') result.usda = usda.value
  else result.errors.push({ source: 'usda', message: String((usda.reason as Error)?.message ?? usda.reason) })
  if (off.status === 'fulfilled') result.off = off.value
  else result.errors.push({ source: 'off', message: String((off.reason as Error)?.message ?? off.reason) })

  // Only cache a complete answer; a failure should be retried next time.
  if (!result.errors.length) cache.set(q, result)
  return result
}
