import type { Food } from '../types.ts'
import { detectBrand } from './brands.ts'

const words = (s: string): string[] =>
  s.toLowerCase().replace(/[\u2018\u2019']/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)

/**
 * Your own foods whose name and brand contain every word typed. A store
 * brand in the query ("tjs hummus") matches that brand however it's written.
 */
export function matchMine(foods: Food[], query: string): Food[] {
  const brand = detectBrand(query)
  const want = words(brand ? brand.rest : query)
  if (!want.length && !brand) return []
  const seen = new Set<string>()
  return foods.filter((f) => {
    if (brand && detectBrand(f.brand ?? '')?.brand !== brand.brand) return false
    const have = words(brand ? f.name : `${f.name} ${f.brand ?? ''}`)
    const key = `${f.name}|${f.brand ?? ''}`.toLowerCase()
    if (seen.has(key) || !want.every((w) => have.some((h) => h.startsWith(w)))) return false
    seen.add(key)
    return true
  }).slice(0, 5)
}
