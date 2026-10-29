import { useState } from 'react'
import { Minus, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import type { DayView, WorkoutKind, WorkoutPlan } from '../../types.ts'

interface WeekGoalsProps {
  workouts: DayView['workouts']
  onSaved: () => void
}

/**
 * This week's workout goals, activity by activity, adjusted for this week
 * only; the default stays in Settings for every other week.
 */
export default function WeekGoals({ workouts, onSaved }: WeekGoalsProps) {
  const { kinds, plan, planIsCustom, weekStart } = workouts
  const [draft, setDraft] = useState<WorkoutPlan | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (next: WorkoutPlan | null): Promise<void> => {
    setBusy(true)
    try {
      if (next) await api.setWeekPlan(weekStart, next)
      else await api.clearWeekPlan(weekStart)
      setDraft(null)
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const step = (k: WorkoutKind, by: number): void =>
    setDraft((d) => d && { ...d, [k]: Math.max(0, Math.min(14, (d[k] ?? 0) + by)) })

  if (!draft) {
    return (
      <div className="week-goals">
        <button type="button" className="link-btn accent" aria-label="Adjust this week" onClick={() => setDraft({ ...plan })}>
          <Pencil size={13} aria-hidden="true" /> This week&apos;s goals
        </button>
        {planIsCustom && <span className="plan-tag">own plan</span>}
      </div>
    )
  }
  return (
    <div className="plan-editor week-goals-editor" aria-label="This week's plan">
      {kinds.map(({ id: k, label }) => (
        <div key={k} className="plan-edit-row">
          <span className="plan-name">{label}</span>
          <button type="button" className="stepper" aria-label={`Fewer ${label}`} onClick={() => step(k, -1)} disabled={(draft[k] ?? 0) === 0}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <span className="plan-value" aria-label={`${label} this week`}>{draft[k] ?? 0}</span>
          <button type="button" className="stepper" aria-label={`More ${label}`} onClick={() => step(k, 1)}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <div className="plan-actions">
        {planIsCustom && (
          <button type="button" className="link-btn accent" onClick={() => void save(null)} disabled={busy}>Use the default</button>
        )}
        <span className="spacer" />
        <button type="button" className="link-btn accent" onClick={() => setDraft(null)}>Cancel</button>
        <button type="button" className="plan-save" onClick={() => void save(draft)} disabled={busy}>Save for this week</button>
      </div>
    </div>
  )
}
