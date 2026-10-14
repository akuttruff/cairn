import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { api } from '../../lib/api.ts'
import { TIMING } from '../../lib/timing.ts'
import type { ResearchJob } from '../../lib/api.ts'
import { chime } from '../../lib/chime.ts'
import type { Food } from '../../types.ts'
import { FoodRow } from './FoodRow.tsx'
import type { Favorites } from '../../hooks/useFavorites.ts'
import { forgetJob, isJob } from './lookupJob.ts'
/** Where a looked-up food's numbers came from, and the model's caveats. */
export function FoundOnline({ food }: { food: Food }) {
  return (
    <div className="found-online">
      <div className="hint">
        <Globe size={12} aria-hidden="true" /> Found online by your LM Studio model — worth a
        glance at the source before you rely on it.
      </div>
      {food.note && <div className="hint">{food.note}</div>}
      {food.sources?.map((s) => (
        <a key={s.url} className="source-link" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Online lookup

/**
 * Ask LM Studio -- a local model with the deep-research MCP -- to find the
 * food online. For what the databases miss: restaurant dishes, store items, a
 * particular build of a bowl. Takes a minute or two, so it runs on the server
 * and this polls; it starts by itself once typing pauses, unless turned off.
 */
export function OnlineLookup({ query, job, auto, onJob, onStart, onRefresh, onPick, onEdit, fix = (f) => f, favorites, inMeal }: {
  query: string
  job: ResearchJob | null
  auto: boolean
  onJob: (j: ResearchJob | null) => void
  onStart: () => void
  /** Run the lookup again, ignoring the remembered answer. */
  onRefresh: () => void
  onPick: (f: Food) => void
  onEdit?: (f: Food) => void
  /** A corrected copy of a found food, when there is one. */
  fix?: (f: Food) => Food
  favorites: Favorites
  inMeal: Set<string>
}) {
  const [now, setNow] = useState(() => Date.now())
  const running = job?.status === 'running'
  const jobId = job?.id

  useEffect(() => {
    if (!running || !jobId) return
    // Cleared once this job stops being watched (settled, replaced or
    // cancelled here), so a poll answering late can't chime for it.
    let watching = true
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => {
      api.research(jobId)
        // Only if it's still the current job: a replaced one may answer late.
        .then((j) => {
          if (!isJob(j) || j.id !== jobId) return
          // Settled: nothing left to come back to.
          if (j.status !== 'running') {
            forgetJob()
            // The write-up is ready (or gave up): worth a sound, since it
            // takes a minute or two and you've likely looked away.
            if (watching && j.error !== 'Cancelled.') chime(j.status === 'done' ? 'done' : 'failed')
            watching = false
          }
          onJob(j)
        })
        .catch(() => { forgetJob(); onJob(null) })
    }, TIMING.pollMs)
    return () => { watching = false; clearInterval(tick); clearInterval(poll) }
  }, [running, jobId, onJob])

  const mine = job && job.query.toLowerCase() === query.toLowerCase() ? job : null

  if (!mine) {
    return (
      <section className="result-group" aria-label="Online">
        <h3 className="sheet-h">Online <span className="src">LM Studio + deep-research</span></h3>
        {auto
          ? <div className="hint">Looks this up online once you pause typing, or press Search.</div>
          : (
            <button type="button" className="lookup-btn" onClick={onStart}>
              <Globe size={15} aria-hidden="true" /> Look up “{query}” online
            </button>
          )}
      </section>
    )
  }

  return (
    <section className="result-group" aria-label="Online" aria-live="polite">
      <h3 className="sheet-h">
        Online{' '}
        <span className="src">
          {mine.status === 'done' && mine.result ? `via ${mine.result.model} · ${mine.result.seconds}s` : 'LM Studio + deep-research'}
        </span>
      </h3>
      {mine.status === 'running' && (
        <div className="lookup-status">
          <span className="spinner" aria-hidden="true" />
          <span>Looking it up… {mine.step} · {Math.max(0, Math.round((now - mine.startedAt) / 1000))}s</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => { void api.cancelResearch(mine.id); forgetJob(); onJob({ ...mine, status: 'error', error: 'Cancelled.' }) }}
          >
            Cancel
          </button>
        </div>
      )}
      {mine.status === 'error' && (
        <>
          <div className="hint bad">{mine.error}</div>
          <button type="button" className="lookup-btn" onClick={onStart}>Try again</button>
        </>
      )}
      {mine.status === 'done' && mine.result && (
        <>
          {mine.result.foods.length
            ? mine.result.foods.map(fix).map((f) => (
              <FoodRow
                key={f.id} food={f} onPick={onPick}
                favorited={favorites.ids.has(f.id)} onToggleFavorite={(food) => void favorites.toggle(food)}
                onEdit={onEdit}
                inMeal={inMeal.has(f.id)}
              />
            ))
            : <div className="hint">Nothing reliable found. {mine.result.note}</div>}
          <div className="lookup-again">
            <button type="button" className="link-btn" onClick={onRefresh}>Look up again</button>
          </div>
        </>
      )}
    </section>
  )
}
