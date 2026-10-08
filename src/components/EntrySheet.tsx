import { useEffect, useState } from 'react'
import { Drawer } from 'vaul'
import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { scale } from '../lib/nutrition.ts'
import { foodFromEntry, multiply } from '../lib/units.ts'
import { MEAL_LABELS, draftHasJunk, draftOf, nutrientsOf, parseNum } from '../lib/format.ts'
import { MEALS, NUTRIENTS } from '../types.ts'
import type { Entry, Meal, Nutrients } from '../types.ts'
import NutrientFields from './NutrientFields.tsx'
import Preview from './Preview.tsx'
import useNutrientDraft from '../hooks/useNutrientDraft.ts'

interface EntrySheetProps {
  open: boolean
  session: number
  /** Kept after closing, so the sheet doesn't go blank as it slides away. */
  entry: Entry | null
  onClose: () => void
  onChanged: () => void
}

/**
 * Edit something already logged: by how many servings, in the unit it was
 * logged in; by weight for a food that was weighed; and your own entries by
 * their numbers too. A database food's per-100g values are kept as published.
 */
export default function EntrySheet({ open, session, entry, onClose, onChanged }: EntrySheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content" aria-describedby={undefined}>
          <div className="drawer-handle" />
          {entry && <EntryForm key={session} entry={entry} onClose={onClose} onChanged={onChanged} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function EntryForm({ entry, onClose, onChanged }: { entry: Entry; onClose: () => void; onChanged: () => void }) {
  const [meal, setMeal] = useState<Meal>(entry.meal)
  const [grams, setGrams] = useState(entry.grams == null ? '' : String(entry.grams))
  const [qty, setQty] = useState(entry.amount ? String(entry.amount.quantity) : '')
  const [draft, setDraft, caloriesIsAuto] = useNutrientDraft(draftOf(entry.perUnit ?? entry.nutrients))
  // Fixing what a database or lookup got wrong or left out; see numbersEdit below.
  const [numbersOpen, setNumbersOpen] = useState(false)
  const [numDraft, setNumDraft, numAuto] = useNutrientDraft(draftOf(entry.nutrients))
  const [busy, setBusy] = useState(false)

  // Star: keep this food in My foods, or drop it. Known once the saved
  // list has loaded; until then the star is just off.
  const food = foodFromEntry(entry)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    let live = true
    api.foods()
      .then((f) => { if (live) setSaved((f?.saved ?? []).some((x) => x.id === food.id)) })
      .catch(() => { /* the star still works; it just starts off */ })
    return () => { live = false }
  }, [food.id])
  const toggleSaved = async (): Promise<void> => {
    try {
      if (saved) {
        await api.deleteFood(food.id)
        setSaved(false)
        toast.success(`Removed ${food.name} from My foods`)
      } else {
        await api.saveFood(food)
        setSaved(true)
        toast.success(`Saved ${food.name} to My foods`)
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // Edit in the unit it was logged in ("1.5 cup"); by weight if it was
  // weighed; by its numbers if it's a one-off with neither.
  const amount = entry.amount
  const byQuantity = Boolean(amount && (entry.perUnit || (entry.per100g && amount.unitGrams)))
  const byWeight = !byQuantity && Boolean(entry.per100g)
  const ownNumbers = entry.source === 'custom' && (Boolean(entry.perUnit) || (!byWeight && !byQuantity))

  const g = parseNum(grams)
  const gramsOk = g != null && g > 0 && g <= 10_000
  const q = parseNum(qty)
  const qtyOk = q != null && q > 0 && q <= 10_000
  const draftNumbers = (): Nutrients => {
    const n = {} as Nutrients
    for (const k of NUTRIENTS) n[k] = parseNum(draft[k])
    return n
  }

  const preview = (): Nutrients | null => {
    if (byQuantity && qtyOk) {
      if (entry.perUnit) return multiply(ownNumbers ? draftNumbers() : entry.perUnit, q!)
      return scale(entry.per100g!, amount!.unitGrams! * q!)
    }
    if (byWeight && gramsOk) return scale(entry.per100g!, g!)
    return null
  }

  const save = async (): Promise<void> => {
    const patch: Parameters<typeof api.updateEntry>[1] = {}
    if (meal !== entry.meal) patch.meal = meal
    if (byQuantity) {
      if (!qtyOk) return
      if (q !== amount!.quantity) patch.quantity = q!
    } else if (byWeight) {
      if (!gramsOk) return
      if (g !== entry.grams) patch.grams = g!
    }
    if (numbersOpen) {
      const n = nutrientsOf(numDraft)
      if (NUTRIENTS.some((k) => n[k] !== entry.nutrients[k])) patch.nutrients = n
    }
    if (ownNumbers) {
      const n = draftNumbers()
      if (n.calories == null) { toast.error('Calories are required'); return }
      if (entry.perUnit) patch.perUnit = n
      else patch.nutrients = n
    }
    setBusy(true)
    try {
      await api.updateEntry(entry.id, patch)
      onChanged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.deleteEntry(entry.id)
      toast.success(`Removed ${entry.name}`)
      onChanged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const shown = preview()
  const amountOk = byQuantity ? qtyOk : byWeight ? gramsOk : true
  // Your own entries already show their numbers above; everything else can be corrected here.
  const canEditNumbers = !ownNumbers
  const numbersOk = !numbersOpen || !draftHasJunk(numDraft)

  return (
    <>
          <div className="sheet-top entry-top">
            <Drawer.Title className="drawer-title">{entry.name}</Drawer.Title>
            <button
              type="button"
              className={`star${saved ? ' on' : ''}`}
              aria-pressed={saved}
              aria-label={saved ? `Remove ${entry.name} from My foods` : `Save ${entry.name} to My foods`}
              onClick={() => void toggleSaved()}
            >
              <Star size={18} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </div>
          <div className="drawer-scroll short" data-vaul-no-drag>
            {entry.brand && <div className="hint" style={{ marginTop: -10, marginBottom: 12 }}>{entry.brand}</div>}
            <div className="field">
              <label htmlFor="edit-meal">Meal</label>
              <select id="edit-meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
                {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
              </select>
            </div>
            {byQuantity && (
              <div className="field grams">
                <label htmlFor="edit-qty">Amount ({amount!.unit})</label>
                <input id="edit-qty" type="text" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            )}
            {byWeight && (
              <div className="field grams">
                <label htmlFor="edit-grams">Amount (g)</label>
                <input id="edit-grams" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
              </div>
            )}
            {!amountOk && <div className="hint bad">Enter an amount greater than 0.</div>}
            {ownNumbers && (
              <>
                {entry.perUnit && <div className="hint">Numbers for {amount?.unit ?? 'one serving'}:</div>}
                <NutrientFields idPrefix="edit" value={draft} onChange={setDraft} autoCalories={caloriesIsAuto} />
              </>
            )}
            {canEditNumbers && (numbersOpen
              ? (
                <>
                  <h3 className="sheet-h">Nutrition for this portion</h3>
                  <NutrientFields idPrefix="edit-num" value={numDraft} onChange={setNumDraft} autoCalories={numAuto} />
                  <div className="hint">
                    Fill in what&apos;s missing or fix what&apos;s wrong -- leave a field blank if it&apos;s unknown.
                    Only what you change is corrected, and a saved copy of this food is updated to match.
                    If you also change the amount, these numbers are for the amount as logged.
                  </div>
                  {!numbersOk && <div className="hint bad">Numbers only, please.</div>}
                </>
              )
              : <button type="button" className="link-btn" onClick={() => setNumbersOpen(true)}>Edit nutrition numbers</button>)}
            {shown && !numbersOpen && <Preview nutrients={shown} />}
          </div>
          <div className="drawer-actions">
            <div className="row">
              <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Delete</button>
              <button type="button" className="primary" disabled={busy || !amountOk || !numbersOk} onClick={() => void save()}>Save</button>
            </div>
          </div>
    </>
  )
}
