import { Leaf, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { DayView } from '../types.ts'

/** Every sit is this long, so logging one is a single tap. */
export const SIT_MINUTES = 25

interface MeditationTrackerProps {
  date: string
  meditation: DayView['meditation']
  onLogged: () => void
}

/** The day's minutes against the daily goal, logged a sit at a time -- like water, bottle by bottle. */
export default function MeditationTracker({ date, meditation, onLogged }: MeditationTrackerProps) {
  const pct = meditation.goal > 0 ? Math.max(0, Math.min(1, meditation.minutes / meditation.goal)) * 100 : 0
  const sits = meditation.sessions.length
  // The goal is kept in minutes (Settings); every sit is SIT_MINUTES, so it reads as a count of sits.
  const goalSits = Math.max(1, Math.round(meditation.goal / SIT_MINUTES))

  const add = async (): Promise<void> => {
    try {
      await api.addMeditation({ date, minutes: SIT_MINUTES })
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
          {sits}
          <span className="water-goal"> / {goalSits} {goalSits === 1 ? 'sit' : 'sits'}</span>
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
      <div className="water-bottles">{meditation.minutes} of {meditation.goal} min</div>
      <div className="water-actions">
        <button type="button" className="water-add meditation-add" onClick={() => void add()}>
          <Leaf size={14} aria-hidden="true" />
          + {SIT_MINUTES}-min sit
        </button>
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
