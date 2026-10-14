import { Pencil, Star, TriangleAlert, UtensilsCrossed } from 'lucide-react'
import { calorieMismatch } from '../../lib/nutrition.ts'
import { headline } from '../../lib/units.ts'
import { fmt } from '../../lib/format.ts'
import type { Food } from '../../types.ts'

export function FoodRow({ food, onPick, favorited, onToggleFavorite, onEdit, inMeal }: {
  food: Food
  onPick: (f: Food) => void
  /** Already in My foods. Omit favorited/onToggleFavorite together to leave the star off entirely. */
  favorited?: boolean
  onToggleFavorite?: (food: Food) => void
  /** Correct this food's numbers right here, without picking it first. */
  onEdit?: (food: Food) => void
  /** Used by at least one saved meal. */
  inMeal?: boolean
}) {
  // Per serving for a food known that way ("/1 bowl"), else per 100 g.
  const h = headline(food)
  if (!h) return null
  const p = h.nutrients
  // Crowd-sourced entries sometimes have a typo; flag ones whose calories
  // disagree with their own macros.
  const doubtful = calorieMismatch(p)
  const row = (
    <button type="button" className="food-row" onClick={() => onPick(food)}>
      <div className="entry-main">
        <span className="entry-name">
          {food.name}
          {inMeal && <UtensilsCrossed size={12} className="meal-badge" aria-label="Part of a saved meal" />}
        </span>
        {food.brand && <span className="entry-sub">{food.brand}</span>}
      </div>
      <div className="entry-nums">
        <span className="entry-kcal">
          {doubtful && <TriangleAlert size={12} className="doubt" aria-label="Numbers don't add up" />}
          {fmt('calories', p.calories)}<small> /{h.label}</small>
        </span>
        <span className="entry-macros">
          P {fmt('protein', p.protein)} · F {fmt('fat', p.fat)} · C {fmt('carbs', p.carbs)} · Fib {fmt('fiber', p.fiber)}
        </span>
      </div>
    </button>
  )
  if (!onToggleFavorite && !onEdit) return row
  return (
    <div className="food-row-wrap">
      {row}
      {onEdit && (
        <button type="button" className="edit-food" aria-label={`Edit ${food.name}`} onClick={() => onEdit(food)}>
          <Pencil size={15} aria-hidden="true" />
        </button>
      )}
      {onToggleFavorite && (
      <button
        type="button"
        className={`favorite-btn${favorited ? ' on' : ''}`}
        aria-pressed={favorited ?? false}
        aria-label={favorited ? `Remove ${food.name} from My foods` : `Save ${food.name} to My foods`}
        onClick={() => onToggleFavorite(food)}
      >
        <Star size={16} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true" />
      </button>
      )}
    </div>
  )
}
