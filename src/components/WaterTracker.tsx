import { Coffee, Droplets, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { DayView, Drink } from '../types.ts'

/** One bottle of water, and one mug of tea; both count toward the goal. */
const BOTTLE_OUNCES = 32
const MUG_OUNCES = 8

interface WaterTrackerProps {
  date: string
  water: DayView['water']
  onLogged: () => void
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export default function WaterTracker({ date, water, onLogged }: WaterTrackerProps) {
  const pct = water.goal > 0 ? Math.max(0, Math.min(1, water.ounces / water.goal)) * 100 : 0
  const bottles = Math.floor((water.ounces - water.tea) / BOTTLE_OUNCES)
  const mugs = Math.round(water.tea / MUG_OUNCES)
  const left = Math.max(0, Math.round(water.goal - water.ounces))
  const drunk = [plural(bottles, 'bottle'), ...(mugs ? [`${plural(mugs, 'mug')} of tea`] : [])].join(' + ')

  const add = async (ounces: number, drink: Drink): Promise<void> => {
    try {
      await api.addWater(date, ounces, drink)
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
      <div className="water-bottles">{drunk} · {left ? `${left} oz to go` : 'goal met'}</div>
      <div className="water-actions">
        <button type="button" className="water-add drink-add" onClick={() => void add(BOTTLE_OUNCES, 'water')}>
          <Droplets size={15} aria-hidden="true" />
          + Bottle (32oz)
        </button>
        <button type="button" className="water-add drink-add" onClick={() => void add(MUG_OUNCES, 'tea')}>
          <Coffee size={15} aria-hidden="true" />
          + Tea (8oz)
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
