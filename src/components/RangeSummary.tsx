import { useState } from 'react'
import { ALCOHOL_KINDS, DEFAULT_CHARTS, NUTRIENTS } from '../types.ts'
import { LABELS, UNITS, dogWalksMet, goalDirection, goalMet, goalRangeFor, localDate, meditationMet, progress, waterMet } from '../lib/nutrition.ts'
import RangeNotes from './RangeNotes.tsx'
import { fmt, milesLabel } from '../lib/format.ts'
import { kindView } from '../lib/workoutIcons.ts'
import { SIT_MINUTES } from './MeditationTracker.tsx'
import { BodyRangeCard } from './BodyCard.tsx'
import type { ChartKey, DaySummary, MacroRange, NutrientKey, RangeView } from '../types.ts'

interface RangeSummaryProps {
  view: RangeView
  /** Tap a day's marker to jump straight to it in Day view. */
  onSelectDay: (date: string) => void
  /** Nutrition's cards (charts, goals met, water, alcohol) or Train's (workouts, meditation, dog walks, body). */
  part?: 'nutrition' | 'train'
}

/** One daily chart: a nutrient, or water, read off each day the same way. */
interface Series {
  /** Also the CSS class that colours it. */
  key: NutrientKey | 'water'
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
  /** The range's average, for the chart's header. */
  average: (view: RangeView) => number
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
  average: (view) => view.averages[key],
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
  average: (view) => view.water.average,
}

/**
 * Everything that can be charted per day; Settings picks which (view.charts).
 * Meditation and workouts are shown as day boxes further down instead (a
 * sit or a session is done or not -- there is no curve to read).
 */
const SERIES: Record<ChartKey, Series> = {
  calories: nutrientSeries('calories'), protein: nutrientSeries('protein'), fat: nutrientSeries('fat'),
  carbs: nutrientSeries('carbs'), fiber: nutrientSeries('fiber'), water: WATER,
}

/** Where a day stands against its goal. Today isn't over, so it is only a hit or a miss once that can't change. */
type DayState = 'met' | 'missed' | 'pending' | 'unlogged' | 'future'
const VERDICT: Record<DayState, string> = {
  met: 'goal met', missed: 'goal missed', pending: 'in progress', unlogged: 'nothing logged', future: 'still ahead',
}

function dayState(series: Series, d: DaySummary, today: string): DayState {
  if (d.date > today) return 'future'
  if (!series.logged(d)) return 'unlogged'
  const met = series.met(series.value(d), series.goal(d))
  if (d.date === today) {
    // A max already passed is a miss, a min already reached is a hit; anything else is still open.
    if (series.direction === 'stay under') return met ? 'pending' : 'missed'
    return met ? 'met' : 'pending'
  }
  return met ? 'met' : 'missed'
}

/** "Oct 3" */
const shortDate = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

interface RangeChartProps {
  series: Series
  view: RangeView
  today: string
  /** The day whose numbers the header is showing (Month view), if any. */
  selected: string | null
  /** A day was tapped. */
  onPick: (date: string) => void
}

/**
 * One series, a column per day.
 *
 * A week is BARS with the value printed on each: seven separate totals,
 * each against its own day's goal. A month is a LINE, where the shape over
 * time is the point; it breaks at days with nothing logged and stops at
 * today, so a missing day never reads as a crash to zero, and a tap on a
 * day puts its numbers in the header.
 *
 * Both draw the goal the same way: a line at each day's own target (higher
 * on training days), and a faint band on the side of it that counts as
 * good -- below a max, above a min -- so a bar or point inside the band is
 * a hit at a glance. Hits take the series colour; misses are rust, like an
 * over-the-max bar in Day view.
 *
 * The band, goal line and connecting line are one SVG stretched over the
 * plot (viewBox 0-100, `preserveAspectRatio="none"`). Bars, dots and
 * labels are HTML in a grid of day columns on top, so they keep their real
 * pixel sizes; each column is the day's button. Both use the same slot
 * math -- day i spans i/n to (i+1)/n -- so they line up.
 */
