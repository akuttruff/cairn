import { LABELS, OVER_IS_BAD, progress, rangeStatus } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { DayTotals, DayType, MacroRange, NutrientKey, ResolvedGoals } from '../types.ts'

interface TotalsProps extends DayTotals {
  goals: ResolvedGoals
  dayType: DayType
  onSetDayType: (type: DayType) => void
}

type RangeMacroKey = 'protein' | 'fat' | 'carbs'
const MACROS: RangeMacroKey[] = ['protein', 'fat', 'carbs']

/** Marks a total that leaves out entries whose source didn't report it. */
function Partial({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="partial" title={`${count} item${count === 1 ? '' : 's'} missing this value`}>
      +?
    </span>
  )
}

/** "125-130" when the range has spread, or just "125" when min and max match (fiber). */
function rangeLabel(range: MacroRange): string {
  return range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`
}

export default function Totals({ totals, missing, goals, dayType, onSetDayType }: TotalsProps) {
  const cal = totals.calories
  const status = rangeStatus(cal, goals.calories)
  const calLeftText =
    status === 'under' ? `${Math.round(goals.calories.min - cal)} to go`
    : status === 'over' ? `${Math.round(cal - goals.calories.max)} over`
    : 'In range'

  return (
    <section className="totals" aria-label="Daily totals">
      {/* Ticked on the days you train; an unticked day is a rest day. A
          training day adds the pre-workout carbs to the goals below. */}
      <label className="day-type-check">
        <input
          type="checkbox"
          checked={dayType === 'training'}
          onChange={(e) => onSetDayType(e.target.checked ? 'training' : 'rest')}
        />
        <span>WOD / weightlifting day</span>
        <span className="day-type-note">
          {dayType === 'training' ? 'training goals' : 'rest-day goals'} · {Math.round(goals.calories.max)} kcal
        </span>
      </label>

      <div className="cal-row">
        <div>
          <div className="cal-value">
            {fmt('calories', cal)}
            <Partial count={missing.calories} />
            <span className="cal-goal"> / {rangeLabel(goals.calories)} kcal</span>
          </div>
          <div className={`cal-left${status === 'over' ? ' over' : ''}`}>{calLeftText}</div>
        </div>
      </div>
      <Bar value={cal} range={goals.calories} kind="calories" />

      <div className="macro-grid">
        {MACROS.map((key) => (
          <div key={key} className={`macro ${key}`}>
            <div className="macro-head">
              <span className="macro-name">{LABELS[key]}</span>
              <span className="macro-num">
                {fmt(key, totals[key])}<Partial count={missing[key]} />
                <span className="macro-goal">/{rangeLabel(goals[key])}g</span>
              </span>
            </div>
            <Bar value={totals[key]} range={goals[key]} kind={key} />
          </div>
        ))}
        <div className="macro fiber">
          <div className="macro-head">
            <span className="macro-name">{LABELS.fiber}</span>
            <span className="macro-num">
              {fmt('fiber', totals.fiber)}<Partial count={missing.fiber} />
              <span className="macro-goal">/{goals.fiber}g</span>
            </span>
          </div>
          <Bar value={totals.fiber} range={{ min: 0, max: goals.fiber }} kind="fiber" />
        </div>
      </div>
    </section>
  )
}

export function Bar({ value, range, kind }: { value: number; range: MacroRange; kind: NutrientKey }) {
  const pct = Math.round(progress(value, range.max) * 100)
  // A bottom-of-range tick only means something when there is a range.
  const minPct = range.min > 0 && range.min < range.max ? Math.round(progress(range.min, range.max) * 100) : 0
  const over = OVER_IS_BAD.has(kind) && value > range.max
  return (
    <div
      className={`bar ${kind}${over ? ' over' : ''}`}
      role="progressbar"
      aria-label={LABELS[kind]}
      aria-valuemin={0}
      aria-valuemax={range.max}
      aria-valuenow={Math.round(value)}
    >
      <div className="bar-fill" style={{ width: `${pct}%` }} />
      {minPct > 0 && <div className="bar-min-tick" style={{ left: `${minPct}%` }} />}
    </div>
  )
}
