import { LABELS, progress } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { DayTotals, Goals, NutrientKey } from '../types.ts'

interface TotalsProps extends DayTotals {
  goals: Goals
}

const MACROS: NutrientKey[] = ['protein', 'fat', 'carbs', 'fiber']

/** Marks a total that leaves out entries whose source didn't report it. */
function Partial({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="partial" title={`${count} item${count === 1 ? '' : 's'} missing this value`}>
      +?
    </span>
  )
}

export default function Totals({ totals, missing, goals }: TotalsProps) {
  const cal = totals.calories
  const left = goals.calories - cal
  return (
    <section className="totals" aria-label="Daily totals">
      <div className="cal-row">
        <div>
          <div className="cal-value">
            {fmt('calories', cal)}
            <Partial count={missing.calories} />
            <span className="cal-goal"> / {goals.calories} kcal</span>
          </div>
          <div className={`cal-left${left < 0 ? ' over' : ''}`}>
            {left >= 0 ? `${Math.round(left)} left` : `${Math.round(-left)} over`}
          </div>
        </div>
      </div>
      <Bar value={cal} goal={goals.calories} over={left < 0} kind="calories" />

      <div className="macro-grid">
        {MACROS.map((key) => (
          <div key={key} className={`macro ${key}`}>
            <div className="macro-head">
              <span className="macro-name">{LABELS[key]}</span>
              <span className="macro-num">
                {fmt(key, totals[key])}<Partial count={missing[key]} />
                <span className="macro-goal">/{goals[key]}g</span>
              </span>
            </div>
            <Bar value={totals[key]} goal={goals[key]} kind={key} />
          </div>
        ))}
      </div>
    </section>
  )
}

function Bar({ value, goal, kind, over = false }: { value: number; goal: number; kind: NutrientKey; over?: boolean }) {
  const pct = Math.round(progress(value, goal) * 100)
  return (
    <div
      className={`bar ${kind}${over ? ' over' : ''}`}
      role="progressbar"
      aria-label={LABELS[kind]}
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.round(value)}
    >
      <div className="bar-fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