function RangeChart({ series, view, today, selected, onPick }: RangeChartProps) {
  const { days } = view
  const n = days.length
  const bars = n <= 7
  const under = series.direction === 'stay under'
  const goalOf = (d: DaySummary): number => (under ? series.goal(d).max : series.goal(d).min)
  // Headroom above the tallest thing, so a value label has somewhere to sit.
  const max = Math.max(...days.map(goalOf), ...days.map((d) => series.value(d)), 1) * (bars ? 1.22 : 1.1)
  const slot = 100 / n
  const yPct = (value: number): number => Math.min(100, Math.max(0, (value / max) * 100))
  const states = days.map((d) => dayState(series, d, today))
  const drawn = (s: DayState): boolean => s === 'met' || s === 'missed' || s === 'pending'

  // The line: one run per stretch of consecutive logged days.
  const runs: string[] = []
  if (!bars) {
    let run: string[] = []
    days.forEach((d, i) => {
      if (drawn(states[i]!)) run.push(`${(i + 0.5) * slot},${100 - yPct(series.value(d))}`)
      else if (run.length) { runs.push(run.join(' ')); run = [] }
    })
    if (run.length) runs.push(run.join(' '))
  }

  const picked = selected ? days.find((d) => d.date === selected) : undefined
  const pickedState = picked ? states[days.indexOf(picked)]! : null
  const average = series.average(view)

  return (
    <div className={`range-chart-wrap ${series.key}`}>
      <div className="range-chart-head">
        <span className="range-chart-dot" aria-hidden="true" />
        <span className="range-chart-label">{series.label}</span>
        <span className="goal-dir">{series.direction}</span>
        <span className="range-chart-readout" aria-live="polite">
          {picked && pickedState
            ? <>{shortDate(picked.date)} · {drawn(pickedState) || pickedState === 'unlogged' ? `${series.format(series.value(picked))} ${series.unit} · ` : ''}{VERDICT[pickedState]}</>
            : average > 0 && <>avg {series.format(average)} {series.unit}</>}
        </span>
      </div>
      <div className={`range-chart-plot${bars ? ' bars' : ''}`}>
        <svg className="range-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {days.map((d, i) => {
            const g = yPct(goalOf(d))
            if (g <= 0) return null
            return (
              <g key={d.date}>
                {/* The good side of the goal: under a max, over a min. */}
                <rect className="range-band" x={i * slot} width={slot} y={under ? 100 - g : 0} height={under ? g : 100 - g} />
                <line className="range-goal-mark" x1={i * slot} x2={(i + 1) * slot} y1={100 - g} y2={100 - g} />
              </g>
            )
          })}
          {/* A month: a faint rule where each week starts. */}
          {!bars && days.map((d, i) => (i > 0 && weekdayIndex(d.date) === 0
            ? <line key={d.date} className="range-week-rule" x1={i * slot} x2={i * slot} y1={0} y2={100} />
            : null))}
          {runs.map((points, i) => <polyline key={i} className="range-line" points={points} vectorEffect="non-scaling-stroke" />)}
        </svg>
        <div className="range-cols" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const state = states[i]!
            const value = series.value(d)
            const y = yPct(value)
            const label = state === 'future'
              ? `${d.date}: ${VERDICT.future}`
              : `${d.date}: ${series.format(value)} ${series.unit}, ${VERDICT[state]}`
            return (
              <button
                key={d.date}
                type="button"
                className={`range-col ${state}${d.date === today ? ' today' : ''}${d.date === selected ? ' selected' : ''}`}
                onClick={() => onPick(d.date)}
                aria-label={label}
                title={label}
              >
                {drawn(state) && (bars ? (
                  <>
                    <span className="range-bar" style={{ height: `${y}%` }} />
                    {/* Whole numbers on the bar; the exact value is in the label and Day view. */}
                    <span className="range-val" style={{ bottom: `calc(${y}% + 3px)` }}>{Math.round(value)}</span>
                  </>
                ) : (
                  <span className="range-dot" style={{ bottom: `${y}%` }} />
                ))}
              </button>
            )
          })}
        </div>
      </div>
      {/* Which day is which, under every chart: weekday and date for a week; each week's Sunday for a month. */}
      <div className="range-days" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }} aria-hidden="true">
        {days.map((d) => (
          <span key={d.date} className={d.date === today ? 'today' : ''}>
            {bars
              ? <>{WEEKDAYS[weekdayIndex(d.date)]} <span className="range-day-num">{Number(d.date.slice(8, 10))}</span></>
              : weekdayIndex(d.date) === 0 && Number(d.date.slice(8, 10))}
          </span>
        ))}
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
  kind: 'workout' | 'meditation' | 'dog'
  days: DaySummary[]
  today: string
  state: (d: DaySummary) => BoxState
  /** What the day had, for its label: "2 sits, 50 min". */
  describe: (d: DaySummary) => string
  onSelectDay: (date: string) => void
  /** Monday-first columns, for Train's Monday-to-Sunday weeks. */
  mondayFirst?: boolean
}

