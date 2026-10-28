import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { has, viewWod } from '../../lib/training/bank.ts'
import { GUIDES } from '../../lib/training/guides.ts'
import { MOVEMENT, MOVEMENTS } from '../../lib/training/movements.ts'
import type { Movement } from '../../lib/training/movements.ts'
import { WOD_BANK } from '../../lib/training/wods.ts'
import { GEAR_NAMES } from '../../types.ts'
import type { Equipment, Wod, WodView } from '../../types.ts'
import type { TrainingState } from '../../hooks/useTraining.ts'

/** The few movement names that don't read as a title just capitalised. */
const TITLES: Record<string, string> = { 'bike-cal': 'Bike (calories)', 'row-cal': 'Row (calories)', run: 'Run', 'db-swing': 'DB swings' }
const titleOf = (m: Movement): string => TITLES[m.id] ?? m.name[0]!.toUpperCase() + m.name.slice(1)

/** The Library's groups of movements, in order. */
const GROUPS = ['Cardio', 'Barbell', 'Dumbbells', 'Kettlebells', 'Gymnastics', 'Bodyweight'] as const
function groupOf(m: Movement): (typeof GROUPS)[number] {
  if (m.focus === 'bike' || ['run', 'jumping-jack'].includes(m.id)) return 'Cardio'
  if (m.bells === 'dumbbells') return 'Dumbbells'
  if (m.bells === 'kettlebells') return 'Kettlebells'
  const gear = m.needs.flat()
  if (gear.includes('barbell')) return 'Barbell'
  if (gear.length) return 'Gymnastics'
  return 'Bodyweight'
}

interface Entry { wod: Wod; view: WodView | null; yours: boolean; hidden: boolean }

/**
 * Every WOD there is -- the bank's and the plan's own -- as it would be done
 * with the gear on hand, and every movement they're written in, with how it's
 * done. Tapping a movement in a WOD opens it.
 */
