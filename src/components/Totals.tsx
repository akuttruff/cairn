import { LABELS, OVER_IS_BAD, goalLabel, goalRangeFor, goalStatus, progress } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { DayTotals, DayType, MacroRange, NutrientKey, ResolvedGoals } from '../types.ts'

interface TotalsProps extends DayTotals {
  goals: ResolvedGoals
  /** Calories from the day's drinks. Not part of totals.calories: drawn on the bar as their own stretch. */
  drinkCalories?: number
  dayType: DayType
  onSetDayType: (type: DayType) => void
}

/** The grid under the calories: the two to reach on top, then the two to stay under. */
const MACROS: Exclude<NutrientKey, 'calories'>[] = ['protein', 'fiber', 'carbs', 'fat']

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
 *
 * The day's drinks get their own stretch of the calorie bar, after the
 * food, and a line saying what they come to. The big number and the
 * "left / over" line stay food only, the same figure the week and month
 * are scored on.
 */
export default function Totals({ totals, missing, goals, dayType, onSetDayType, drinkCalories = 0 }: TotalsProps) {
  const cal = totals.calories
  const calStatus = goalStatus('calories', cal, goals.calories)
  const drinks = Math.round(drinkCalories)

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
      <Bar value={cal} range={goals.calories} kind="calories" extra={drinks} extraLabel="from drinks" />
      {drinks > 0 && (
        <div className="cal-drinks">
          <span className="cal-drinks-key" aria-hidden="true" />
          + {drinks} kcal from drinks · {Math.round(cal) + drinks} in all
        </div>
      )}

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

interface BarProps {
  value: number
  range: MacroRange
  kind: NutrientKey
  /** A second amount drawn after the fill in its own colour (the day's drinks, on the calorie bar). It stops at the bar's end. */
  extra?: number
  extraLabel?: string
}

export function Bar({ value, range, kind, extra = 0, extraLabel }: BarProps) {
  const pct = Math.round(progress(value, range.max) * 100)
  const extraPct = extra > 0 ? Math.round(progress(value + extra, range.max) * 100) - pct : 0
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
      aria-valuetext={extra > 0 ? `${Math.round(value)}, plus ${Math.round(extra)} ${extraLabel ?? 'more'}` : undefined}
    >
      <div className={`bar-fill${extraPct > 0 ? ' joined' : ''}`} style={{ width: `${pct}%` }} />
      {extraPct > 0 && <div className="bar-extra" data-testid="bar-extra" style={{ left: `${pct}%`, width: `${extraPct}%` }} />}
      {minPct > 0 && <div className="bar-min-tick" style={{ left: `${minPct}%` }} />}
    </div>
  )
}
