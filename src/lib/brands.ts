/**
 * Store brands, shared by the server (search) and the client (matching your
 * own foods), so "trader joe's greek yogurt" searches Trader Joe's products
 * for "greek yogurt" rather than every product whose text happens to mention
 * any of those words.
 *
 * Open Food Facts files each product under brand tags -- a slug of the brand
 * as printed -- and a store can sell under several (Whole Foods is both
 * "365 Everyday Value" and "Whole Foods Market"). Tags verified against the
 * live index; each has hundreds to thousands of products.
 */

export interface StoreBrand {
  name: string
  /** Ways the brand itself is written, lowercase, straight apostrophes. */
  aliases: string[]
  /** Stores whose name means this brand in a query -- but not on a label. */
  stores?: string[]
  tags: string[]
}

export const STORE_BRANDS: StoreBrand[] = [
  { name: "Trader Joe's", aliases: ["trader joe's", 'trader joes', 'trader joe', "tj's", 'tjs'], tags: ['trader-joe-s'] },
  { name: 'Kirkland Signature', aliases: ['kirkland signature', 'kirkland'], stores: ['costco'], tags: ['kirkland-signature'] },
  { name: 'Whole Foods', aliases: ['whole foods market', 'whole foods', '365 everyday value', '365 by whole foods', '365'], tags: ['365-everyday-value', 'whole-foods-market', '365-by-whole-foods-market'] },
  { name: 'Great Value', aliases: ['great value'], stores: ['walmart'], tags: ['great-value'] },
  { name: 'Good & Gather', aliases: ['good & gather', 'good and gather', 'good gather'], stores: ['target'], tags: ['good-gather', 'market-pantry'] },
  { name: 'Market Pantry', aliases: ['market pantry'], tags: ['market-pantry'] },
  { name: 'Kroger', aliases: ['kroger'], tags: ['kroger', 'simple-truth', 'private-selection'] },
  { name: 'Simple Truth', aliases: ['simple truth organic', 'simple truth'], tags: ['simple-truth', 'simple-truth-organic'] },
  { name: 'Private Selection', aliases: ['private selection'], tags: ['private-selection'] },
  { name: 'O Organics', aliases: ['o organics'], tags: ['o-organics'] },
  { name: 'Signature Select', aliases: ['signature select'], stores: ['safeway', 'albertsons'], tags: ['signature-select', 'o-organics'] },
  { name: 'Aldi', aliases: ['aldi'], tags: ['aldi', 'simply-nature'] },
  { name: 'Simply Nature', aliases: ['simply nature'], tags: ['simply-nature'] },
  { name: "Member's Mark", aliases: ["member's mark", 'members mark'], stores: ["sam's club", 'sams club'], tags: ['member-s-mark'] },
  { name: 'Happy Belly', aliases: ['happy belly'], tags: ['happy-belly'] },
  { name: 'Amazon Fresh', aliases: ['amazon fresh'], tags: ['amazon-fresh', 'happy-belly'] },
  { name: 'Wegmans', aliases: ['wegmans'], tags: ['wegmans'] },
  { name: 'H-E-B', aliases: ['h-e-b', 'heb'], tags: ['h-e-b'] },
  { name: 'Publix', aliases: ['publix'], tags: ['publix'] },
  { name: 'Meijer', aliases: ['meijer'], tags: ['meijer'] },
]

/** Lowercase, curly quotes straightened, whitespace collapsed. */
export const normalize = (s: string): string =>
  s.toLowerCase().replace(/[‘’ʼ`]/g, "'").replace(/\s+/g, ' ').trim()

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every alias, longest first, so "whole foods market" beats "whole foods".
const ALIASES = STORE_BRANDS
  .flatMap((brand) => [...brand.aliases, ...(brand.stores ?? [])].map((alias) => ({ alias, brand })))
  .sort((a, b) => b.alias.length - a.alias.length)

export interface BrandMatch {
  brand: StoreBrand
  /** The query with the brand taken out: what to search within the brand. */
  rest: string
}

/**
 * Find a store brand at the start or end of a query -- "tj's hummus",
 * "hummus trader joes" -- but not in the middle of a phrase, where a word
 * like "target" is more likely to be about something else.
 */
export function detectBrand(query: string): BrandMatch | null {
  const q = normalize(query)
  for (const { alias, brand } of ALIASES) {
    const a = escape(alias)
    const m = new RegExp(`^${a}(?:\\s+|$)|(?:^|\\s+)${a}$`).exec(q)
    if (m) return { brand, rest: (q.slice(0, m.index) + ' ' + q.slice(m.index + m[0].length)).trim() }
  }
  return null
}

/**
 * The search index parses queries as Lucene, where : ( ) " and friends are
 * syntax. Keep only what can be ordinary words.
 */
export const plainTerms = (s: string): string =>
  normalize(s).replace(/[^\p{L}\p{N}'\s-]/gu, ' ').replace(/(^|\s)-+|-+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim()

const spelling = (s: string): string => normalize(s).replace(/'/g, '')

/**
 * One spelling for a known brand -- "Trader joe's", "Trader Joe’s" and
 * "trader joes" all become "Trader Joe's". Anything else is left as printed.
 */
export function tidyBrand(brand: string | undefined): string | undefined {
  if (!brand?.trim()) return undefined
  const b = spelling(brand)
  const known = STORE_BRANDS.find((s) => spelling(s.name) === b || s.aliases.some((a) => spelling(a) === b))
  return known ? known.name : brand.replace(/[\u2018\u2019]/g, "'").trim()
}

/**
 * Crowd-sourced names often repeat the brand: "Trader Joe's Mandarin Orange
 * Chicken", "Spinach Dip - Trader Joe's - Trader Joe's". The brand is shown
 * separately, so take it out of the name -- unless nothing would be left.
 */
export function tidyName(name: string, brand: string | undefined): string {
  let out = name.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
  if (!brand) return out
  // Matches the brand however it's spelled: any apostrophe optional, any run
  // of spaces allowed. "Trader Joes" and "Trader Joe's" both match.
  const b = [...spelling(brand)].map((c) => (c === ' ' ? '\\s+' : escape(c))).join("['\u2019]?")
  const suffix = new RegExp(`(\\s*[-–|,]\\s*${b})+$`, 'i')
  const prefix = new RegExp(`^${b}(\\s*[-–|:,]\\s*|\\s+)`, 'i')
  const stripped = out.replace(suffix, '').replace(prefix, '').trim()
  if (stripped) out = stripped
  return out.charAt(0).toUpperCase() + out.slice(1)
}