/**
 * One box per day, in Sunday-first weekday columns (Monday-first in Train) -- a week is one row, a
 * month a little calendar. A box is filled for a day that did it, half
 * filled for a day partway there (one sit of two), and empty otherwise;
 * days still ahead are drawn faint, so an unfilled future isn't read as a
 * miss. Tap a box to open that day.
 */
function DayBoxes({ kind, days, today, state, describe, onSelectDay, mondayFirst = false }: DayBoxesProps) {
  const first = days.length ? weekdayIndex(days[0]!.date) : 0
  const lead = mondayFirst ? (first + 6) % 7 : first
  const heads = mondayFirst ? [...WEEKDAYS.slice(1), WEEKDAYS[0]!] : WEEKDAYS
  return (
    <div className={`day-boxes ${kind}`}>
      {heads.map((w, i) => <span key={i} className="day-boxes-weekday" aria-hidden="true">{w}</span>)}
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
 * against each day's own goal (bars for a week, a line for a month), then a
 * scorecard of how many logged days met each goal, then water and alcohol.
 * Averages are explained in RangeView's own doc comment -- macros average
 * over days actually logged, water and alcohol over every day in the range.
 */
export default function RangeSummary({ view, onSelectDay, part = 'nutrition' }: RangeSummaryProps) {
  const { days, goals, dayTypes, scorecard, averages, loggedDays, totalDays, averagedDays, water, alcohol, workouts, meditation, dog } = view
  const today = localDate()
  const isWeek = days.length <= 7
  // Month view: the day whose numbers the chart headers show. Kept with the
  // range it was picked in, so stepping to another month starts with none.
  const [picked, setPicked] = useState<{ range: string; date: string } | null>(null)
  const selected = picked && picked.range === view.start ? picked.date : null
  // A week prints every value, so a tap goes straight to the day. A month's
  // first tap shows the day's numbers; a second tap on it opens the day.
  const pick = (date: string): void => {
    if (isWeek || selected === date) onSelectDay(date)
    else setPicked({ range: view.start, date })
  }
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
  const workoutKinds = workouts.kinds.map((k) => k.id).filter((k) => workouts.goalByKind[k] > 0 || workouts.byKind[k] > 0)

  return (
    <section className="range-summary" aria-label="Range summary">
      {part === 'nutrition' && (
        <>
      {(view.charts ?? DEFAULT_CHARTS).map((key) => SERIES[key]).map((series) => (
        <RangeChart key={series.key} series={series} view={view} today={today} selected={selected} onPick={pick} />
      ))}
      {!isWeek && (view.charts ?? DEFAULT_CHARTS).length > 0 && <div className="range-hint">Tap a day for its numbers; tap it again to open that day.</div>}
      <div className="range-coverage">
        Logged {loggedDays} of {plural(totalDays, 'day')} · {dayTypes.training} training, {dayTypes.rest} rest
        {averagedDays < totalDays && <> · averages over {plural(averagedDays, 'finished day')}</>}
      </div>

      <RangeNotes view={view} />

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

        </>
      )}

      {part === 'train' && (
        <>
      <section className="water-card" aria-label="Workouts">
        <div className="water-head">
          <span className="water-label">Workouts</span>
          <span className="water-num">
            {workouts.sessions} of {workouts.goal}
            <span className="water-goal"> planned</span>
          </span>
        </div>
        <DayBoxes
          mondayFirst={part === 'train'}
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
                <span className="plan-name">{kindView(workouts.kinds, k).label}</span>
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
          mondayFirst={part === 'train'}
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

      <section className="water-card" aria-label="Dog walks">
        <div className="water-head">
          <span className="water-label">Dog walks</span>
          <span className="water-num">
            {dog.of ? `${dog.met} of ${plural(dog.of, 'day')}` : '—'}
            <span className="water-goal"> · {plural(goals.dogWalks, 'walk')} a day</span>
          </span>
        </div>
        <DayBoxes
          mondayFirst={part === 'train'}
          kind="dog"
          days={days}
          today={today}
          // Every walk is a full box; some but not all of them, half.
          state={(d) => (dogWalksMet(d.dogWalks, d.goals.dogWalks) ? 'full' : d.dogWalks > 0 ? 'half' : 'empty')}
          describe={(d) => (d.dogWalks ? `${plural(d.dogWalks, 'walk')}, ${milesLabel(d.dogMiles)}` : 'no walks')}
          onSelectDay={onSelectDay}
        />
        <div className="water-bottles">
          {plural(dog.walks, 'walk')} · {milesLabel(dog.miles)}
          {dog.streak > 1 && ` · ${dog.streak}-day streak`}
        </div>
      </section>

      <BodyRangeCard body={view.body} />
        </>
      )}

      {part === 'nutrition' && alcohol.total > 0 && (
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