export default function Library({ training }: { training: TrainingState }) {
  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [own, setOwn] = useState<{ wods: Wod[]; hidden: string[] }>({ wods: [], hidden: [] })
  const [tab, setTab] = useState<'wods' | 'movements'>('wods')
  const [place, setPlace] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const schemaId = training.day?.schema?.id

  useEffect(() => {
    api.settings().then((s) => setEquipment(s.equipment), (err: Error) => toast.error(err.message))
  }, [])
  useEffect(() => {
    if (!schemaId) return
    api.schema(schemaId).then((o) => setOwn({ wods: o.schema.wods ?? [], hidden: o.schema.hiddenWods ?? [] }), () => { /* the bank alone, then */ })
  }, [schemaId])

  const places = equipment?.places?.map((p) => p.name) ?? []
  const entries = useMemo<Entry[]>(() => {
    if (!equipment) return []
    return [
      ...own.wods.map((wod) => ({ wod, yours: true })),
      ...WOD_BANK.filter((w) => !own.wods.some((o) => o.id === w.id)).map((wod) => ({ wod, yours: false })),
    ].map(({ wod, yours }) => ({ wod, yours, hidden: own.hidden.includes(wod.id), view: viewWod(wod, equipment) }))
  }, [equipment, own])

  const q = query.trim().toLowerCase()
  const shown = entries.filter((e) =>
    (place === 'all' || (place === 'yours' ? e.yours : e.view?.place === place))
    && (!q || e.wod.name.toLowerCase().includes(q) || (e.view?.lines ?? []).some((l) => l.toLowerCase().includes(q))))
  const doable = shown.filter((e) => e.view)
  const notDoable = shown.filter((e) => !e.view)

  const openMove = (id: string): void => {
    setTab('movements')
    setQuery('')
    setOpen((s) => new Set(s).add(id))
    // Once the Movements list has drawn with it open.
    setTimeout(() => document.getElementById(`move-${id}`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 0)
  }
  const toggle = (id: string): void => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const movements = MOVEMENTS.filter((m) => !q || titleOf(m).toLowerCase().includes(q))
  const wherePossible = (m: Movement): string => {
    if (!m.needs.length) return 'No gear needed'
    if (!equipment) return ''
    if (equipment.places?.length) {
      const at = equipment.places.filter((p) => has(p, m)).map((p) => p.name)
      return at.length ? at.join(' · ') : 'Not with your gear'
    }
    return has(equipment, m) ? 'With your gear' : 'Not with your gear'
  }

  return (
    <section className="library" aria-label="Library">
      <div className="library-tabs" role="tablist" aria-label="Library">
        <button type="button" role="tab" aria-selected={tab === 'wods'} className={`chip${tab === 'wods' ? ' on' : ''}`} onClick={() => setTab('wods')}>WODs</button>
        <button type="button" role="tab" aria-selected={tab === 'movements'} className={`chip${tab === 'movements' ? ' on' : ''}`} onClick={() => setTab('movements')}>Movements</button>
      </div>

      <label className="search-box library-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" placeholder={tab === 'wods' ? 'Search WODs or movements' : 'Search movements'} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={tab === 'wods' ? 'Search WODs' : 'Search movements'} />
        {query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} aria-hidden="true" /></button>}
      </label>

      {tab === 'wods' ? (
        <>
          <div className="library-filters" role="group" aria-label="Where">
            {[['all', 'All'], ...places.map((p) => [p, p]), ...(own.wods.length ? [['yours', 'Yours']] : [])].map(([value, label]) => (
              <button key={value} type="button" className={`chip${place === value ? ' on' : ''}`} aria-pressed={place === value} onClick={() => setPlace(value!)}>{label}</button>
            ))}
          </div>
          <div className="hint">{doable.length} {doable.length === 1 ? 'WOD' : 'WODs'}, as you&apos;d do them with your gear.</div>
          {!equipment && <div className="hint">Loading…</div>}
          <div className="library-list">
            {doable.map(({ wod, view, yours, hidden }) => (
              <div key={wod.id} className="water-card wod">
                <div className="wod-name">
                  <span>{view!.name}{view!.place && <span className="wod-place">· {view!.place}</span>}</span>
                  <span className="plan-item-meta">~{view!.minutes} min</span>
                </div>
                {(yours || hidden) && <div className="library-tags">{yours && <span className="library-tag">Yours</span>}{hidden && <span className="library-tag">Hidden from picks</span>}</div>}
                <div className="wod-heading">{view!.heading}</div>
                <ul className="wod-lines">
                  {view!.lines.map((line, i) => {
                    const id = view!.moves?.[i]
                    return <li key={i}>{id && GUIDES[id] ? <button type="button" className="move-link" onClick={() => openMove(id)}>{line}</button> : line}</li>
                  })}
                </ul>
                {view!.swaps.length > 0 && <div className="library-swaps">Swapped for your gear: {view!.swaps.join('; ')}</div>}
              </div>
            ))}
          </div>
          {notDoable.length > 0 && (
            <>
              <h3 className="sheet-h">Not with your gear</h3>
              <div className="hint">{notDoable.map((e) => e.wod.name).join(', ')}</div>
            </>
          )}
        </>
      ) : (
        <div className="library-list">
          {GROUPS.map((g) => {
            const inGroup = movements.filter((m) => groupOf(m) === g)
            if (!inGroup.length) return null
            return (
              <div key={g}>
                <h3 className="sheet-h">{g}</h3>
                <div className="water-card move-list">
                  {inGroup.map((m) => {
                    const guide = GUIDES[m.id]
                    const expanded = open.has(m.id)
                    const subs = m.sub ? [m.sub].flat().map((s) => MOVEMENT.get(s.to)).filter((x): x is Movement => !!x) : []
                    return (
                      <div key={m.id} id={`move-${m.id}`} className="move">
                        <button type="button" className="move-head" aria-expanded={expanded} onClick={() => toggle(m.id)}>
                          <span>{titleOf(m)}</span>
                          <span className="move-where">{wherePossible(m)}</span>
                          {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                        </button>
                        {expanded && guide && (
                          <div className="move-body">
                            <p>{guide.how}</p>
                            <ul>{guide.cues.map((c) => <li key={c}>{c}</li>)}</ul>
                            <div className="move-meta">
                              {m.needs.length > 0 && <div>Needs: {m.needs.map((set) => set.map((x) => GEAR_NAMES[x].toLowerCase()).join(' + ')).join(', or ')}</div>}
                              {subs.length > 0 && <div>Without it: {subs.map((s) => (TITLES[s.id] ?? s.name).toLowerCase().replace(/^db /, 'DB ').replace(/ db /g, ' DB ')).join(', then ')}</div>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
