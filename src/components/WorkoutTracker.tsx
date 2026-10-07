import { useState } from 'react'
import { Bike, Dumbbell, Footprints, Flame, Minus, PersonStanding, Plus, Sparkles, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { TRAINING_KINDS } from '../lib/nutrition.ts'
import { dayLabel } from '../lib/format.ts'
import { WORKOUT_KINDS } from '../types.ts'
import type { DayView, WorkoutKind, WorkoutPlan } from '../types.ts'

export const WORKOUTS: Record<WorkoutKind, { label: string; Icon: LucideIcon }> = {
  wod: { label: 'WOD', Icon: Flame },
  weightlifting: { label: 'Lifting', Icon: Dumbbell },
  run: { label: 'Run', Icon: Footprints },
  cycling: { label: 'Cycling', Icon: Bike },
  yoga: { label: 'Yoga', Icon: Sparkles },
  pilates: { label: 'Pilates', Icon: PersonStanding },
}

interface WorkoutTrackerProps {
  date: string
  workouts: DayView['workouts']
  onLogged: () => void
}

/**
 * The day's sessions, and the week's count against the weekly goal
 * (Sunday-start, today included) -- the week is the thing being aimed at,
 * like the alcohol cap but the other way round. Tapping a kind logs a
 * session. Minutes aren't asked for; any logged before are still shown.
 */
export default function WorkoutTracker({ date, workouts, onLogged }: WorkoutTrackerProps) {
  const add = async (kind: WorkoutKind): Promise<void> => {
    try {
      await api.addWorkout({ date, kind, minutes: null })
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

      {workouts.weekSessions.length > 0 && (
        // The week's sessions, not just this day's, each with its day, so any can be checked or removed.
        <ul className="session-list" aria-label="This week's sessions">
          {workouts.weekSessions.map((s) => {
            const { label, Icon } = WORKOUTS[s.kind] ?? { label: s.kind, Icon: Dumbbell }
            return (
              <li key={s.id} className="session-row">
                <Icon size={14} aria-hidden="true" />
                <span className="session-name">{label}</span>
                {s.minutes != null && <span className="session-min">{s.minutes} min</span>}
                {/* Which day it counts for, so a session is never mistaken for one logged today. */}
                <span className="session-day">{dayLabel(s.date)}</span>
                <button type="button" className="session-remove" aria-label={`Remove ${label}`} onClick={() => void remove(s.id)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <WeekPlan workouts={workouts} onChanged={onLogged} />

      <div className="workout-actions">
        {WORKOUT_KINDS.map((kind) => {
          const { label, Icon } = WORKOUTS[kind]
          return (
            <button key={kind} type="button" className="water-add workout-add" onClick={() => void add(kind)}>
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The week this day falls in, kind by kind: each planned activity's count
 * against its goal ("Yoga 2 / 4"), plus anything done that wasn't planned,
 * and the total. "Adjust this week" changes the plan for this week only;
 * the default stays in Settings for every other week.
 */
function WeekPlan({ workouts, onChanged }: { workouts: DayView['workouts']; onChanged: () => void }) {
  const [draft, setDraft] = useState<WorkoutPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const { plan, weekByKind, weekTotal, weekGoal, planIsCustom, weekStart } = workouts
  const shown = WORKOUT_KINDS.filter((k) => plan[k] > 0 || weekByKind[k] > 0)
  const pct = weekGoal > 0 ? Math.min(100, Math.round((weekTotal / weekGoal) * 100)) : 0

  const save = async (next: WorkoutPlan | null): Promise<void> => {
    setBusy(true)
    try {
      if (next) await api.setWeekPlan(weekStart, next)
      else await api.clearWeekPlan(weekStart)
      setDraft(null)
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const step = (k: WorkoutKind, by: number): void =>
    setDraft((d) => d && { ...d, [k]: Math.max(0, Math.min(14, d[k] + by)) })

  return (
    <div className="alcohol-week week-plan">
      <div className="water-head">
        <span className="water-label">
          This week{planIsCustom && <span className="plan-tag">own plan</span>}
        </span>
        <span className="water-num">
          {weekTotal}
          <span className="water-goal"> / {weekGoal}</span>
        </span>
      </div>
      <div
        className="bar workout"
        role="progressbar"
        aria-label="Workouts this week"
        aria-valuemin={0}
        aria-valuemax={weekGoal}
        aria-valuenow={weekTotal}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>

      {!draft && (
        <>
          <ul className="plan-list" aria-label="This week by activity">
            {shown.map((k) => {
              const { label, Icon } = WORKOUTS[k]
              const done = weekByKind[k]
              const goal = plan[k]
              return (
                <li key={k} className={`plan-row${goal > 0 && done >= goal ? ' met' : ''}`}>
                  <Icon size={14} aria-hidden="true" />
                  <span className="plan-name">{label}</span>
                  {/* One pip per planned session, filled as they're done. */}
                  <span className="plan-pips" aria-hidden="true">
                    {Array.from({ length: Math.max(goal, done) }, (_, i) => (
                      <span key={i} className={`pip${i < done ? ' done' : ''}${i >= goal ? ' extra' : ''}`} />
                    ))}
                  </span>
                  <span className="plan-count">{done} / {goal}</span>
                </li>
              )
            })}
          </ul>
          <button type="button" className="link-btn accent" onClick={() => setDraft({ ...plan })}>
            Adjust this week
          </button>
        </>
      )}

      {draft && (
        <div className="plan-editor" aria-label="This week's plan">
          {WORKOUT_KINDS.map((k) => (
            <div key={k} className="plan-edit-row">
              <span className="plan-name">{WORKOUTS[k].label}</span>
              <button type="button" className="stepper" aria-label={`Fewer ${WORKOUTS[k].label}`} onClick={() => step(k, -1)} disabled={draft[k] === 0}>
                <Minus size={14} aria-hidden="true" />
              </button>
              <span className="plan-value" aria-label={`${WORKOUTS[k].label} this week`}>{draft[k]}</span>
              <button type="button" className="stepper" aria-label={`More ${WORKOUTS[k].label}`} onClick={() => step(k, 1)}>
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
      )}
    </div>
  )
}
