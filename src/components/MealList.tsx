import { useState } from 'react'
import { Check } from 'lucide-react'
import { MEALS } from '../types.ts'
import { MEAL_LABELS, fmt, fmtGrams } from '../lib/format.ts'
import { sumNutrients } from '../lib/nutrition.ts'
import { describeAmount } from '../lib/units.ts'
import type { Entry, Meal } from '../types.ts'

interface MealListProps {
  entries: Entry[]
  onOpen: (entry: Entry) => void
  onAdd: (meal: Meal) => void
  /** Select mode: remove the chosen entries in one go. */
  onDeleteMany?: (entries: Entry[]) => Promise<void>
}

export default function MealList({ entries, onOpen, onAdd, onDeleteMany }: MealListProps) {
  // Select mode: null when off, else the chosen entry ids. Tapping a row
  // then ticks it instead of opening it.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false)
  const selecting = selected !== null
  const live = new Set(entries.map((e) => e.id))
  const chosen = selected ? entries.filter((e) => selected.has(e.id) && live.has(e.id)) : []

  const toggle = (id: string): void => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const deleteChosen = async (): Promise<void> => {
    if (!onDeleteMany || chosen.length === 0) return
    setBusy(true)
    try {
      await onDeleteMany(chosen)
      setSelected(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="meals">
      {onDeleteMany && entries.length > 0 && (
        <div className="meals-bar" role="toolbar" aria-label="Logged foods">
          {selecting ? (
            <>
              <button type="button" className="link-btn" onClick={() => setSelected(new Set(entries.map((e) => e.id)))}>Select all</button>
              <span className="meals-count">{chosen.length} selected</span>
              <button type="button" className="link-btn danger" disabled={busy || chosen.length === 0} onClick={() => void deleteChosen()}>
                Delete{chosen.length ? ` ${chosen.length}` : ''}
              </button>
              <button type="button" className="link-btn" onClick={() => setSelected(null)}>Done</button>
            </>
          ) : (
            <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>Select</button>
          )}
        </div>
      )}
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal)
        const total = sumNutrients(items.map((e) => e.nutrients))
        return (
          <section key={meal} className="meal" aria-label={MEAL_LABELS[meal]}>
            <div className="meal-head">
              <h2>{MEAL_LABELS[meal]}</h2>
              {items.length > 0 && (
                <>
                  <span className="meal-kcal" aria-label={`${MEAL_LABELS[meal]} calories`}>{fmt('calories', total.calories)} kcal</span>
                  <span className="meal-macros" aria-label={`${MEAL_LABELS[meal]} macros`}>
                    P {fmt('protein', total.protein)} · F {fmt('fat', total.fat)} · C {fmt('carbs', total.carbs)} · Fib {fmt('fiber', total.fiber)}
                  </span>
                </>
              )}
              {!selecting && (
                <button type="button" className="meal-add" onClick={() => onAdd(meal)} aria-label={`Add to ${MEAL_LABELS[meal]}`}>
                  + Add
                </button>
              )}
            </div>
            {items.map((e) => (
              <button
                type="button"
                key={e.id}
                className={`entry${selecting ? ' selectable' : ''}`}
                aria-pressed={selecting ? selected!.has(e.id) : undefined}
                onClick={() => (selecting ? toggle(e.id) : onOpen(e))}
              >
                {selecting && (
                  <span className={`pick-check${selected!.has(e.id) ? ' on' : ''}`} aria-hidden="true">
                    {selected!.has(e.id) && <Check size={14} />}
                  </span>
                )}
                <div className="entry-main">
                  <span className="entry-name">{e.name}</span>
                  <span className="entry-sub">
                    {[
                      e.brand,
                      // As measured ("1.5 cup"), else the weight.
                      e.amount ? describeAmount(e.amount) : e.grams != null ? `${fmtGrams(e.grams)} g` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="entry-nums">
                  <span className="entry-kcal">{fmt('calories', e.nutrients.calories)}</span>
                  <span className="entry-macros">
                    P {fmt('protein', e.nutrients.protein)} · F {fmt('fat', e.nutrients.fat)} ·
                    C {fmt('carbs', e.nutrients.carbs)} · Fib {fmt('fiber', e.nutrients.fiber)}
                  </span>
                </div>
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}
