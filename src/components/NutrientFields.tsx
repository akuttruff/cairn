import { NUTRIENTS } from '../types.ts'
import { LABELS, UNITS } from '../lib/nutrition.ts'
import type { NutrientDraft } from '../lib/format.ts'

interface Props {
  idPrefix: string
  value: NutrientDraft
  onChange: (next: NutrientDraft) => void
  /** True while Calories is computed from protein+fat+carbs rather than typed. */
  autoCalories?: boolean
}

/** The five numbers, as typed. Calories may be live-computed; see autoCalories. */
export default function NutrientFields({ idPrefix, value, onChange, autoCalories }: Props) {
  return (
    <div className="nutrient-fields">
      {NUTRIENTS.map((key) => {
        const auto = key === 'calories' && autoCalories
        return (
          <div key={key} className={`field nf ${key}${auto ? ' auto' : ''}`}>
            <label htmlFor={`${idPrefix}-${key}`}>
              {LABELS[key]} ({UNITS[key]})
              {auto && <span className="auto-tag"> · from macros</span>}
            </label>
            <input
              id={`${idPrefix}-${key}`}
              type="text"
              inputMode="decimal"
              placeholder="?"
              value={value[key]}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
            />
          </div>
        )
      })}
    </div>
  )
}
