import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Pencil, Shuffle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { kindView } from '../../lib/workoutIcons.ts'
import type { ResolvedItem, ResolvedSession, ResolvedSet, TrainingDay, WodView, WorkoutKindDef } from '../../types.ts'

interface SessionCardProps {
  date: string
  session: ResolvedSession
  kinds: WorkoutKindDef[]
  onDay: (day: TrainingDay) => void
  onShuffle: () => void
}

/** "5 × 95 lb", "60 s", "max reps": what one planned set asks for. */
function planned(set: ResolvedSet): string {
  const what = set.seconds !== null ? `${set.seconds} s` : set.reps === 'max' ? 'max reps' : set.reps !== null ? `${set.reps}` : ''
  if (set.weight === null) return what
  return set.seconds !== null ? `${what} @ ${set.weight} lb` : `${what} × ${set.weight} lb`
}

/** What was actually done, when it differs from the plan. */
function actual(set: ResolvedSet): string | null {
  const log = set.log
  if (!log) return null
  const sameReps = log.reps === null || log.reps === set.reps
  const sameWeight = log.weight === null || log.weight === set.weight
  const sameSeconds = log.seconds === null || log.seconds === set.seconds
  if (sameReps && sameWeight && sameSeconds) return null
  if (log.seconds !== null) return `${log.seconds} s${log.weight !== null ? ` @ ${log.weight} lb` : ''}`
  return `${log.reps ?? set.reps} × ${log.weight ?? set.weight ?? 'bodyweight'}${log.weight !== null ? ' lb' : ''}`
}

export default function SessionCard({ date, session, kinds, onDay, onShuffle }: SessionCardProps) {
  const { Icon } = kindView(kinds, session.kind)
  const done = session.items.filter((i) => i.done).length
  return (
    <section className="water-card session-card" aria-label={session.title}>
      <div className="water-head">
        <span className="session-title"><Icon size={16} aria-hidden="true" /> {session.title}</span>
        <span className={`session-count${session.done ? ' done' : ''}`}>{done}/{session.items.length}</span>
      </div>
      {session.items.map((item) => <Item key={item.id} date={date} item={item} onDay={onDay} onShuffle={onShuffle} />)}
    </section>
  )
}

