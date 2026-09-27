import { NUTRIENTS } from '../types.ts'
import { LABELS } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { Nutrients } from '../types.ts'

/** The five amounts for a portion, compactly. */
export default function Preview({ nutrients }: { nutrients: Nutrients }) {
  return (
    <dl className="preview">
      {NUTRIENTS.map((key) => (
        <div key={key} className={`pv ${key}`}>
          <dt>{key === 'calories' ? 'kcal' : LABELS[key]}</dt>
          <dd>{fmt(key, nutrients[key])}</dd>
        </div>
      ))}
    </dl>
  )
}
