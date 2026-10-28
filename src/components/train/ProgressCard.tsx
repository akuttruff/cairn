import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api.ts'
import type { ProgressSeries } from '../../types.ts'

/**
 * One line over time, drawn like the range charts (a 0-100 box stretched
 * to fit, strokes that don't stretch with it). Needs two points to be a line.
 */
function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = hi - lo || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${95 - ((v - lo) / span) * 90}`).join(' ')
  return (
    <svg className="spark" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline className="spark-line" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Top sets and estimated maxes per lift, and the baselines (dead hang, banded pull-ups), fetched when opened. */
export default function ProgressCard() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<ProgressSeries | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (): void => {
    const next = !open
    setOpen(next)
    if (next) api.trainingProgress().then((d) => { setData(d); setError(null) }, (err: Error) => setError(err.message))
  }

  const lifts = data?.lifts.filter((l) => l.points.length) ?? []
  return (
    <section className="water-card" aria-label="Progress">
      <button type="button" className="water-head card-toggle" aria-expanded={open} onClick={toggle}>
        <span className="water-label">Progress</span>
        {open ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
      </button>
      {open && error && <div className="hint bad">{error}</div>}
      {open && data && !lifts.length && !data.baselines.length && <div className="hint">Log some sets and this fills in.</div>}
      {open && lifts.map((l) => {
        const last = l.points[l.points.length - 1]!
        const best = Math.max(...l.points.map((p) => p.e1rm))
        return (
          <div key={l.id} className="progress-row">
            <div className="progress-head">
              <span>{l.name}</span>
              <span className="plan-item-meta">top {last.weight}×{last.reps} · est. max {best} lb{l.pr !== null ? ` · PR ${l.pr}` : ''}</span>
            </div>
            <Sparkline values={l.points.map((p) => p.e1rm)} label={`${l.name} estimated max over time`} />
          </div>
        )
      })}
      {open && data?.baselines.map((b) => {
        const values = b.points.map((p) => p.value)
        return (
          <div key={b.itemId} className="progress-row">
            <div className="progress-head">
              <span>{b.name}</span>
              <span className="plan-item-meta">latest {values[values.length - 1]}{b.unit === 's' ? ' s' : ' reps'} · best {Math.max(...values)}</span>
            </div>
            <Sparkline values={values} label={`${b.name} over time`} />
          </div>
        )
      })}
    </section>
  )
}
