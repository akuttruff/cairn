import type { Equipment, Wod, WodFocus, WodPart, WodSlot, WodView } from '../../types.ts'
import { MOVEMENT } from './movements.ts'
import type { Movement } from './movements.ts'
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
}

const has = (equipment: Equipment, m: Movement): boolean =>
  m.needs.length === 0 || m.needs.some((set) => set.every((g) => equipment.gear.includes(g)))

/** The nearest weight there is to the one asked for, or the one asked for when the list says nothing. */
export function snapWeight(want: number, available: number[]): number {
  if (!available.length) return want
  return available.reduce((best, w) => (Math.abs(w - want) < Math.abs(best - want) ? w : best), available[0]!)
}

function place(part: WodPart, equipment: Equipment, lowImpact: boolean): Placed | null {
  let move = MOVEMENT.get(part.move)
  if (!move) return null
  const original = move
  let amount = part.amount
  let weight = part.weight
  for (let hops = 0; !has(equipment, move) || (lowImpact && move.impact); hops++) {
    if (!move.sub || hops >= 4) return null
    const next = MOVEMENT.get(move.sub.to)
    if (!next) return null
    if (amount !== undefined) amount = Math.max(1, Math.round(amount * move.sub.factor))
    // A barbell's total becomes about a third of it in each hand; a bodyweight stand-in carries none.
    if (weight !== undefined) weight = next.bells ? (move.bells ? weight : weight * 0.3) : undefined
    move = next
  }
  if (weight !== undefined && move.bells) weight = snapWeight(weight, equipment[move.bells])
  // A bodyweight movement swapped for a loaded one takes the middle pair there is.
  let defaulted = false
  if (weight === undefined && move.bells && move !== original && equipment[move.bells].length) {
    const pairs = equipment[move.bells]
    weight = pairs[Math.floor((pairs.length - 1) / 2)]
    defaulted = true
  }
  const placed: Placed = { move, ...(amount !== undefined ? { amount } : {}), ...(weight !== undefined ? { weight: Math.round(weight) } : {}), ...(defaulted ? { defaulted } : {}) }
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

/** The WOD as it would be done with this gear, or null if it can't be. */
export function viewWod(wod: Wod, equipment: Equipment, lowImpact = false): WodView | null {
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
  return {
    id: wod.id,
    name: wod.name,
    minutes: wod.minutes,
    heading: heading(wod),
    lines: [...placed.map((p) => line(p.move, p.amount, p.weight)), ...(wod.notes ? [wod.notes] : [])],
    swaps,
    focus,
  }
}

export function fitsSlot(view: WodView, slot: WodSlot): boolean {
  if (view.minutes > slot.maxMinutes || view.minutes < (slot.minMinutes ?? 0)) return false
  if (!slot.focus?.length) return true
  return view.focus.every((f) => f === 'core' || slot.focus!.includes(f))
}

/** Every WOD (the bank, plus any the schema wrote) that fits the slot with this gear. */
export function fittingWods(slot: WodSlot, equipment: Equipment, extra: Wod[] = []): WodView[] {
  const out: WodView[] = []
  for (const wod of [...extra, ...WOD_BANK]) {
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
export function pickWods(slot: WodSlot, equipment: Equipment, options: { recent?: string[]; seed: string; extra?: Wod[]; count?: number }): WodView[] {
  const all = fittingWods(slot, equipment, options.extra)
  const fresh = all.filter((w) => !options.recent?.includes(w.id))
  const pool = fresh.length ? fresh : all
  return [...pool].sort((a, b) => hash(options.seed + a.id) - hash(options.seed + b.id)).slice(0, options.count ?? 3)
}

/** Any WOD by id, from the schema's own or the bank. */
export function findWod(id: string, extra: Wod[] = []): Wod | undefined {
  return extra.find((w) => w.id === id) ?? WOD_BANK.find((w) => w.id === id)
}
