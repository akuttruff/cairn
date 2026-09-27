import { NUTRIENTS } from '../types.ts'
import { LABELS, UNITS } from '../lib/nutrition.ts'
import type { NutrientDraft } from '../lib/format.ts'

interface Props {
  idPrefix: string
  value: NutrientDraft
  onChange: (next: NutrientDraft) => void
}

/** The five numbers, as typed. */
export default function NutrientFields({ idPrefix, value, onChange }: Props) {
  return (
    <div className="nutrient-fields">
      {NUTRIENTS.map((key) => (
        <div key={key} className={`field nf ${key}`}>
          <label htmlFor={`${idPrefix}-${key}`}>{LABELS[key]} ({UNITS[key]})</label>
          <input
            id={`${idPrefix}-${key}`}
            type="text"
            inputMode="decimal"
            placeholder="?"
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  )
}
