import { useEffect, useState } from 'react'
import { Repeat } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { localDate } from '../../lib/nutrition.ts'
import useTraining from '../../hooks/useTraining.ts'
import SessionCard from './SessionCard.tsx'
import LiftsCard from './LiftsCard.tsx'
import ProgressCard from './ProgressCard.tsx'
import SchemaCard from './SchemaCard.tsx'
import type { WorkoutKindDef } from '../../types.ts'

interface TrainViewProps {
  date: string
  active: boolean
  onSelectDate: (date: string) => void
  /** Something logged here changes the Day view's workout dots. */
  onLogged: () => void
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The Train tab: the active training schema's sessions for the day, set by
 * set, with the week around it, the PRs the weights come from, progress,
 * and the next schema.
 */
export default function TrainView({ date, active, onSelectDate, onLogged }: TrainViewProps) {
  const training = useTraining(date, active)
  const [kinds, setKinds] = useState<WorkoutKindDef[]>([])
  const day = training.day

  useEffect(() => {
    if (active) api.settings().then((s) => setKinds(s.workoutKinds ?? []), () => { /* icons fall back */ })
  }, [active])

  const onDay = (next: typeof day): void => {
    if (!next) return
    training.setDay(next)
    onLogged()
  }

  const repeat = async (): Promise<void> => {
    if (!day?.week && day?.week !== 0) return
    if (!window.confirm(`Do week ${day.week} again next week? Every later week moves back by a week.`)) return
    try {
      training.setDay(await api.repeatWeek(date))
      toast.success(`Week ${day.week} again next week`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (training.error && !day) {
    return (
      <div className="error-card" role="alert">
        Couldn&apos;t load the plan: {training.error}
        <button type="button" onClick={() => void training.refresh()}>Retry</button>
      </div>
    )
  }
  if (!day) return null
  if (!day.schema) {
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

  const today = localDate()
  const total = day.schema.weeks
  return (
    <>
      <section className="water-card train-head" aria-label="This week">
        <div className="water-head">
          <span className="water-label">{day.schema.name}</span>
          {day.week !== null && (
            <span className="train-week">
              {day.week === 0 ? 'Intro week' : `Week ${day.week} of ${total}`}
              {day.deload && <span className="badge">deload</span>}
              {day.test && <span className="badge test">test</span>}
              {day.repeat && <span className="badge">repeat</span>}
            </span>
          )}
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
        {day.week !== null && (
          <button type="button" className="link-btn accent train-repeat" onClick={() => void repeat()}>
            <Repeat size={13} aria-hidden="true" /> Repeat this week
          </button>
        )}
      </section>

      {day.week === null && <div className="water-card hint">This day is outside {day.schema.name} ({day.schema.startDate} to {day.schema.endDate}).</div>}
      {day.week !== null && !day.sessions.length && <div className="water-card hint rest-day">Nothing on the plan today. Rest, or something gentle.</div>}
      {day.sessions.map((s) => (
        <SessionCard key={s.id} date={date} session={s} kinds={kinds} onDay={onDay} onShuffle={() => training.setShuffle(training.shuffle + 1)} />
      ))}

      <LiftsCard date={date} day={day} onDay={onDay} />
      <ProgressCard />
      <SchemaCard day={day} onChanged={() => void training.refresh()} />
    </>
  )
}
