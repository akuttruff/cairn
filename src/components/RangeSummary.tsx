import { ALCOHOL_KINDS, NUTRIENTS, WORKOUT_KINDS } from '../types.ts'
import { LABELS, UNITS, goalDirection, goalMet, goalRangeFor, localDate, meditationMet, progress, waterMet } from '../lib/nutrition.ts'
import { fmt } from '../lib/format.ts'
import { WORKOUTS } from './WorkoutTracker.tsx'
import { SIT_MINUTES } from './MeditationTracker.tsx'
import type { DaySummary, MacroRange, NutrientKey, RangeView } from '../types.ts'

interface RangeSummaryProps {
  view: RangeView
  /** Tap a day's marker to jump straight to it in Day view. */
  onSelectDay: (date: string) => void
}

/** One line on the daily charts: a nutrient, or water, read off each day the same way. */
interface Series {
  /** Also the CSS class that colours it. */
  key: NutrientKey | 'water' | 'meditation'
  label: string
  /** Which way the goal points: "stay under" or "reach". */
  direction: string
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
  direction: goalDirection(key),
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
  direction: 'reach',
  unit: 'oz',
  value: (d) => d.water,
  goal: (d) => ({ min: d.goals.water, max: d.goals.water }),
  logged: (d) => d.water > 0,
  met: (value, goal) => waterMet(value, goal.min),
  format: (value) => String(Math.round(value)),
}

const MEDITATION: Series = {
  key: 'meditation',
  label: 'Meditation',
  direction: 'reach',
  unit: 'min',
  value: (d) => d.meditationMinutes,
  goal: (d) => ({ min: d.goals.meditationMinutes, max: d.goals.meditationMinutes }),
  logged: (d) => d.meditationMinutes > 0,
  met: (value, goal) => meditationMet(value, goal.min),
  format: (value) => String(Math.round(value)),
}

/** What the daily charts plot, in order. Workouts have a weekly goal, not a daily one, so they get a card below instead. */
const CHARTED: Series[] = [nutrientSeries('calories'), nutrientSeries('protein'), nutrientSeries('fiber'), WATER, MEDITATION]

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
        <span className="goal-dir">{series.direction}</span>
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

type BoxState = 'full' | 'half' | 'empty'

/** Sunday = 0 ... Saturday = 6, for lining a month up under weekday columns (weeks start on Sunday). */
const weekdayIndex = (date: string): number => new Date(`${date}T00:00:00`).getDay()
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface DayBoxesProps {
  /** Also the CSS class that colours it. */
  kind: 'workout' | 'meditation'
  days: DaySummary[]
  today: string
  state: (d: DaySummary) => BoxState
  /** What the day had, for its label: "2 sits, 50 min". */
  describe: (d: DaySummary) => string
  onSelectDay: (date: string) => void
}

/**
 * One box per day, in Sunday-first weekday columns -- a week is one row, a
 * month a little calendar. A box is filled for a day that did it, half
 * filled for a day partway there (one sit of two), and empty otherwise;
 * days still ahead are drawn faint, so an unfilled future isn't read as a
 * miss. Tap a box to open that day.
 */
