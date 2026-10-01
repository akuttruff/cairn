import { ALCOHOL_KINDS, NUTRIENTS } from '../types.ts'
import { LABELS, UNITS, goalMet, goalRangeFor, localDate, progress, waterMet } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import type { DaySummary, MacroRange, NutrientKey, RangeView } from '../types.ts'

interface RangeSummaryProps {
  view: RangeView
  /** Tap a day's marker to jump straight to it in Day view. */
  onSelectDay: (date: string) => void
}

/** One line on the daily charts: a nutrient, or water, read off each day the same way. */
interface Series {
  /** Also the CSS class that colours it. */
  key: NutrientKey | 'water'
  label: string
  unit: string
  value: (d: DaySummary) => number
  /** That day's own target. */
  goal: (d: DaySummary) => MacroRange
  logged: (d: DaySummary) => boolean
  met: (value: number, goal: MacroRange) => boolean
  format: (value: number) => string
}

const nutrientSeries = (key: NutrientKey): Series => ({
  key,
  label: LABELS[key],
  unit: UNITS[key],
  value: (d) => d.totals[key],
  goal: (d) => goalRangeFor(d.goals, key),
  logged: (d) => d.entryCount > 0,
  met: (value, goal) => goalMet(value, goal, key),
  format: (value) => fmt(key, value),
})

const WATER: Series = {
  key: 'water',
  label: 'Water',
  unit: 'oz',
  value: (d) => d.water,
  goal: (d) => ({ min: d.goals.water, max: d.goals.water }),
  logged: (d) => d.water > 0,
  met: (value, goal) => waterMet(value, goal.min),
  format: (value) => String(Math.round(value)),
}

/** What the daily charts plot, in order. */
const CHARTED: Series[] = [nutrientSeries('calories'), nutrientSeries('protein'), nutrientSeries('fiber'), WATER]

interface RangeChartProps {
  series: Series
  days: DaySummary[]
  today: string
  onSelectDay: (date: string) => void
}

/**
 * One series' daily trend as a line, with each day's own goal drawn as a
 * short mark at that day -- higher on training days, lower on rest days --
 * rather than one line for the whole range, which no single day was
 * actually aiming at. A day's dot is filled when it met its goal, hollow
 * when it didn't, and dim when nothing was logged.
 *
 * The label sits in its own row above the plot, in normal flow -- not
 * layered over it -- so it never collides with the line itself.
 *
 * The connecting line and goal marks are drawn in one SVG, scaled to fill
 * the plot area (viewBox 0-100 both axes; `preserveAspectRatio="none"` lets
 * it stretch to the real, non-square box). Circles don't stretch well under
 * that same scaling -- a 1-unit radius becomes a flat ellipse in a box far
 * wider than it is tall -- so the point markers are plain positioned HTML
 * buttons layered on top instead, sized in real pixels and never distorted.
 * Both are driven by the same x/y-percent math, so they always line up.
 */
