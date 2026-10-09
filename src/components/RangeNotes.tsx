import { useEffect, useRef, useState } from 'react'
import { NotebookPen, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { localDate } from '../lib/nutrition.ts'
import type { RangeNotes as Notes, RangeView } from '../types.ts'

/**
 * A few paragraphs on the week or month, written by the local model from
 * its numbers. Written by itself the first time a period with anything
 * logged is opened, and again once a finished period's numbers change; a
 * period still under way is only rewritten on request, since its numbers
 * move every day.
 */
export default function RangeNotes({ view }: { view: RangeView }) {
  const [notes, setNotes] = useState<Notes | null | undefined>(undefined)
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = `${view.start}..${view.end}`
  // One automatic write per period per visit, so a failure does not loop.
  const attempted = useRef<string | null>(null)
  const hasAnything = view.loggedDays > 0 || view.water.of > 0 || view.workouts.sessions > 0
  const over = view.end < localDate()

  useEffect(() => {
    let live = true
    setNotes(undefined)
    setError(null)
    api.notes(view.start, view.end).then((r) => { if (live) setNotes(r.notes) }).catch(() => { if (live) setNotes(null) })
    return () => { live = false }
  }, [view.start, view.end])

  const write = async (): Promise<void> => {
    setWriting(true)
    setError(null)
    try {
      const r = await api.writeNotes(view.start, view.end)
      setNotes(r.notes)
    } catch (err) {
      setError((err as Error).message)
      toast.error((err as Error).message)
    } finally {
      setWriting(false)
    }
  }

  useEffect(() => {
    if (notes === undefined || writing || !hasAnything || attempted.current === key) return
    // Nothing yet, or a finished period whose numbers changed since: write now.
    if (notes === null || (notes.stale && over)) {
      attempted.current = key
      void write()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, key, hasAnything, over])

  if (!hasAnything) return null
  const when = notes ? new Date(notes.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null

  return (
    <section className="water-card notes-card" aria-label="Notes">
      <div className="water-head">
        <span className="water-label"><NotebookPen size={12} aria-hidden="true" /> Notes</span>
        {notes && !writing && (
          <button type="button" className="link-btn notes-refresh" onClick={() => void write()} aria-label="Write the notes again">
            <RefreshCw size={12} aria-hidden="true" /> {notes.stale ? 'Numbers changed · rewrite' : 'Rewrite'}
          </button>
        )}
      </div>
      {writing && <div className="hint"><span className="spinner" aria-hidden="true" /> Writing notes on this period…</div>}
      {!writing && notes && (
        <div className="notes-text">
          {notes.text.split(/\n{2,}/).map((p, i) => <p key={i}>{p.trim()}</p>)}
          <div className="notes-meta">{notes.model} · {when}</div>
        </div>
      )}
      {!writing && !notes && error && (
        <div className="hint bad">
          {error} <button type="button" className="link-btn" onClick={() => void write()}>Try again</button>
        </div>
      )}
      {!writing && notes === null && !error && (
        <button type="button" className="link-btn accent" onClick={() => void write()}>Write notes on this period</button>
      )}
    </section>
  )
}
