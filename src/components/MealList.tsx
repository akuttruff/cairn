import { MEALS } from '../types.ts'
import { MEAL_LABELS, fmt } from '../lib/format.ts'
import type { Entry, Meal } from '../types.ts'

interface MealListProps {
  entries: Entry[]
  onOpen: (entry: Entry) => void
  onAdd: (meal: Meal) => void
}

export default function MealList({ entries, onOpen, onAdd }: MealListProps) {
  return (
    <div className="meals">
      {MEALS.map((meal) => {
        const items = entries.filter((e) => e.meal === meal)
        const kcal = items.reduce((s, e) => s + (e.nutrients.calories ?? 0), 0)
        return (
          <section key={meal} className="meal" aria-label={MEAL_LABELS[meal]}>
            <div className="meal-head">
              <h2>{MEAL_LABELS[meal]}</h2>
              {items.length > 0 && <span className="meal-kcal">{Math.round(kcal)} kcal</span>}
              <button type="button" className="meal-add" onClick={() => onAdd(meal)} aria-label={`Add to ${MEAL_LABELS[meal]}`}>
                + Add
              </button>
            </div>
            {items.map((e) => (
              <button type="button" key={e.id} className="entry" onClick={() => onOpen(e)}>
                <div className="entry-main">
                  <span className="entry-name">{e.name}</span>
                  <span className="entry-sub">
                    {[e.brand, e.grams != null ? `${fmt('protein', e.grams)} g` : null].filter(Boolean).join(' · ')}
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
