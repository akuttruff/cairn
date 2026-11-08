import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { kindView } from '../../lib/workoutIcons.ts'
import type { TrainingDay, WorkoutKindDef } from '../../types.ts'

/** The gentle activities this card offers, when Settings has them. */
const GENTLE = ['yoga', 'pilates']
const MINUTES = [15, 20, 30, 45]
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Props {
  date: string
  kinds: WorkoutKindDef[]
  onDay: (day: TrainingDay) => void
}

/**
 * Put an optional yoga or pilates session on the day: just this day (it
 * shows in the day's changes, where × takes it back), or on this weekday
 * every week from here to the end of the plan. Optional, so the day still
 * counts as done without it.
 */
export default function AddOptional({ date, kinds, onDay }: Props) {
  const offered = GENTLE.flatMap((id) => kinds.filter((k) => k.id === id))
  const [kind, setKind] = useState<string | null>(null)
  const [minutes, setMinutes] = useState(20)
  const [every, setEvery] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!offered.length) return null
  const weekday = WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]!
  const chosen = offered.find((k) => k.id === kind)

  const add = async (): Promise<void> => {
    if (!chosen) return
    setBusy(true)
    try {
      onDay(await api.addOptionalSession(date, chosen.id, minutes, every))
      toast.success(every ? `${chosen.label} every ${weekday}` : `${chosen.label} added`)
      setKind(null)
      setEvery(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="water-card add-optional" aria-label="Add an optional session">
      <div className="water-head"><span className="water-label"><Plus size={12} aria-hidden="true" /> Add something gentle</span></div>
      <div className="chips" role="group" aria-label="Activity">
        {offered.map((k) => {
          const { Icon } = kindView(kinds, k.id)
          return (
            <button key={k.id} type="button" className={`chip${kind === k.id ? ' on' : ''}`} aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
              <Icon size={13} aria-hidden="true" /> {k.label}
            </button>
          )
        })}
      </div>
      {chosen && (
        <>
          <div className="chips" role="group" aria-label="How long">
            {MINUTES.map((m) => (
              <button key={m} type="button" className={`chip${minutes === m ? ' on' : ''}`} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>{m} min</button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="When">
            <button type="button" className={`chip${!every ? ' on' : ''}`} aria-pressed={!every} onClick={() => setEvery(false)}>This day</button>
            <button type="button" className={`chip${every ? ' on' : ''}`} aria-pressed={every} onClick={() => setEvery(true)}>Every {weekday}</button>
          </div>
          <button type="button" className="coach-apply" disabled={busy} onClick={() => void add()}>
            {busy ? 'Adding…' : `Add ${minutes} min of ${chosen.label.toLowerCase()}`}
          </button>
          <p className="hint">Optional: the day counts as done without it.{every ? ' From this week to the end of the plan; ask the coach to take it off again.' : ''}</p>
        </>
      )}
    </section>
  )
}
