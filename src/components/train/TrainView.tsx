import { useEffect, useState } from 'react'
import { Check, MessageCircle, Repeat, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { localDate } from '../../lib/nutrition.ts'
import { dayLabel } from '../../lib/format.ts'
import type { TrainingState } from '../../hooks/useTraining.ts'
import SessionCard from './SessionCard.tsx'
import LiftsCard from './LiftsCard.tsx'
import ProgressCard from './ProgressCard.tsx'
import SchemaCard from './SchemaCard.tsx'
import type { TrainingDay, WorkoutKindDef } from '../../types.ts'

/**
 * The Train section's views, all on the active training schema: Today (the
 * day's sessions, set by set), Week (what the week planned and what got
 * done) and Block (the whole schema, PRs, progress and the next schema).
 * They share one fetch of the day, held by App.
 */

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** The shared top: no schema, or the fetch failed, or still loading. Null when there's a day to show. */
function Pending({ training }: { training: TrainingState }) {
  if (training.error && !training.day) {
    return (
      <div className="error-card" role="alert">
        Couldn&apos;t load the plan: {training.error}
        <button type="button" onClick={() => void training.refresh()}>Retry</button>
      </div>
    )
  }
  if (!training.day) return null
  return (
    <section className="water-card" aria-label="Training schema">
      <div className="water-head"><span className="water-label">Train</span></div>
      <p className="hint">
        No training schema yet. A schema is a plan in Cairn&apos;s training-schema format (see docs/training-schema.md);
        import one on the computer running Cairn with <code>npm run import:schema -- plan.json</code>.
      </p>
    </section>
  )
}

function useKinds(active: boolean): WorkoutKindDef[] {
  const [kinds, setKinds] = useState<WorkoutKindDef[]>([])
  useEffect(() => {
    if (active) api.settings().then((s) => setKinds(s.workoutKinds ?? []), () => { /* icons fall back */ })
  }, [active])
  return kinds
}

interface TodayProps {
  date: string
  training: TrainingState
  onSelectDate: (date: string) => void
  /** Something logged here changes the day's workout dots. */
  onLogged: () => void
  onCoach: () => void
}

export function TrainToday({ date, training, onSelectDate, onLogged, onCoach }: TodayProps) {
  const kinds = useKinds(true)
  const day = training.day
  if (!day?.schema) return <Pending training={training} />

  const onDay = (next: TrainingDay): void => {
    training.setDay(next)
    onLogged()
  }
  const repeat = async (): Promise<void> => {
    if (day.week === null) return
    if (!window.confirm(`Do week ${day.week} again next week? Every later week moves back by a week.`)) return
    try {
      training.setDay(await api.repeatWeek(date))
      toast.success(`Week ${day.week} again next week`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const undoAdjustment = async (id: string): Promise<void> => {
    try {
      await api.removeAdjustment(id)
      await training.refresh()
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const today = localDate()
  return (
    <>
      <section className="water-card train-head" aria-label="This week">
        <div className="water-head">
          <span className="water-label">{day.schema.name}</span>
          <WeekBadge day={day} />
        </div>
        <div className="train-strip" role="group" aria-label="This week's days">
          {day.strip.map((d, i) => {
            const done = d.sessions.length > 0 && d.sessions.every((s) => s.done)
            const started = d.sessions.some((s) => s.started)
            return (
              <button
                key={d.date}
                type="button"
                className={`strip-day${d.date === date ? ' selected' : ''}${d.date === today ? ' today' : ''}`}
                aria-label={`${d.date}: ${d.sessions.map((s) => s.title).join(', ') || 'rest'}${done ? ', done' : started ? ', started' : ''}`}
                aria-current={d.date === date ? 'date' : undefined}
                onClick={() => onSelectDate(d.date)}
              >
                <span className="strip-wd">{WEEKDAYS[i]}</span>
                <span className="strip-n">{Number(d.date.slice(8))}</span>
                <span className={`strip-dot${done ? ' done' : started ? ' started' : d.sessions.length ? '' : ' rest'}`} aria-hidden="true" />
              </button>
            )
          })}
        </div>
        <div className="train-head-actions">
          <button type="button" className="coach-btn" onClick={onCoach}>
            <MessageCircle size={15} aria-hidden="true" /> Coach
          </button>
          {day.week !== null && (
            <button type="button" className="link-btn accent train-repeat" onClick={() => void repeat()}>
              <Repeat size={13} aria-hidden="true" /> Repeat this week
            </button>
          )}
        </div>
        {day.adjustments.length > 0 && (
          <ul className="adjustments" aria-label="Changes from the coach">
            {day.adjustments.map((a) => (
              <li key={a.id}>
                <span>{a.text}</span>
                <button type="button" className="icon-btn" aria-label={`Undo: ${a.text}`} onClick={() => void undoAdjustment(a.id)}>
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {day.week === null && <div className="water-card hint">This day is outside {day.schema.name} ({day.schema.startDate} to {day.schema.endDate}).</div>}
      {day.week !== null && !day.sessions.length && <div className="water-card hint rest-day">Nothing on the plan today. Rest, or something gentle.</div>}
      {day.sessions.map((s) => (
        <SessionCard key={s.id} date={date} session={s} kinds={kinds} onDay={onDay} onShuffle={() => training.setShuffle(training.shuffle + 1)} />
      ))}
    </>
  )
}

function WeekBadge({ day }: { day: TrainingDay }) {
  if (day.week === null || !day.schema) return null
  return (
    <span className="train-week">
      {day.week === 0 ? 'Intro week' : `Week ${day.week} of ${day.schema.weeks}`}
      {day.deload && <span className="badge">deload</span>}
      {day.test && <span className="badge test">test</span>}
      {day.repeat && <span className="badge">repeat</span>}
    </span>
  )
}

interface WeekProps {
  training: TrainingState
  /** Open a day in Today. */
  onSelectDay: (date: string) => void
}

/** Monday to Sunday: each day's sessions, and which got done. */
export function TrainWeek({ training, onSelectDay }: WeekProps) {
  const day = training.day
  if (!day?.schema) return <Pending training={training} />
  const today = localDate()
  return (
    <section className="water-card" aria-label="The week's plan">
      <div className="water-head">
        <span className="water-label">The plan</span>
        <WeekBadge day={day} />
      </div>
      <ul className="week-plan">
        {day.strip.map((d) => (
          <li key={d.date}>
            <button type="button" className={`week-plan-day${d.date === today ? ' today' : ''}`} onClick={() => onSelectDay(d.date)} aria-label={`Open ${dayLabel(d.date, today)}`}>
              <span className="week-plan-date">{dayLabel(d.date, today)}</span>
              <span className="week-plan-sessions">
                {d.sessions.length === 0 && <span className="week-plan-rest">Rest</span>}
                {d.sessions.map((s) => (
                  <span key={s.id} className={`week-plan-session${s.done ? ' done' : s.started ? ' started' : ''}`}>
                    {s.done && <Check size={12} aria-hidden="true" />} {s.title}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

interface BlockProps {
  date: string
  training: TrainingState
  onLogged: () => void
  onCoach: () => void
}

/** The schema as a whole: PRs, progress, the plan week by week, and the next one. */
export function TrainBlock({ date, training, onLogged, onCoach }: BlockProps) {
  const day = training.day
  if (!day?.schema) return <Pending training={training} />
  return (
    <>
      <button type="button" className="water-card coach-teaser" onClick={onCoach}>
        <MessageCircle size={16} aria-hidden="true" />
        <span>Ask the coach about this plan, or for a change to it</span>
      </button>
      <LiftsCard date={date} day={day} onDay={(next) => { training.setDay(next); onLogged() }} />
      <ProgressCard />
      <SchemaCard day={day} onChanged={() => void training.refresh()} />
    </>
  )
}
