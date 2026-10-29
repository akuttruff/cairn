import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { kindView } from '../../lib/workoutIcons.ts'
import type { DayView, WorkoutKind } from '../../types.ts'

interface ExtraWorkoutsProps {
  date: string
  workouts: DayView['workouts']
  onLogged: () => void
}

/**
 * A workout that isn't on the plan -- a class, an extra ride -- logged with
 * one tap, under the plan's own sessions. The day's hand-added ones are
 * listed to take back. The week's counts against its goals are on Week.
 */
export default function ExtraWorkouts({ date, workouts, onLogged }: ExtraWorkoutsProps) {
  const { kinds, sessions, fromPlan } = workouts
  const extras = sessions.filter((s) => !fromPlan.includes(s.id)).reverse()

  const add = async (kind: WorkoutKind): Promise<void> => {
    try {
      await api.addWorkout({ date, kind, minutes: null })
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const remove = async (id: string): Promise<void> => {
    try {
      await api.deleteWorkout(id)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section className="water-card extra-workouts" aria-label="Not on the plan">
      <div className="water-head">
        <span className="water-label">Not on the plan?</span>
      </div>
      <div className="chips extra-chips">
        {kinds.map(({ id }) => {
          const { label } = kindView(kinds, id)
          return (
            <button key={id} type="button" className="chip" aria-label={`Log ${label}`} onClick={() => void add(id)}>
              <Plus size={12} aria-hidden="true" /> {label}
            </button>
          )
        })}
      </div>
      {extras.length > 0 && (
        <ul className="extra-list" aria-label="Added by hand">
          {extras.map((w) => {
            const { label, Icon } = kindView(kinds, w.kind)
            return (
              <li key={w.id}>
                <Icon size={15} aria-hidden="true" className="wk-icon" />
                <span className="extra-name">{label}{w.minutes != null && ` · ${w.minutes} min`}</span>
                <button type="button" className="extra-remove" aria-label={`Remove ${label}`} onClick={() => void remove(w.id)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
