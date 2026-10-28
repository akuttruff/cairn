import type { Equipment, Wod, WodFocus, WodPart, WodSlot, WodView } from '../../types.ts'
import { MOVEMENT } from './movements.ts'
import type { Movement, Sub } from './movements.ts'
import { WOD_BANK } from './wods.ts'

/**
 * Fitting the WOD bank to a home gym: each movement is kept, or swapped
 * along its substitution chain for something the gear (and the impact rule)
 * allows, and dumbbell weights snap to the pairs that exist. A WOD with a
 * movement that can't be done or swapped isn't offered at all.
 */

interface Placed {
  move: Movement
  amount?: number
  weight?: number
  /** The movement as written, when it had to be swapped. */
  from?: { move: Movement; amount?: number; weight?: number }
  /** The weight was picked here (a swap onto dumbbells), not written in the WOD. */
  defaulted?: boolean
  /** How far the stand-ins stray from what was written (0 when it's done as written). */
  cost: number
}

const has = (equipment: Pick<Equipment, 'gear'>, m: Movement): boolean =>
  m.needs.length === 0 || m.needs.some((set) => set.every((g) => equipment.gear.includes(g)))

/** The nearest weight there is to the one asked for, or the one asked for when the list says nothing. */
export function snapWeight(want: number, available: number[]): number {
  if (!available.length) return want
  return available.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), available[0]!)
}

const subsOf = (m: Movement): Sub[] => (m.sub ? (Array.isArray(m.sub) ? m.sub : [m.sub]) : [])

/** The movement as the gear allows: itself, or the closest stand-in down its substitutions that can be done. */
function standIn(move: Movement, amount: number | undefined, weight: number | undefined, equipment: Pick<Equipment, 'gear'>, lowImpact: boolean, seen: Set<string>, cost = 0):
  { move: Movement; amount?: number; weight?: number; cost: number } | null {
  if (has(equipment, move) && !(lowImpact && move.impact)) return { move, amount, weight, cost }
  if (seen.size > 4) return null
  let best: { move: Movement; amount?: number; weight?: number; cost: number } | null = null
  for (const s of subsOf(move)) {
    const next = MOVEMENT.get(s.to)
    if (!next || seen.has(next.id)) continue
    const a = amount === undefined ? undefined : Math.max(1, Math.round(amount * s.factor))
    // Between barbell and bells: a barbell's total is about a third in each hand, and a pair of bells about 2.5 times one
    // of them on the bar (2×20 lb thrusters become 50 lb); a bodyweight stand-in carries none.
    const toBar = next.needs.some((set) => set.includes('barbell'))
    const w = weight === undefined ? undefined
      : next.bells ? (move.bells ? weight : weight * 0.3)
      : toBar && move.bells ? Math.max(45, Math.round((weight * 2.5) / 5) * 5)
      : toBar ? weight : undefined
    const found = standIn(next, a, w, equipment, lowImpact, new Set([...seen, next.id]), cost + (s.cost ?? 3))
    // The cheapest route, not the first: bike to jump rope directly, rather than by way of a rower there isn't.
    if (found && (!best || found.cost < best.cost)) best = found
  }
  return best
}

function place(part: WodPart, equipment: Pick<Equipment, 'gear' | 'dumbbells' | 'kettlebells'>, lowImpact: boolean): Placed | null {
  const original = MOVEMENT.get(part.move)
  if (!original) return null
  const found = standIn(original, part.amount, part.weight, equipment, lowImpact, new Set([original.id]))
  if (!found) return null
  const move = found.move
  const amount = found.amount
  let weight = found.weight
  if (weight !== undefined && move.bells) weight = snapWeight(weight, equipment[move.bells])
  // A bodyweight movement swapped for a loaded one takes the middle pair there is.
  let defaulted = false
  if (weight === undefined && move.bells && move !== original && equipment[move.bells].length) {
    const pairs = equipment[move.bells]
    weight = pairs[Math.floor((pairs.length - 1) / 2)]
    defaulted = true
  }
  const placed: Placed = { move, cost: found.cost, ...(amount !== undefined ? { amount } : {}), ...(weight !== undefined ? { weight: Math.round(weight) } : {}), ...(defaulted ? { defaulted } : {}) }
  if (move !== original) placed.from = { move: original, amount: part.amount, weight: part.weight }
  return placed
}

function line(m: Movement, amount?: number, weight?: number): string {
  const count = amount === undefined ? '' : m.unit === 's' ? `${amount} s ` : m.unit === 'm' ? `${amount} ` : `${amount} `
  const load = weight === undefined ? '' : m.bells ? ` (2×${weight} lb)` : ` @ ${weight} lb`
  return `${count}${m.name}${load}`.trim()
}

