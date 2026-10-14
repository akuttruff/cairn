import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Star, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { calorieMismatch } from '../../lib/nutrition.ts'
import { describeAmount, entryFor, gramsFor, headline, nutrientsFor, unitsFor } from '../../lib/units.ts'
import { fmtGrams, parseNum } from '../../lib/format.ts'
import { NUTRIENTS } from '../../types.ts'
import type { Food, NewEntry, Serving } from '../../types.ts'
import Preview from '../Preview.tsx'
import AddToMeal from '../AddToMeal.tsx'
import { EditFood } from './EditFood.tsx'
import { FoundOnline } from './OnlineLookup.tsx'

/**
 * Pick how much of a chosen food: a number of any of its servings ("1.5" x
 * "1 cup, sliced"), or a weight in g or oz when its per-100g values are known.
 */
/**
 * Pick how much of a chosen food to log. Its numbers can be corrected here
 * too -- a lookup that missed the fiber, a database typo -- before anything
 * is logged: the fix is saved as a copy in My foods, so it sticks.
 */
export function Amount({ food, onChange, onLog }: {
  food: Food
  /** The food after its numbers were corrected; replaces the one picked. */
  onChange: (f: Food) => void
  onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [servings, setServings] = useState<Serving[]>(food.servings ?? [])
  const units = useMemo(() => unitsFor({ ...food, servings }), [food, servings])
  const first = units[0]
  const [unitKey, setUnitKey] = useState(first?.key ?? 'g')
  const [qty, setQty] = useState(first?.key === 'g' ? '100' : '1')
  const touched = useRef(false)
  const [save, setSave] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // USDA keeps household measures ("1 medium", "1 cup") on the food record;
    // fetch them so you rarely have to know a weight.
    if (food.source !== 'usda' || !food.sourceId) return
    let live = true
    api.portions(food.sourceId).then((p) => {
      if (!live || p.length === 0) return
      setServings((prev) => [...prev, ...p.filter((s) => !prev.some((x) => x.label === s.label))])
      // Prefer a real household measure over 100 g -- unless the food already
      // had servings, or you've already chosen something.
      if (!food.servings?.length && !touched.current) {
        setUnitKey('s0')
        setQty('1')
      }
    }).catch(() => { /* weights still work */ })
    return () => { live = false }
  }, [food])

  const unit = units.find((u) => u.key === unitKey) ?? first
  const q = parseNum(qty)
  const grams = unit && q != null ? gramsFor(unit, q) : null
  const valid = unit != null && q != null && q > 0 && q <= 10_000 && (grams == null || grams <= 10_000)
  const nutrients = valid && unit && q != null ? nutrientsFor(food, unit, q) : null
  const chips = units.filter((u) => u.key !== 'g' && u.key !== 'oz')

  const choose = (key: string, quantity?: string): void => {
    touched.current = true
    setUnitKey(key)
    if (quantity) setQty(quantity)
  }

  if (editing) {
    return (
      <EditFood
        food={food}
        fromResult
        onCancel={() => setEditing(false)}
        onSaved={(saved) => {
          onChange(saved)
          // It's in My foods now; the star says so.
          setSave(true)
          setEditing(false)
        }}
      />
    )
  }

  const submit = async (): Promise<void> => {
    if (!valid || !unit || !nutrients) return
    setBusy(true)
    if (save) {
      try {
        await api.saveFood({ ...food, servings })
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    await onLog(entryFor(food, unit, q!))
    setBusy(false)
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        <div className="picked-name">
          <div>
            <div className="entry-name">{food.name}</div>
            {food.brand && <div className="entry-sub">{food.brand}</div>}
          </div>
          <div className="picked-actions">
            <button type="button" className="round-btn" aria-label="Edit nutrition numbers" onClick={() => setEditing(true)}>
              <Pencil size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`star${save ? ' on' : ''}`}
              aria-pressed={save}
              aria-label="Save to My foods"
              onClick={() => setSave((v) => !v)}
            >
              <Star size={18} fill={save ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          </div>
        </div>

        {chips.length > 0 && (
          <div className="chips">
            {chips.map((u) => (
              <button
                type="button"
                key={u.key}
                className={`chip${unitKey === u.key ? ' on' : ''}`}
                onClick={() => choose(u.key, '1')}
              >
                {u.label}
              </button>
            ))}
          </div>
        )}

        <div className="amount-row">
          <div className="field grams">
            <label htmlFor="amount-qty">Amount</label>
            <input
              id="amount-qty"
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => { touched.current = true; setQty(e.target.value) }}
            />
          </div>
          <div className="field">
            <label htmlFor="amount-unit">Unit</label>
            <select
              id="amount-unit"
              value={unit?.key ?? ''}
              onChange={(e) => choose(e.target.value, e.target.value === 'g' ? '100' : e.target.value === 'oz' ? '1' : undefined)}
            >
              {units.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}{u.grams != null && u.key !== 'g' && u.key !== 'oz' ? ` (${fmtGrams(u.grams)} g)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {valid && grams != null && unit?.key !== 'g' && <div className="hint">= {fmtGrams(grams)} g</div>}

        {nutrients ? <Preview nutrients={nutrients} /> : <div className="hint bad">Enter an amount greater than 0.</div>}
        <AddToMeal item={valid && unit && q != null ? entryFor(food, unit, q) : null} disabled={busy} />
        {headline(food) && calorieMismatch(headline(food)!.nutrients) && (
          <div className="hint warn" role="status">
            <TriangleAlert size={13} aria-hidden="true" /> This entry&apos;s calories don&apos;t match its
            protein, fat and carbs. It may have a typo — check the label if you have it.
          </div>
        )}
        {food.source === 'web' && <FoundOnline food={food} />}
        {nutrients && NUTRIENTS.some((k) => nutrients[k] == null) && (
          <div className="hint">— means the source doesn&apos;t report it; it won&apos;t count as zero.</div>
        )}
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" className="primary" disabled={!valid || !nutrients || busy} onClick={() => void submit()}>
            Log {valid && unit ? describeAmount({ quantity: q!, unit: unit.label }) : ''}
          </button>
        </div>
      </div>
    </>
  )
}
