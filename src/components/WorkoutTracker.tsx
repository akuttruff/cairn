import { useState } from 'react'
import { Bike, Dumbbell, Footprints, Flame, PersonStanding, Sparkles, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { parseNum } from '../lib/format.ts'
import { TRAINING_KINDS } from '../lib/nutrition.ts'
import { WORKOUT_KINDS } from '../types.ts'
import type { DayView, WorkoutKind } from '../types.ts'

export const WORKOUTS: Record<WorkoutKind, { label: string; Icon: LucideIcon }> = {
  wod: { label: 'WOD', Icon: Flame },
  weightlifting: { label: 'Lifting', Icon: Dumbbell },
  run: { label: 'Run', Icon: Footprints },
  walk: { label: 'Walk', Icon: PersonStanding },
  yoga: { label: 'Yoga', Icon: Sparkles },
  other: { label: 'Other', Icon: Bike },
}

interface WorkoutTrackerProps {
  date: string
  workouts: DayView['workouts']
  onLogged: () => void
}

/**
 * The day's sessions, and the week's count against the weekly goal
 * (Monday-start, today included) -- the week is the thing being aimed at,
 * like the alcohol cap but the other way round. Minutes are optional:
 * tapping a kind logs a session, with the minutes if any are typed.
 */
export default function WorkoutTracker({ date, workouts, onLogged }: WorkoutTrackerProps) {
  const [minutes, setMinutes] = useState('')
  const parsedMinutes = minutes.trim() ? parseNum(minutes) : null
  const badMinutes = minutes.trim() !== '' && (parsedMinutes == null || parsedMinutes <= 0)

  const add = async (kind: WorkoutKind): Promise<void> => {
    if (badMinutes) return
    try {
      await api.addWorkout({ date, kind, minutes: parsedMinutes })
      setMinutes('')
      if (TRAINING_KINDS.has(kind)) toast(`${WORKOUTS[kind].label} logged -- marked as a training day`)
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

  const weekPct = workouts.weekGoal > 0 ? Math.min(100, Math.round((workouts.weekTotal / workouts.weekGoal) * 100)) : 0
  const weekLeft = workouts.weekGoal - workouts.weekTotal

  return (
    <section className="water-card workout-card" aria-label="Workouts">
      <div className="water-head">
        <span className="water-label">Workouts</span>
        <span className="water-num">
          {workouts.sessions.length}
          <span className="water-goal">
            {' '}{workouts.sessions.length === 1 ? 'session' : 'sessions'}
            {workouts.minutes > 0 && ` · ${workouts.minutes} min`}
          </span>
        </span>
      </div>

      {workouts.sessions.length > 0 && (
        <ul className="session-list">
          {workouts.sessions.map((s) => {
            const { label, Icon } = WORKOUTS[s.kind] ?? WORKOUTS.other
            return (
              <li key={s.id} className="session-row">
                <Icon size={14} aria-hidden="true" />
                <span className="session-name">{label}</span>
                {s.minutes != null && <span className="session-min">{s.minutes} min</span>}
                <button type="button" className="session-remove" aria-label={`Remove ${label}`} onClick={() => void remove(s.id)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="alcohol-week">
        <div className="water-head">
          <span className="water-label">This week</span>
          <span className="water-num">
            {workouts.weekTotal}
            <span className="water-goal"> / {workouts.weekGoal}</span>
          </span>
        </div>
        <div
          className="bar workout"
          role="progressbar"
          aria-label="Workouts this week"
          aria-valuemin={0}
          aria-valuemax={workouts.weekGoal}
          aria-valuenow={workouts.weekTotal}
        >
          <div className="bar-fill" style={{ width: `${weekPct}%` }} />
        </div>
        <div className="cal-left">
          {weekLeft > 0 ? `${weekLeft} to go this week` : 'Weekly goal reached'}
        </div>
      </div>

      <div className="workout-minutes">
        <label htmlFor={`workout-minutes-${date}`}>Minutes (optional)</label>
        <input
          id={`workout-minutes-${date}`}
          type="text"
          inputMode="numeric"
          placeholder="—"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          aria-invalid={badMinutes}
        />
      </div>
      <div className="workout-actions">
        {WORKOUT_KINDS.map((kind) => {
          const { label, Icon } = WORKOUTS[kind]
          return (
            <button key={kind} type="button" className="water-add workout-add" onClick={() => void add(kind)} disabled={badMinutes}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
