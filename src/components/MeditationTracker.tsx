import { Leaf, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { DayView } from '../types.ts'

/** One tap per sit; most are one of these lengths. */
const QUICK_MINUTES = [5, 10, 20]

interface MeditationTrackerProps {
  date: string
  meditation: DayView['meditation']
  onLogged: () => void
}

/** The day's minutes against the daily goal, logged a sit at a time -- like water, bottle by bottle. */
export default function MeditationTracker({ date, meditation, onLogged }: MeditationTrackerProps) {
  const pct = meditation.goal > 0 ? Math.max(0, Math.min(1, meditation.minutes / meditation.goal)) * 100 : 0
  const sits = meditation.sessions.length

  const add = async (minutes: number): Promise<void> => {
    try {
      await api.addMeditation({ date, minutes })
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const undo = async (): Promise<void> => {
    const id = meditation.lastLogId
    if (!id) return
    try {
      await api.deleteMeditation(id)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section className="water-card meditation-card" aria-label="Meditation">
      <div className="water-head">
        <span className="water-label">Meditation</span>
        <span className="water-num">
          {meditation.minutes}
          <span className="water-goal"> / {meditation.goal} min</span>
        </span>
      </div>
      <div
        className="bar meditation"
        role="progressbar"
        aria-label="Meditation"
        aria-valuemin={0}
        aria-valuemax={meditation.goal}
        aria-valuenow={meditation.minutes}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {sits > 0 && <div className="water-bottles">{sits} {sits === 1 ? 'sit' : 'sits'} today</div>}
      <div className="water-actions">
        {QUICK_MINUTES.map((m) => (
          <button key={m} type="button" className="water-add meditation-add" onClick={() => void add(m)}>
            <Leaf size={14} aria-hidden="true" />
            + {m} min
          </button>
        ))}
        {meditation.lastLogId && (
          <button type="button" className="water-undo" onClick={() => void undo()}>
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
