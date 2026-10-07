import { useState } from 'react'
import { Bike, Dumbbell, Footprints, Flame, Minus, Pencil, PersonStanding, Plus, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { TRAINING_KINDS, localDate } from '../lib/nutrition.ts'
import { dayLabel } from '../lib/format.ts'
import { WORKOUT_KINDS } from '../types.ts'
import type { DayView, WorkoutKind, WorkoutLog, WorkoutPlan } from '../types.ts'

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

/** The weekday a session counts for, short enough for a chip: "M", "Tu", "Su". */
const WEEKDAY = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'Sa']
const weekday = (date: string): string => WEEKDAY[new Date(`${date}T00:00:00`).getDay()]!

/**
 * The week's workouts in one table, a row per activity. Each row carries the
 * sessions done as day chips (tap one to remove it), an empty pip for each
 * still planned, the count against the plan, and a + that logs one for the
 * day being viewed. The pencil adjusts this week's plan only; the default
 * stays in Settings for every other week.
 */
export default function WorkoutTracker({ date, workouts, onLogged }: WorkoutTrackerProps) {
  const { plan, weekByKind, weekTotal, weekGoal, planIsCustom, weekStart, weekSessions } = workouts
  const [draft, setDraft] = useState<WorkoutPlan | null>(null)
  const [busy, setBusy] = useState(false)
  /** The chip tapped: shown with Remove / Keep under its row. */
  const [confirming, setConfirming] = useState<WorkoutLog | null>(null)
  const pct = weekGoal > 0 ? Math.min(100, Math.round((weekTotal / weekGoal) * 100)) : 0
  const today = localDate()

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
      setConfirming(null)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const save = async (next: WorkoutPlan | null): Promise<void> => {
    setBusy(true)
    try {
      if (next) await api.setWeekPlan(weekStart, next)
      else await api.clearWeekPlan(weekStart)
      setDraft(null)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const step = (k: WorkoutKind, by: number): void =>
    setDraft((d) => d && { ...d, [k]: Math.max(0, Math.min(14, d[k] + by)) })

  return (
    <section className="water-card workout-card" aria-label="Workouts">
      <div className="water-head">
        <span className="water-label">
          Workouts · this week{planIsCustom && <span className="plan-tag">own plan</span>}
        </span>
        <span className="wk-head-right">
          <span className="water-num">
            {weekTotal}
            <span className="water-goal"> / {weekGoal}</span>
          </span>
          {!draft && (
            <button type="button" className="wk-edit" aria-label="Adjust this week" title="Adjust this week's plan" onClick={() => setDraft({ ...plan })}>
              <Pencil size={14} aria-hidden="true" />
            </button>
          )}
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
        <ul className="wk-list" aria-label="This week by activity">
          {WORKOUT_KINDS.map((k) => {
            const { label, Icon } = WORKOUTS[k]
            const goal = plan[k]
            const done = weekByKind[k]
            // Oldest first, so the chips read through the week left to right.
            const sessions = weekSessions.filter((s) => s.kind === k).reverse()
            const open = confirming && confirming.kind === k ? confirming : null
            return (
              <li key={k} className={`wk-item${goal === 0 && done === 0 ? ' unplanned' : ''}${goal > 0 && done >= goal ? ' met' : ''}`}>
                <div className="wk-row">
                  <Icon size={15} aria-hidden="true" className="wk-icon" />
                  <span className="wk-name">{label}</span>
                  <span className="wk-marks">
                    {sessions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`day-chip${s.date === today ? ' today' : ''}${open?.id === s.id ? ' open' : ''}`}
                        aria-label={`${label}, ${dayLabel(s.date)}`}
                        title={`${label}, ${dayLabel(s.date)} -- tap to remove`}
                        onClick={() => setConfirming(open?.id === s.id ? null : s)}
                      >
                        {weekday(s.date)}
                      </button>
                    ))}
                    {/* One empty pip for each planned session still to do. */}
                    {Array.from({ length: Math.max(0, goal - done) }, (_, i) => <span key={i} className="pip" aria-hidden="true" />)}
                  </span>
                  <span className="plan-count">{goal > 0 ? `${done} / ${goal}` : done || ''}</span>
                  <button type="button" className="wk-add" aria-label={`Log ${label}`} title={`Log ${label} for ${dayLabel(date)}`} onClick={() => void add(k)}>
                    <Plus size={16} aria-hidden="true" />
                  </button>
                </div>
                {open && (
                  <div className="wk-confirm" role="group" aria-label={`Remove ${label}?`}>
                    <span>
                      {label}, {dayLabel(open.date)}{open.minutes != null && ` · ${open.minutes} min`}
                    </span>
                    <button type="button" className="link-btn accent" onClick={() => setConfirming(null)}>Keep</button>
                    <button type="button" className="wk-remove" onClick={() => void remove(open.id)}>Remove</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
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
    </section>
  )
}