function heading(wod: Wod): string {
  switch (wod.format) {
    case 'rft': return `${wod.rounds ?? 1} rounds for time`
    case 'amrap': return `${wod.minutes}-min AMRAP`
    case 'emom': return wod.parts.length > 1 ? `EMOM ${wod.minutes} min, rotating` : `EMOM ${wod.minutes} min`
    case 'ladder': return `${(wod.scheme ?? []).join('-')} for time`
    case 'chipper': return 'For time'
    case 'intervals': return wod.text ?? 'Intervals'
  }
}

/**
 * The WOD as it would be done with this gear, or null if it can't be. With
 * the gear in more than one place, it has to be done in one of them -- the
 * one needing the fewest swaps -- and says which.
 */
export function viewWod(wod: Wod, equipment: Equipment, lowImpact = false): WodView | null {
  if (!equipment.places?.length) return viewIn(wod, equipment, lowImpact)?.view ?? null
  let best: { view: WodView; cost: number } | null = null
  for (const place of equipment.places) {
    const found = viewIn(wod, place, lowImpact)
    if (found && (!best || found.cost < best.cost)) best = { view: { ...found.view, place: place.name }, cost: found.cost }
  }
  return best?.view ?? null
}

/** The WOD done with this gear, and what that cost: swapping cardio for cardio is cheap, swapping the rest isn't. */
function viewIn(wod: Wod, equipment: Pick<Equipment, 'gear' | 'dumbbells' | 'kettlebells'>, lowImpact: boolean): { view: WodView; cost: number } | null {
  const placed: Placed[] = []
  // Said before any merging, so each reads as the swap it was.
  const swaps: string[] = []
  for (const part of wod.parts) {
    const p = place(part, equipment, lowImpact)
    if (!p) return null
    if (p.from) swaps.push(`${line(p.move, p.amount, p.weight)} in place of ${line(p.from.move, p.from.amount, p.from.weight)}`)
    // A swap that lands on the movement just before it (ring rows next to DB rows) becomes one bigger line.
    const prev = placed[placed.length - 1]
    if (prev && prev.move === p.move && (prev.weight === p.weight || prev.defaulted || p.defaulted)) {
      if (prev.amount !== undefined && p.amount !== undefined) prev.amount += p.amount
      if (prev.defaulted && !p.defaulted) { prev.weight = p.weight; prev.defaulted = false }
      continue
    }
    placed.push(p)
  }
  const focus = [...new Set(placed.map((p) => p.move.focus))] as WodFocus[]
  const cost = placed.reduce((sum, p) => sum + p.cost, 0)
  const view: WodView = {
    id: wod.id,
    name: wod.name,
    minutes: wod.minutes,
    heading: heading(wod),
    lines: [...placed.map((p) => line(p.move, p.amount, p.weight)), ...(wod.notes ? [wod.notes] : [])],
    swaps,
    focus,
  }
  return { view, cost }
}

export function fitsSlot(view: WodView, slot: WodSlot): boolean {
  if (view.minutes > slot.maxMinutes || view.minutes < (slot.minMinutes ?? 0)) return false
  if (!slot.focus?.length) return true
  return view.focus.every((f) => f === 'core' || slot.focus!.includes(f))
}

/** Every WOD (the bank, plus any the schema wrote, less any it hid) that fits the slot with this gear. */
export function fittingWods(slot: WodSlot, equipment: Equipment, extra: Wod[] = [], hidden: string[] = []): WodView[] {
  const out: WodView[] = []
  for (const wod of [...extra, ...WOD_BANK]) {
    if (hidden.includes(wod.id)) continue
    const view = viewWod(wod, equipment, slot.lowImpact)
    if (view && fitsSlot(view, slot)) out.push(view)
  }
  return out
}

/** A stable shuffle: the same seed (the date) gives the same picks until Shuffle moves it on. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * A few WODs for a slot, leaving out the ones done recently (unless that
 * leaves nothing). `seed` keeps the choice steady for a day.
 */
export function pickWods(slot: WodSlot, equipment: Equipment, options: { recent?: string[]; seed: string; extra?: Wod[]; hidden?: string[]; count?: number }): WodView[] {
  const all = fittingWods(slot, equipment, options.extra, options.hidden)
  const fresh = all.filter((w) => !options.recent?.includes(w.id))
  const pool = fresh.length ? fresh : all
  return [...pool].sort((a, b) => hash(options.seed + a.id) - hash(options.seed + b.id)).slice(0, options.count ?? 3)
}

/** Any WOD by id, from the schema's own or the bank. */
export function findWod(id: string, extra: Wod[] = []): Wod | undefined {
  return extra.find((w) => w.id === id) ?? WOD_BANK.find((w) => w.id === id)
}
