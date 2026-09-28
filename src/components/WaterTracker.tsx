import { Droplets, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { DayView } from '../types.ts'

/** One bottle: the user's actual daily habit is 3 of these (96oz). */
const BOTTLE_OUNCES = 32

interface WaterTrackerProps {
  date: string
  water: DayView['water']
  onLogged: () => void
}

export default function WaterTracker({ date, water, onLogged }: WaterTrackerProps) {
  const pct = water.goal > 0 ? Math.max(0, Math.min(1, water.ounces / water.goal)) * 100 : 0
  const bottlesLogged = Math.floor(water.ounces / BOTTLE_OUNCES)
  const bottlesGoal = Math.round(water.goal / BOTTLE_OUNCES)

  const addBottle = async (): Promise<void> => {
    try {
      await api.addWater(date, BOTTLE_OUNCES)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const undo = async (): Promise<void> => {
    const id = water.lastLogId
    if (!id) return
    try {
      await api.deleteWater(id)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <section className="water-card" aria-label="Water">
      <div className="water-head">
        <span className="water-label">Water</span>
        <span className="water-num">
          {Math.round(water.ounces)}
          <span className="water-goal"> / {Math.round(water.goal)} oz</span>
        </span>
      </div>
      <div
        className="bar water"
        role="progressbar"
        aria-label="Water"
        aria-valuemin={0}
        aria-valuemax={Math.round(water.goal)}
        aria-valuenow={Math.round(water.ounces)}
      >
        <div className="bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="water-bottles">{bottlesLogged} of {bottlesGoal} bottles (32oz each)</div>
      <div className="water-actions">
        <button type="button" className="water-add" onClick={() => void addBottle()}>
          <Droplets size={15} aria-hidden="true" />
          + Bottle (32oz)
        </button>
        {water.lastLogId && (
          <button type="button" className="water-undo" onClick={() => void undo()}>
            <Undo2 size={14} aria-hidden="true" />
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