function RangeChart({ series, days, today, onSelectDay }: RangeChartProps) {
  const goals = days.map((d) => series.goal(d))
  const max = Math.max(...goals.map((r) => r.max), ...days.map((d) => series.value(d)), 1)
  const n = days.length
  const xPct = (i: number): number => (n > 1 ? (i / (n - 1)) * 100 : 50)
  const yPct = (value: number): number => Math.min(100, Math.max(0, (value / max) * 100))
  // A goal mark spans most of the gap to its neighbours, so it reads as "this day's".
  const half = n > 1 ? (100 / (n - 1)) * 0.38 : 10
  const linePoints = days.map((d, i) => `${xPct(i)},${100 - yPct(series.value(d))}`).join(' ')

  return (
    <div className="range-chart-wrap">
      <div className="range-chart-head">
        <span className={`range-chart-dot ${series.key}`} aria-hidden="true" />
        <span className="range-chart-label">{series.label}</span>
      </div>
      <div className="range-chart-plot">
        <svg className="range-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {days.map((d, i) => {
            const r = goals[i]!
            const x1 = Math.max(0, xPct(i) - half)
            const x2 = Math.min(100, xPct(i) + half)
            return (
              <g key={d.date}>
                {r.max > 0 && <line className="range-goal-mark" x1={x1} y1={100 - yPct(r.max)} x2={x2} y2={100 - yPct(r.max)} />}
                {r.min > 0 && r.min < r.max && (
                  <line className="range-goal-mark" x1={x1} y1={100 - yPct(r.min)} x2={x2} y2={100 - yPct(r.min)} />
                )}
              </g>
            )
          })}
          <polyline className={`range-line ${series.key}`} points={linePoints} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="range-points">
          {days.map((d, i) => {
            const value = series.value(d)
            const logged = series.logged(d)
            const state = !logged ? 'unlogged' : series.met(value, goals[i]!) ? 'met' : 'missed'
            const verdict = !logged ? 'nothing logged' : state === 'met' ? 'goal met' : 'goal missed'
            return (
              <button
                key={d.date}
                type="button"
                className={`range-point ${series.key} ${state}${d.date === today ? ' today' : ''}`}
                style={{ left: `${xPct(i)}%`, bottom: `${yPct(value)}%` }}
                onClick={() => onSelectDay(d.date)}
                aria-label={`${d.date}: ${series.format(value)} ${series.unit}, ${verdict}`}
                title={`${series.format(value)} ${series.unit} · ${verdict}`}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * A week or month at a glance: calories, protein, fiber and water per day
 * against each day's own goal (tap a marker to open that day), then a
 * scorecard of how many logged days met each goal, then water and alcohol.
 * Averages are explained in RangeView's own doc comment -- macros average
 * over days actually logged, water and alcohol over every day in the range.
 */
export default function RangeSummary({ view, onSelectDay }: RangeSummaryProps) {
  const { days, goals, dayTypes, scorecard, averages, loggedDays, totalDays, water, alcohol } = view
  const today = localDate()
  const drankKinds = ALCOHOL_KINDS.filter((k) => alcohol.byKind[k] > 0)
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  const unloggedWater = totalDays - water.of

  return (
    <section className="range-summary" aria-label="Range summary">
      {CHARTED.map((series) => (
        <RangeChart key={series.key} series={series} days={days} today={today} onSelectDay={onSelectDay} />
      ))}
      <div className="range-axis">
        {days.map((d) => (
          <span key={d.date} className={d.date === today ? 'today' : ''}>{Number(d.date.slice(8, 10))}</span>
        ))}
      </div>
      <div className="range-coverage">
        Logged {loggedDays} of {plural(totalDays, 'day')} · {dayTypes.training} training, {dayTypes.rest} rest
      </div>

      <section className="scorecard" aria-label="Goals met">
        <div className="scorecard-head">
          <span className="water-label">Goals met</span>
          <span className="scorecard-note">
            {loggedDays ? 'of logged days, each against its own day’s goal' : 'nothing logged yet'}
          </span>
        </div>
        {NUTRIENTS.map((key) => {
          const { met, of } = scorecard[key]
          return (
            <div key={key} className={`macro ${key} score-row`}>
              <div className="macro-head">
                <span className="macro-name">{LABELS[key]}</span>
                <span className="macro-num">
                  {of ? `${met} of ${plural(of, 'day')}` : '—'}
                  <span className="macro-goal"> · avg {fmt(key, averages[key])} {UNITS[key]}</span>
                </span>
              </div>
              <div
                className={`bar ${key}`}
                role="progressbar"
                aria-label={`${LABELS[key]} goal met`}
                aria-valuemin={0}
                aria-valuemax={of}
                aria-valuenow={met}
              >
                <div className="bar-fill" style={{ width: `${Math.round(progress(met, of) * 100)}%` }} />
              </div>
            </div>
          )
        })}
      </section>

      <section className="water-card" aria-label="Water">
        <div className="water-head">
          <span className="water-label">Water</span>
          <span className="water-num">
            {water.of ? `${water.met} of ${plural(water.of, 'day')}` : '—'}
            <span className="water-goal"> · {Math.round(goals.water)} oz goal</span>
          </span>
        </div>
        <div
          className="bar water"
          role="progressbar"
          aria-label="Water goal met"
          aria-valuemin={0}
          aria-valuemax={water.of}
          aria-valuenow={water.met}
        >
          <div className="bar-fill" style={{ width: `${Math.round(progress(water.met, water.of) * 100)}%` }} />
        </div>
        <div className="water-bottles">
          {Math.round(water.total)} oz total · {Math.round(water.average)} oz avg/day
          {unloggedWater > 0 && ` · ${plural(unloggedWater, 'day')} with none logged`}
        </div>
      </section>

      {alcohol.total > 0 && (
        <section className="water-card" aria-label="Alcohol">
          <div className="water-head">
            <span className="water-label">Alcohol</span>
            <span className="water-num">
              {alcohol.total} drink{alcohol.total === 1 ? '' : 's'}
              <span className="water-goal"> · {alcohol.average} avg/day · {Math.round(alcohol.calories)} kcal</span>
            </span>
          </div>
          <div className="water-bottles">{drankKinds.map((k) => `${alcohol.byKind[k]} ${k}`).join(', ')}</div>
        </section>
      )}
    </section>
  )
}
