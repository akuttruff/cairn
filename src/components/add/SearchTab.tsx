import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { TIMING } from '../../lib/timing.ts'
import type { ResearchJob, SearchResult } from '../../lib/api.ts'
import type { Food, MealPreset } from '../../types.ts'
import { matchMine } from '../../lib/match.ts'
import { EditFood } from './EditFood.tsx'
import { FoodRow } from './FoodRow.tsx'
import { useFavorites } from '../../hooks/useFavorites.ts'
import type { Favorites } from '../../hooks/useFavorites.ts'
import { normalizeFoods, mealFoodIds, normalizeMeals } from './foods.ts'
import { OnlineLookup } from './OnlineLookup.tsx'
import { readSavedJob, saveJob, forgetJob, isJob } from './lookupJob.ts'

const SEARCH_DELAY_MS = 450

const isBarcodeQuery = (q: string): boolean => /^\d{8,14}$/.test(q.replace(/[\s-]/g, ''))

export function SearchTab({ open, onPick }: { open: boolean; onPick: (f: Food) => void }) {
  const [q, setQ] = useState('')
  // Each outcome remembers the query it answers, so a stale one is never shown.
  const [settled, setSettled] = useState<{ q: string; result?: SearchResult; error?: string } | null>(null)
  const query = q.trim()
  const searchable = query.length >= 2
  const current = searchable && settled?.q === query ? settled : null
  const busy = searchable && !current
  const result = current?.result ?? null
  const error = current?.error ?? null
  const input = useRef<HTMLInputElement>(null)
  const [foods, setFoods] = useState<{ saved: Food[]; recent: Food[] }>({ saved: [], recent: [] })
  const [presets, setPresets] = useState<MealPreset[]>([])
  // A result being corrected, and the corrected copies, shown in place of
  // what the databases or the lookup said (the server remembers them too).
  const [editing, setEditing] = useState<Food | null>(null)
  const [fixed, setFixed] = useState<Map<string, Food>>(() => new Map())
  const fix = (f: Food): Food => fixed.get(f.id) ?? f

  useEffect(() => {
    api.foods().then((f) => setFoods(normalizeFoods(f))).catch(() => { /* search still works */ })
    api.meals().then((p) => setPresets(normalizeMeals(p))).catch(() => { /* badge just won't show */ })
  }, [])
  const mine = useMemo(() => [...foods.saved, ...foods.recent], [foods])
  const yours = useMemo(() => (searchable ? matchMine(mine, query) : []), [mine, query, searchable])
  const favorites = useFavorites(foods.saved)
  const inMeal = useMemo(() => mealFoodIds(presets), [presets])

  useEffect(() => {
    // Focus after Vaul's open animation, or iOS scrolls the page instead.
    if (!open) return
    const t = setTimeout(() => input.current?.focus(), 350)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!searchable) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      api.search(query, ctl.signal)
        .then((r) => setSettled({ q: query, result: r }))
        .catch((err: Error) => { if (err.name !== 'AbortError') setSettled({ q: query, error: err.message }) })
    }, SEARCH_DELAY_MS)
    return () => { clearTimeout(t); ctl.abort() }
  }, [query, searchable])

  const errorFor = (source: 'usda' | 'off') => result?.errors.find((e) => e.source === source)?.message

  // An online lookup outlives this sheet -- and the page, if the phone locks
  // -- so pick one back up, with the words it was for, while it is still
  // running. Once it has settled it is forgotten: otherwise the last thing
  // looked up would greet every opening as if it had just been typed.
  const [job, setJob] = useState<ResearchJob | null>(null)
  useEffect(() => {
    const saved = readSavedJob()
    if (!saved) return
    api.research(saved).then((j) => {
      if (!isJob(j) || j.status !== 'running') { forgetJob(); return }
      setJob(j)
      setQ((cur) => cur || j.query)
    }).catch(() => forgetJob())
  }, [])

  const [autoLookup, setAutoLookup] = useState(true)
  useEffect(() => {
    api.settings().then((s) => setAutoLookup(s.autoLookup !== false)).catch(() => { /* keep the default */ })
  }, [])

  // One lookup at a time from this sheet: starting another (the words
  // changed) cancels the first, so the model isn't left researching a query
  // nobody is waiting for.
  const jobRef = useRef<ResearchJob | null>(null)
  useEffect(() => { jobRef.current = job }, [job])
  const lookUp = useCallback(async (text: string, again = false, refresh = false): Promise<void> => {
    const prev = jobRef.current
    // Already looked up (or looking up) these words: nothing to start.
    if (!again && !refresh && prev && prev.query.toLowerCase() === text.toLowerCase()) return
    if (prev?.status === 'running') void api.cancelResearch(prev.id).catch(() => {})
    try {
      const j = await api.startResearch(text, refresh)
      if (!isJob(j)) return
      // Only a running one is worth coming back to; a cached answer is instant.
      if (j.status === 'running') saveJob(j.id)
      else forgetJob()
      setJob(j)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [])

  // Start over: empty the box and drop the lookup that went with it, so
  // neither comes back on the next opening.
  const clear = (): void => {
    const prev = jobRef.current
    if (prev?.status === 'running') void api.cancelResearch(prev.id).catch(() => {})
    forgetJob()
    setJob(null)
    setQ('')
    input.current?.focus()
  }

  const lookupable = query.length >= 3 && !isBarcodeQuery(query)
  useEffect(() => {
    if (!autoLookup || !lookupable) return
    const t = setTimeout(() => void lookUp(query), TIMING.autoLookupMs)
    return () => clearTimeout(t)
  }, [autoLookup, lookupable, query, lookUp])

  if (editing) {
    return (
      <EditFood
        food={editing}
        fromResult
        onCancel={() => setEditing(null)}
        onSaved={(saved) => {
          setFixed((prev) => new Map(prev).set(saved.id, saved))
          // It is in My foods now: the star says so, and Yours lists it.
          setFoods((prev) => ({ ...prev, saved: [...prev.saved.filter((x) => x.id !== saved.id), saved] }))
          setEditing(null)
        }}
      />
    )
  }

  return (
    <>
      <form
        className="search-box"
        role="search"
        onSubmit={(e) => {
          // The keyboard's Search key: look it up now rather than after the pause.
          e.preventDefault()
          if (lookupable) void lookUp(query)
          input.current?.blur()
        }}
      >
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          placeholder="Search foods, brands, or a barcode"
          aria-label="Search foods"
          // Off: the box is focused as the sheet opens, and the browser would
          // otherwise offer the last thing searched, as if it were still there.
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q && (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </form>
      <div className="drawer-scroll" data-vaul-no-drag>
        {yours.length > 0 && (
          <section className="result-group" aria-label="Yours">
            <h3 className="sheet-h">Yours <span className="src">saved &amp; recent</span></h3>
            {yours.map(fix).map((f) => (
              <FoodRow
                key={f.id} food={f} onPick={onPick}
                favorited={favorites.ids.has(f.id)} onToggleFavorite={(food) => void favorites.toggle(food)}
                onEdit={setEditing}
                inMeal={inMeal.has(f.id)}
              />
            ))}
          </section>
        )}
        {/* Above the databases, whose results land within a second and would
            otherwise push this down just as you reach for it. */}
        {lookupable && (
          <OnlineLookup
            query={query} job={job} auto={autoLookup} onJob={setJob} onStart={() => void lookUp(query, true)} onRefresh={() => void lookUp(query, true, true)}
            onPick={onPick} onEdit={setEditing} fix={fix} favorites={favorites} inMeal={inMeal}
          />
        )}
        {busy && <div className="hint center">Searching…</div>}
        {error && <div className="hint bad center">{error}</div>}
        {result && !busy && (
          result.barcode || result.brand
            // A brand or a barcode only makes sense for packaged foods.
            ? (
              <ResultGroup
                title={result.barcode ? 'Barcode' : result.brand!}
                subtitle="Open Food Facts"
                foods={result.off.map(fix)}
                error={errorFor('off')}
                empty={result.barcode ? 'No product with that barcode yet.' : undefined}
                onPick={onPick} onEdit={setEditing}
                favorites={favorites} inMeal={inMeal}
              />
            )
            : (
              <>
                <ResultGroup
                  title="Whole foods" subtitle="USDA" foods={result.usda.map(fix)} error={errorFor('usda')}
                  onPick={onPick} onEdit={setEditing} favorites={favorites} inMeal={inMeal}
                />
                <ResultGroup
                  title="Packaged" subtitle="Open Food Facts" foods={result.off.map(fix)} error={errorFor('off')}
                  onPick={onPick} onEdit={setEditing} favorites={favorites} inMeal={inMeal}
                />
              </>
            )
        )}
        {!query && (
          <div className="hint center">
            Whole foods come from USDA FoodData Central; packaged foods from
            Open Food Facts. Start with a store — <b>trader joe&apos;s</b>,{' '}
            <b>costco</b>, <b>whole foods</b> — to search just its products, or
            type the number under a barcode.
          </div>
        )}
      </div>
    </>
  )
}

function ResultGroup({ title, subtitle, foods, error, empty = 'No matches.', onPick, onEdit, favorites, inMeal }: {
  title: string; subtitle: string; foods: Food[]; error?: string; empty?: string
  onPick: (f: Food) => void; onEdit?: (f: Food) => void; favorites: Favorites; inMeal: Set<string>
}) {
  return (
    <section className="result-group" aria-label={title}>
      <h3 className="sheet-h">{title} <span className="src">{subtitle}</span></h3>
      {error && <div className="hint bad">{error}</div>}
      {!error && foods.length === 0 && <div className="hint">{empty}</div>}
      {foods.map((f) => (
        <FoodRow
          key={f.id} food={f} onPick={onPick}
          favorited={favorites.ids.has(f.id)} onToggleFavorite={(food) => void favorites.toggle(food)}
          onEdit={onEdit}
          inMeal={inMeal.has(f.id)}
        />
      ))}
    </section>
  )
}
