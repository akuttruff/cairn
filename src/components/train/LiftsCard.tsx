import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import type { Lift, TrainingDay } from '../../types.ts'

interface LiftsCardProps {
  date: string
  day: TrainingDay
  onDay: (day: TrainingDay) => void
}

/** The heaviest planned set of a lift on the day, to say what a new PR changed. */
function topToday(day: TrainingDay, lift: string): { name: string; weight: number } | null {
  for (const s of day.sessions) {
    for (const i of s.items) {
      if (i.lift !== lift || !i.sets) continue
      const ws = i.sets.filter((x) => !x.attempt && x.weight !== null).map((x) => x.weight!)
      if (ws.length) return { name: i.name, weight: Math.max(...ws) }
    }
  }
  return null
}

/**
 * The PRs every percentage is taken of. Setting a new one recalculates the
 * whole schema's weights; the toast says what it did to today's.
 */
export default function LiftsCard({ date, day, onDay }: LiftsCardProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')

  const save = async (lift: Lift): Promise<void> => {
    const pr = Number(value)
    if (!(pr > 0)) { toast.error('Enter the PR in lb'); return }
    const before = topToday(day, lift.id)
    try {
      await api.setPr(lift.id, pr, date)
      const next = await api.training(date)
      onDay(next)
      setEditing(null)
      const after = topToday(next, lift.id)
      toast.success(before && after && before.weight !== after.weight
        ? `${lift.name} PR ${pr} lb: today's ${before.name.toLowerCase()} ${before.weight} → ${after.weight} lb`
        : `${lift.name} PR ${pr} lb: the plan's weights for it are recalculated`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (!day.lifts.length) return null
  return (
    <section className="water-card" aria-label="PRs">
      <div className="water-head"><span className="water-label">PRs</span><span className="water-goal">weights are % of these</span></div>
      <ul className="lift-list">
        {day.lifts.map((l) => (
          <li key={l.id} className="lift-row">
            <span className="lift-name">{l.name}</span>
            {editing === l.id ? (
              <span className="lift-edit">
                <input type="text" inputMode="decimal" aria-label={`${l.name} PR (lb)`} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
                <button type="button" className="link-btn accent" onClick={() => void save(l)}>Save</button>
                <button type="button" className="link-btn" onClick={() => setEditing(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <span className="lift-pr">{l.pr !== null ? `${l.pr} lb` : '—'}{l.prDate && <span className="lift-date"> {l.prDate}</span>}</span>
                <button type="button" className="icon-btn" aria-label={`Change ${l.name} PR`} onClick={() => { setValue(l.pr !== null ? String(l.pr) : ''); setEditing(l.id) }}>
                  <Pencil size={13} aria-hidden="true" />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
