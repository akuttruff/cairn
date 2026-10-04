import { BODY_METRICS } from '../types.ts'
import type { BodyMetric, DayView, RangeView } from '../types.ts'

const LB_PER_KG = 2.20462262

/** How each reading is shown: weights in lb (stored in kg), body fat in percent. */
const METRICS: Record<BodyMetric, { label: string; unit: string; show: (v: number) => number; digits: number }> = {
  weight: { label: 'Weight', unit: 'lb', show: (v) => v * LB_PER_KG, digits: 1 },
  bodyFat: { label: 'Body fat', unit: '%', show: (v) => v, digits: 1 },
  leanMass: { label: 'Lean mass', unit: 'lb', show: (v) => v * LB_PER_KG, digits: 1 },
  bmi: { label: 'BMI', unit: '', show: (v) => v, digits: 1 },
}

const num = (metric: BodyMetric, v: number): string => METRICS[metric].show(v).toFixed(METRICS[metric].digits)
/** A change with its sign: "+0.4", "−1.2", "no change". */
const delta = (metric: BodyMetric, change: number): string => {
  const shown = METRICS[metric].show(change)
  const rounded = Number(shown.toFixed(METRICS[metric].digits))
  if (rounded === 0) return 'no change'
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(METRICS[metric].digits)}`
}
const shortDate = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/**
 * The latest reading of each kind as of this day, from the scale via Apple
 * Health. Nothing to log here by hand: the phone's Shortcut sends them.
 * Hidden until the first reading arrives.
 */
export default function BodyCard({ date, body }: { date: string; body: DayView['body'] | undefined }) {
  const shown = BODY_METRICS.filter((m) => body?.[m])
  if (!body || !shown.length) return null
  return (
    <section className="water-card body-card" aria-label="Body">
      <div className="water-head">
        <span className="water-label">Body</span>
      </div>
      <div className="body-grid">
        {shown.map((m) => {
          const r = body[m]!
          return (
            <div key={m} className="body-stat">
              <span className="body-name">{METRICS[m].label}</span>
              <span className="body-value">
                {num(m, r.value)}<span className="water-goal">{METRICS[m].unit && ` ${METRICS[m].unit}`}</span>
              </span>
              <span className="body-note">
                {r.change != null && <>{delta(m, r.change)} · </>}
                {r.date === date ? 'today' : shortDate(r.date)}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Week or month: each kind's first and last reading in the range, and the change between. */
export function BodyRangeCard({ body }: { body: RangeView['body'] | undefined }) {
  const shown = BODY_METRICS.filter((m) => body?.[m])
  if (!body || !shown.length) return null
  return (
    <section className="water-card body-card" aria-label="Body">
      <div className="water-head">
        <span className="water-label">Body</span>
      </div>
      <div className="body-grid">
        {shown.map((m) => {
          const r = body[m]!
          return (
            <div key={m} className="body-stat">
              <span className="body-name">{METRICS[m].label}</span>
              <span className="body-value">
                {num(m, r.last)}<span className="water-goal">{METRICS[m].unit && ` ${METRICS[m].unit}`}</span>
              </span>
              <span className="body-note">
                {r.count > 1 ? `${delta(m, r.change)} from ${num(m, r.first)}` : 'one reading'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