function DayBoxes({ kind, days, today, state, describe, onSelectDay }: DayBoxesProps) {
  const lead = days.length ? weekdayIndex(days[0]!.date) : 0
  return (
    <div className={`day-boxes ${kind}`}>
      {WEEKDAYS.map((w, i) => <span key={i} className="day-boxes-weekday" aria-hidden="true">{w}</span>)}
      {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} aria-hidden="true" />)}
      {days.map((d) => {
        const future = d.date > today
        const s = future ? 'empty' : state(d)
        const label = `${d.date}: ${future ? 'still ahead' : describe(d)}`
        return (
          <button
            key={d.date}
            type="button"
            className={`day-box ${s}${future ? ' future' : ''}${d.date === today ? ' today' : ''}`}
            onClick={() => onSelectDay(d.date)}
            aria-label={label}
            title={label}
          >
            <span className="day-box-num">{Number(d.date.slice(8, 10))}</span>
          </button>
        )
      })}
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
  const { days, goals, dayTypes, scorecard, averages, loggedDays, totalDays, water, alcohol, workouts, meditation } = view
  const today = localDate()
  const workoutState = (d: DaySummary): BoxState => (d.workouts > 0 ? 'full' : 'empty')
  // Both sits is a full box; one sit (anything short of the goal) is half.
  const meditationState = (d: DaySummary): BoxState =>
    meditationMet(d.meditationMinutes, d.goals.meditationMinutes) ? 'full' : d.meditationMinutes > 0 ? 'half' : 'empty'
  const workedOutDays = days.filter((d) => d.date <= today && workoutState(d) === 'full').length
  const elapsedDays = days.filter((d) => d.date <= today).length
  const drankKinds = ALCOHOL_KINDS.filter((k) => alcohol.byKind[k] > 0)
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
  const unloggedWater = totalDays - water.of
  // Every kind that was planned or done in the range, in the usual order.
  const workoutKinds = WORKOUT_KINDS.filter((k) => workouts.goalByKind[k] > 0 || workouts.byKind[k] > 0)

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
                <span className="macro-name">{LABELS[key]} <span className="goal-dir">{goalDirection(key)}</span></span>
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

      <section className="water-card" aria-label="Workouts">
        <div className="water-head">
          <span className="water-label">Workouts</span>
          <span className="water-num">
            {workouts.sessions} of {workouts.goal}
            <span className="water-goal"> planned</span>
          </span>
        </div>
        <DayBoxes
          kind="workout"
          days={days}
          today={today}
          state={workoutState}
          describe={(d) => (d.workouts ? `${plural(d.workouts, 'workout')}` : 'no workout')}
          onSelectDay={onSelectDay}
        />
        <div className="water-bottles">Worked out {workedOutDays} of {plural(elapsedDays, 'day')} so far</div>
        {/* Each activity against its goal for the range (from each week's own plan). */}
        <ul className="plan-list range-plan" aria-label="Workouts by activity">
          {workoutKinds.map((k) => {
            const done = workouts.byKind[k]
            const goal = workouts.goalByKind[k]
            return (
              <li key={k} className={`plan-row${goal > 0 && done >= goal ? ' met' : ''}`}>
                <span className="plan-name">{WORKOUTS[k].label}</span>
                <span className="plan-pips" aria-hidden="true">
                  {Array.from({ length: Math.max(goal, done) }, (_, i) => (
                    <span key={i} className={`pip${i < done ? ' done' : ''}${i >= goal ? ' extra' : ''}`} />
                  ))}
                </span>
                <span className="plan-count">{done} of {goal}</span>
              </li>
            )
          })}
        </ul>
        {workouts.minutes > 0 && <div className="water-bottles">{workouts.minutes} min logged</div>}
      </section>

      <section className="water-card" aria-label="Meditation">
        <div className="water-head">
          <span className="water-label">Meditation</span>
          <span className="water-num">
            {meditation.of ? `${meditation.met} of ${plural(meditation.of, 'day')}` : '—'}
            <span className="water-goal"> · {goals.meditationMinutes} min goal</span>
          </span>
        </div>
        <DayBoxes
          kind="meditation"
          days={days}
          today={today}
          state={meditationState}
          describe={(d) => {
            const sits = Math.round(d.meditationMinutes / SIT_MINUTES)
            return d.meditationMinutes ? `${plural(sits, 'sit')}, ${d.meditationMinutes} min` : 'no meditation'
          }}
          onSelectDay={onSelectDay}
        />
        <div className="water-bottles">
          {meditation.total} min total · {meditation.average} min avg/day
          {meditation.streak > 1 && ` · ${meditation.streak}-day streak`}
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
