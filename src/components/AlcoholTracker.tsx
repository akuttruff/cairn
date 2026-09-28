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

/** A record, not a target: standard drinks for the day, by kind, with no goal or bar. */
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