function Item({ date, item, onDay, onShuffle }: { date: string; item: ResolvedItem; onDay: (day: TrainingDay) => void; onShuffle: () => void }) {
  const [showNotes, setShowNotes] = useState(false)

  /** Tick or untick the item's single box (a check, the minutes, a WOD). */
  const toggle = async (): Promise<void> => {
    try {
      onDay((await api.logSet({ date, itemId: item.id, setIndex: 0, done: !item.done })).day)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className={`plan-item${item.done ? ' done' : ''}`}>
      <div className="plan-item-head">
        <span className="plan-item-name">{item.name}</span>
        {item.type === 'minutes' && item.minutes !== undefined && <span className="plan-item-meta">{item.minutes} min</span>}
        {item.notes && (
          <button type="button" className="link-btn accent" aria-expanded={showNotes} onClick={() => setShowNotes((v) => !v)}>
            How to {showNotes ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          </button>
        )}
      </div>
      {item.note && <div className="plan-item-note">{item.note}</div>}
      {showNotes && item.notes && <div className="plan-item-notes">{item.notes}</div>}
      {item.type === 'sets' && (
        <ul className="set-list" aria-label={`${item.name} sets`}>
          {item.sets!.map((s) => <SetRow key={s.index} date={date} item={item} set={s} onDay={onDay} />)}
        </ul>
      )}
      {(item.type === 'check' || item.type === 'minutes') && (
        <button type="button" className={`tick-btn${item.done ? ' on' : ''}`} aria-pressed={item.done} onClick={() => void toggle()}>
          <Check size={15} aria-hidden="true" /> {item.done ? 'Done' : 'Mark done'}
        </button>
      )}
      {item.type === 'wod' && <WodItem date={date} item={item} onDay={onDay} onShuffle={onShuffle} onToggle={toggle} />}
    </div>
  )
}

function SetRow({ date, item, set, onDay }: { date: string; item: ResolvedItem; set: ResolvedSet; onDay: (day: TrainingDay) => void }) {
  const [editing, setEditing] = useState(false)
  const timed = set.seconds !== null
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')

  const log = async (values: { reps: number | null; weight: number | null; seconds: number | null } | null): Promise<void> => {
    try {
      const res = await api.logSet({ date, itemId: item.id, setIndex: set.index, ...values, done: values !== null })
      onDay(res.day)
      if (res.newPr) {
        const pr = res.newPr
        toast(`${pr.weight} lb beats your ${pr.name} PR`, {
          action: {
            label: 'Set as PR',
            onClick: () => { void api.setPr(pr.lift, pr.weight, date).then(() => api.training(date)).then(onDay, (err: Error) => toast.error(err.message)) },
          },
        })
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  // A max set has no number to tick: it needs what was done typed in.
  const tap = (): void => {
    if (set.log) void log(null)
    else if (set.reps === 'max') openEdit()
    else void log({ reps: typeof set.reps === 'number' ? set.reps : null, weight: set.weight, seconds: set.seconds })
  }

  const openEdit = (): void => {
    const l = set.log
    setReps(String(timed ? (l?.seconds ?? set.seconds ?? '') : (l?.reps ?? (typeof set.reps === 'number' ? set.reps : ''))))
    setWeight(String(l?.weight ?? set.weight ?? ''))
    setEditing(true)
  }

  const saveEdit = (): void => {
    const n = reps.trim() === '' ? null : Number(reps)
    const w = weight.trim() === '' ? null : Number(weight)
    if ((n !== null && !(n > 0)) || (w !== null && !(w >= 0))) { toast.error('Enter numbers for what you did'); return }
    setEditing(false)
    void log(timed ? { reps: null, seconds: n, weight: w } : { reps: n, seconds: null, weight: w })
  }

  const did = actual(set)
  const label = `Set ${set.index + 1}: ${planned(set)}${set.attempt ? ', PR attempt' : ''}`
  return (
    <li className={`set-row${set.log ? ' done' : ''}`}>
      {editing ? (
        <div className="set-edit">
          <input type="text" inputMode="decimal" aria-label={timed ? 'Seconds' : 'Reps'} value={reps} onChange={(e) => setReps(e.target.value)} />
          <span className="set-x">{timed ? 's' : 'reps'}</span>
          <input type="text" inputMode="decimal" aria-label="Weight (lb)" placeholder="—" value={weight} onChange={(e) => setWeight(e.target.value)} />
          <span className="set-x">lb</span>
          <button type="button" className="link-btn accent" onClick={saveEdit}>Save</button>
          <button type="button" className="link-btn" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      ) : (
        <>
          <button type="button" className="set-tick" aria-pressed={Boolean(set.log)} aria-label={label} onClick={tap}>
            <span className="set-box" aria-hidden="true">{set.log && <Check size={13} />}</span>
            <span className="set-n" aria-hidden="true">{set.index + 1}</span>
            <span className="set-plan" aria-hidden="true">{planned(set)}{set.attempt && <em> PR attempt</em>}</span>
            {did && <span className="set-did" aria-hidden="true">did {did}</span>}
          </button>
          <button type="button" className="icon-btn set-pencil" aria-label={`Change what you did in set ${set.index + 1}`} onClick={openEdit}>
            <Pencil size={13} aria-hidden="true" />
          </button>
        </>
      )}
    </li>
  )
}

function WodCard({ wod }: { wod: WodView }) {
  return (
    <div className="wod">
      <div className="wod-name">{wod.name} <span className="plan-item-meta">~{wod.minutes} min</span></div>
      <div className="wod-heading">{wod.heading}</div>
      <ul className="wod-lines">{wod.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      {wod.swaps.length > 0 && <div className="wod-swaps">With your gear: {wod.swaps.join('; ')}</div>}
    </div>
  )
}

function WodItem({ date, item, onDay, onShuffle, onToggle }: {
  date: string; item: ResolvedItem; onDay: (day: TrainingDay) => void; onShuffle: () => void; onToggle: () => Promise<void>
}) {
  const { chosen, picks } = item.wod!
  const choose = async (id: string | null): Promise<void> => {
    try {
      onDay(await api.setWod(date, item.id, id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const current = chosen ? picks.find((p) => p.id === chosen) : undefined
  if (current) {
    return (
      <div className="wod-chosen">
        <WodCard wod={current} />
        <div className="wod-actions">
          <button type="button" className={`tick-btn${item.done ? ' on' : ''}`} aria-pressed={item.done} onClick={() => void onToggle()}>
            <Check size={15} aria-hidden="true" /> {item.done ? 'Done' : 'Mark done'}
          </button>
          {!item.done && <button type="button" className="link-btn accent" onClick={() => void choose(null)}>Pick another</button>}
        </div>
      </div>
    )
  }
  return (
    <div className="wod-picks">
      {picks.length === 0 && <div className="hint">Nothing in the WOD bank fits this slot with your equipment.</div>}
      {picks.map((w) => (
        <div key={w.id} className="wod-pick">
          <WodCard wod={w} />
          <button type="button" className="link-btn accent" aria-label={`Do ${w.name}`} onClick={() => void choose(w.id)}>Do this one</button>
        </div>
      ))}
      <button type="button" className="link-btn accent wod-shuffle" onClick={onShuffle}>
        <Shuffle size={13} aria-hidden="true" /> Other WODs
      </button>
    </div>
  )
}
