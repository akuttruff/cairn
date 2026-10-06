import { Dog, PawPrint, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { DayView } from '../types.ts'

interface DogWalkTrackerProps {
  date: string
  dog: DayView['dog']
  onLogged: () => void
}

/** "1 mile", "1.5 miles". */
export const milesLabel = (miles: number): string => `${Number(miles.toFixed(1))} ${miles === 1 ? 'mile' : 'miles'}`

/**
 * The dog's walks today against the walks-per-day goal, one tap a walk --
 * like meditation, sit by sit. Each walk is the usual length from Settings.
 */
export default function DogWalkTracker({ date, dog, onLogged }: DogWalkTrackerProps) {
  const done = dog.walks.length
  const pct = dog.goal > 0 ? Math.max(0, Math.min(1, done / dog.goal)) * 100 : 0

  const add = async (): Promise<void> => {
    try {
      await api.addDogWalk({ date })
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const undo = async (): Promise<void> => {
    const id = dog.lastLogId
    if (!id) return
    try {
      await api.deleteDogWalk(id)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section className="water-card dog-card" aria-label="Dog walks">
      <div className="water-head">
        <span className="water-label">
          <Dog size={15} aria-hidden="true" className="dog-label-icon" />
          Dog walks
        </span>
        <span className="water-num">
          {done}
          <span className="water-goal"> / {dog.goal} {dog.goal === 1 ? 'walk' : 'walks'}</span>
        </span>
      </div>
      <div
        className="bar dog"
        role="progressbar"
        aria-label="Dog walks"
        aria-valuemin={0}
        aria-valuemax={dog.goal}
        aria-valuenow={done}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="water-bottles">{done ? `${milesLabel(dog.miles)} today` : 'No walks yet today'}</div>
      <div className="water-actions">
        <button type="button" className="water-add dog-add" onClick={() => void add()}>
          <PawPrint size={14} aria-hidden="true" />
          + {milesLabel(dog.walkMiles).replace(' ', '-').replace(/s$/, '')} walk
        </button>
        {dog.lastLogId && (
          <button type="button" className="water-undo" onClick={() => void undo()}>
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
