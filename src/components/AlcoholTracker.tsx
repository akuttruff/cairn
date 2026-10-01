import { Beer, GlassWater, Undo2, Wine } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { ALCOHOL_KINDS } from '../types.ts'
import type { AlcoholKind, DayView } from '../types.ts'

const KINDS: Record<AlcoholKind, { label: string; Icon: LucideIcon }> = {
  beer: { label: 'Beer', Icon: Beer },
  wine: { label: 'Wine', Icon: Wine },
  liquor: { label: 'Liquor', Icon: GlassWater },
}

interface AlcoholTrackerProps {
  date: string
  alcohol: DayView['alcohol']
  onLogged: () => void
}

/**
 * Today's drinks are just a record -- no daily goal or bar, same as before.
 * The week they fall in is held to one, though (Monday-start, today
 * included): that's the actual thing being limited, not any one day.
 */
export default function AlcoholTracker({ date, alcohol, onLogged }: AlcoholTrackerProps) {
  const add = async (kind: AlcoholKind): Promise<void> => {
    try {
      await api.addAlcohol(date, kind)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const undo = async (): Promise<void> => {
    const id = alcohol.lastLogId
    if (!id) return
    try {
      await api.deleteAlcohol(id)
      onLogged()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const breakdown = ALCOHOL_KINDS.filter((k) => alcohol.byKind[k] > 0)
    .map((k) => `${alcohol.byKind[k]} ${KINDS[k].label.toLowerCase()}`)
    .join(' · ')

  const weekPct = alcohol.weekGoal > 0 ? Math.min(100, Math.round((alcohol.weekTotal / alcohol.weekGoal) * 100)) : 0
  const weekLeft = alcohol.weekGoal - alcohol.weekTotal
  const weekOver = weekLeft < 0

  return (
    <section className="water-card alcohol-card" aria-label="Alcohol">
      <div className="water-head">
        <span className="water-label">Alcohol</span>
        <span className="alcohol-summary">
          {alcohol.lastLogId && (
            <button type="button" className="water-undo" onClick={() => void undo()}>
              <Undo2 size={14} aria-hidden="true" />
              Undo
            </button>
          )}
          <span className="water-num">
            {alcohol.drinks}
            <span className="water-goal"> {alcohol.drinks === 1 ? 'drink' : 'drinks'}</span>
          </span>
        </span>
      </div>
      {breakdown && <div className="water-bottles" style={{ marginTop: 0 }}>{breakdown}</div>}

      <div className="alcohol-week">
        <div className="water-head">
          <span className="water-label">This week</span>
          <span className="water-num">
            {alcohol.weekTotal}
            <span className="water-goal"> / {alcohol.weekGoal}</span>
          </span>
        </div>
        <div
          className={`bar alcohol${weekOver ? ' over' : ''}`}
          role="progressbar"
          aria-label="Drinks this week"
          aria-valuemin={0}
          aria-valuemax={alcohol.weekGoal}
          aria-valuenow={alcohol.weekTotal}
        >
          <div className="bar-fill" style={{ width: `${weekPct}%` }} />
        </div>
        <div className={`cal-left${weekOver ? ' over' : ''}`}>
          {weekOver ? `${-weekLeft} over this week` : `${weekLeft} left this week`}
        </div>
      </div>

      <div className="water-actions">
        {ALCOHOL_KINDS.map((kind) => {
          const { label, Icon } = KINDS[kind]
          return (
            <button key={kind} type="button" className="water-add alcohol-add" onClick={() => void add(kind)}>
              <Icon size={15} aria-hidden="true" />
              + {label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
