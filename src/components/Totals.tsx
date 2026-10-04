import { LABELS, OVER_IS_BAD, goalLabel, goalRangeFor, goalStatus, progress } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { DayTotals, DayType, MacroRange, NutrientKey, ResolvedGoals } from '../types.ts'

interface TotalsProps extends DayTotals {
  goals: ResolvedGoals
  dayType: DayType
  onSetDayType: (type: DayType) => void
}

/** The grid under the calories: two caps, then two floors. */
const MACROS: Exclude<NutrientKey, 'calories'>[] = ['carbs', 'fat', 'protein', 'fiber']

/** Marks a total that leaves out entries whose source didn't report it. */
function Partial({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="partial" title={`${count} item${count === 1 ? '' : 's'} missing this value`}>
      +?
    </span>
  )
}

/**
 * The day against its goals. Each goal says which way it points -- "max"
 * for the ones to stay under (calories, carbs, fat), "min" for the ones to
 * reach (protein, fiber) -- and the line under each bar says where the day
 * stands in those terms: so much left or over a max, so much to go to a
 * min, or met.
 */
export default function Totals({ totals, missing, goals, dayType, onSetDayType }: TotalsProps) {
  const cal = totals.calories
  const calStatus = goalStatus('calories', cal, goals.calories)

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
            <span className="cal-goal"> / {goalLabel('calories', goals.calories)} kcal</span>
          </div>
          <div className={`cal-left${calStatus.bad ? ' over' : ''}`}>{calStatus.text}</div>
        </div>
      </div>
      <Bar value={cal} range={goals.calories} kind="calories" />

      <div className="macro-grid">
        {MACROS.map((key) => {
          const range = goalRangeFor(goals, key)
          const status = goalStatus(key, totals[key], range, 'g')
          return (
            <div key={key} className={`macro ${key}`}>
              <div className="macro-head">
                <span className="macro-name">{LABELS[key]}</span>
                <span className="macro-num">
                  {fmt(key, totals[key])}<Partial count={missing[key]} />
                  <span className="macro-goal"> / {goalLabel(key, range)}g</span>
                </span>
              </div>
              <Bar value={totals[key]} range={range} kind={key} />
              <div className={`macro-status${status.bad ? ' over' : status.met ? ' met' : ''}`}>{status.text}</div>
            </div>
          )
        })}
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
