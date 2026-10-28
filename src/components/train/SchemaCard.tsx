import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import type { GenerateStatus, SchemaOverview, TrainingDay } from '../../types.ts'

interface SchemaCardProps {
  day: TrainingDay
  onChanged: () => void
}

const POLL_MS = 4000

/** Each lift's first training week and heaviest one, as "95 → 130" -- leaving out an intro week and the test week, whose ladders are all PR percentages. */
function span(o: SchemaOverview['lifts'][number], schema: SchemaOverview['schema']): string {
  const tops = o.weeks.filter((w) => w.week >= 1 && w.week !== schema.testWeek).map((w) => w.top).filter((t): t is number => t !== null)
  return tops.length ? `${tops[0]} → ${Math.max(...tops)} lb` : '—'
}

/**
 * The plan being followed: the whole thing week by week, and the next
 * block -- written by the local model from how this one went, then
 * reviewed here before it's followed. Changes to this plan go through the
 * coach; a rewrite from it is reviewed here too.
 */
export default function SchemaCard({ day, onChanged }: SchemaCardProps) {
  const schema = day.schema!
  const [overview, setOverview] = useState<SchemaOverview | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [gen, setGen] = useState<GenerateStatus | null>(null)
  const [draft, setDraft] = useState<SchemaOverview | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Pick up a generation already under way (started from another device, or before a reload).
  useEffect(() => {
    let alive = true
    const poll = (): void => {
      api.generation().then((s) => {
        if (!alive) return
        setGen(s)
        if (s.status === 'running') timer.current = setTimeout(poll, POLL_MS)
        else if (s.status === 'done' && s.draftId) onChanged()
      }, () => { /* the card just shows the button */ })
    }
    poll()
    return () => { alive = false; clearTimeout(timer.current) }
    // onChanged is a fresh closure each render; polling is started once per schema.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.id])

  const togglePlan = (): void => {
    const next = !showPlan
    setShowPlan(next)
    if (next && !overview) api.schema(schema.id).then(setOverview, (err: Error) => toast.error(err.message))
  }

  const generate = async (): Promise<void> => {
    try {
      setGen(await api.generateSchema())
      const poll = (): void => {
        api.generation().then((s) => {
          setGen(s)
          if (s.status === 'running') timer.current = setTimeout(poll, POLL_MS)
          else if (s.status === 'done') { toast.success('The next block is ready to review'); onChanged() }
          else if (s.status === 'error') toast.error(s.error ?? 'Couldn\'t write the next block')
        }, (err: Error) => toast.error(err.message))
      }
      timer.current = setTimeout(poll, POLL_MS)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const review = async (): Promise<void> => {
    if (!day.draft) return
    try {
      const [d, o] = await Promise.all([api.schema(day.draft.id), overview ? Promise.resolve(overview) : api.schema(schema.id)])
      setDraft(d)
      setOverview(o)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const decide = async (action: 'activate' | 'discard'): Promise<void> => {
    if (!day.draft) return
    setBusy(true)
    try {
      if (action === 'activate') {
        await api.activateSchema(day.draft.id)
        toast.success(`Now following ${day.draft.name}`)
      } else {
        await api.deleteSchema(day.draft.id)
      }
      setDraft(null)
      setOverview(null)
      onChanged()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const running = gen?.status === 'running'
  return (
    <section className="water-card" aria-label="Training plan">
      <div className="water-head">
        <span className="water-label">Plan</span>
        <span className="water-goal">{schema.startDate} to {schema.endDate}</span>
      </div>
      <div className="schema-name">{schema.name}</div>
      <button type="button" className="link-btn accent" aria-expanded={showPlan} onClick={togglePlan}>
        Whole plan {showPlan ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
      </button>
      {showPlan && overview && (
        <div className="schema-plan">
          {overview.schema.goals && <p className="schema-goals">{overview.schema.goals}</p>}
          {overview.lifts.map((l) => (
            <div key={l.itemId} className="schema-lift">
              <div className="schema-lift-name">{l.name}</div>
              <ol className="schema-weeks">
                {l.weeks.map((w) => (
                  <li key={w.week} className={day.week === w.week ? 'current' : undefined}>
                    <span className="schema-week">W{w.week}</span> {w.text}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      <h3 className="sheet-h">{day.draft?.rewriteFrom != null ? 'New version of this plan' : 'Next block'}</h3>
      {day.draft ? (
        <div className="draft">
          <div className="hint">
            {day.draft.rewriteFrom !== null
              ? <><strong>A rewrite of this plan</strong> from week {day.draft.rewriteFrom} is ready. Weeks before it stay as they were.</>
              : <><strong>{day.draft.name}</strong> is ready: {day.draft.startDate} to {day.draft.endDate}, written from how this one went.</>}
          </div>
          {!draft && <button type="button" className="link-btn accent" onClick={() => void review()}>Review it</button>}
          {draft && overview && (
            <div className="draft-review">
              {draft.schema.goals && <p className="schema-goals">{draft.schema.goals}</p>}
              <table className="draft-table">
                <thead><tr><th>Lift</th><th>Now</th><th>Next</th></tr></thead>
                <tbody>
                  {draft.lifts.map((l) => {
                    const before = overview.lifts.find((o) => o.lift === l.lift && o.itemId === l.itemId) ?? overview.lifts.find((o) => o.lift === l.lift)
                    return <tr key={l.itemId}><td>{l.name}</td><td>{before ? span(before, overview.schema) : 'new'}</td><td>{span(l, draft.schema)}</td></tr>
                  })}
                </tbody>
              </table>
              <div className="hint">
                Sessions: {draft.schema.days.map((d) => `${['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d.weekday]} ${d.sessions.map((s) => s.title).join(' + ')}`).join(' · ')}
              </div>
              {draft.schema.wods?.length ? <div className="hint">New WODs: {draft.schema.wods.map((w) => w.name).join(', ')}</div> : null}
            </div>
          )}
          <div className="row">
            <button type="button" className="secondary" disabled={busy} onClick={() => void decide('discard')}>Discard</button>
            <button type="button" className="primary" disabled={busy} onClick={() => void decide('activate')}>Follow it</button>
          </div>
        </div>
      ) : (
        <div className="generate">
          <div className="hint">
            When this block is done, your local model can write the next one from how it went: what you lifted, what got
            skipped, your new PRs and what you told the coach. To change this plan now, ask the coach.
          </div>
          <button type="button" className="link-btn accent generate-link" disabled={running} onClick={() => void generate()}>
            {running ? <><span className="spinner" aria-hidden="true" /> Writing the next block…</> : 'Write the next block'}
          </button>
          {gen?.status === 'error' && <div className="hint bad">{gen.error}</div>}
        </div>
      )}
    </section>
  )
}
