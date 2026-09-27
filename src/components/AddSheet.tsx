import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ArrowLeft, Globe, Search, Star, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { ResearchJob, SearchResult } from '../lib/api.ts'
import { calorieMismatch } from '../lib/nutrition.ts'
import { describeAmount, gramsFor, headline, nutrientsFor, unitsFor } from '../lib/units.ts'
import { MEAL_LABELS, emptyDraft, fmt, parseNum } from '../lib/format.ts'
import type { NutrientDraft } from '../lib/format.ts'
import { MEALS, NUTRIENTS } from '../types.ts'
import type { Food, Meal, NewEntry, Nutrients, Serving } from '../types.ts'
import NutrientFields from './NutrientFields.tsx'
import Preview from './Preview.tsx'
import { matchMine } from '../lib/match.ts'

type Tab = 'search' | 'mine' | 'manual'

interface AddSheetProps {
  open: boolean
  /** Changes on every opening, so each one starts fresh. */
  session: number
  date: string
  meal: Meal
  onClose: () => void
  onLogged: () => void
}

const SEARCH_DELAY_MS = 450
/**
 * How long typing must pause before an automatic online lookup. Longer than
 * the database search: a lookup occupies the model for a minute or two, so
 * it shouldn't fire on a half-typed "chipotle chi".
 */
export const AUTO_LOOKUP_DELAY_MS = 2000


export default function AddSheet({ open, session, onClose, ...rest }: AddSheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content tall" aria-describedby={undefined}>
          <div className="drawer-handle" />
          <AddBody key={session} open={open} onClose={onClose} {...rest} />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function AddBody({ open, date, meal: initialMeal, onClose, onLogged }: Omit<AddSheetProps, 'session'>) {
  const [tab, setTab] = useState<Tab>('search')
  const [meal, setMeal] = useState<Meal>(initialMeal)
  const [picked, setPicked] = useState<Food | null>(null)

  const log = async (entry: Omit<NewEntry, 'date' | 'meal'>): Promise<void> => {
    try {
      await api.addEntry({ ...entry, date, meal })
      toast.success(`Logged ${entry.name}`)
      onLogged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <>
          <div className="sheet-top">
            {picked && (
              <button type="button" className="icon-btn" aria-label="Back to results" onClick={() => setPicked(null)}>
                <ArrowLeft size={18} aria-hidden="true" />
              </button>
            )}
            <Drawer.Title className="drawer-title">Add to</Drawer.Title>
            <select className="meal-select" aria-label="Meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
              {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
            </select>
          </div>

          {picked
            ? <Amount food={picked} onLog={log} />
            : (
              <>
                <div className="tabs" role="tablist">
                  {(['search', 'mine', 'manual'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={tab === t}
                      className={tab === t ? 'active' : ''}
                      onClick={() => setTab(t)}
                    >
                      {t === 'search' ? 'Search' : t === 'mine' ? 'My foods' : 'Manual'}
                    </button>
                  ))}
                </div>
                {tab === 'search' && <SearchTab open={open} onPick={setPicked} />}
                {tab === 'mine' && <MineTab onPick={setPicked} />}
                {tab === 'manual' && <ManualTab onLog={log} />}
              </>
            )}
    </>
  )
}

// ---------------------------------------------------------------------------

function FoodRow({ food, onPick }: { food: Food; onPick: (f: Food) => void }) {
  // Per serving for a food known that way ("/1 bowl"), else per 100 g.
  const h = headline(food)
  if (!h) return null
  const p = h.nutrients
  // Crowd-sourced entries sometimes have a typo; flag ones whose calories
  // disagree with their own macros.
  const doubtful = calorieMismatch(p)
  return (
    <button type="button" className="food-row" onClick={() => onPick(food)}>
      <div className="entry-main">
        <span className="entry-name">{food.name}</span>
        {food.brand && <span className="entry-sub">{food.brand}</span>}
      </div>
      <div className="entry-nums">
        <span className="entry-kcal">
          {doubtful && <TriangleAlert size={12} className="doubt" aria-label="Numbers don't add up" />}
          {fmt('calories', p.calories)}<small> /{h.label}</small>
        </span>
        <span className="entry-macros">
          P {fmt('protein', p.protein)} · F {fmt('fat', p.fat)} · C {fmt('carbs', p.carbs)} · Fib {fmt('fiber', p.fiber)}
        </span>
      </div>
    </button>
  )
}

function SearchTab({ open, onPick }: { open: boolean; onPick: (f: Food) => void }) {
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
  const [mine, setMine] = useState<Food[]>([])

  useEffect(() => {
    api.foods().then((f) => setMine([...f.saved, ...f.recent])).catch(() => { /* search still works */ })
  }, [])
  const yours = useMemo(() => (searchable ? matchMine(mine, query) : []), [mine, query, searchable])

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
  // -- so pick a recent one back up, with the words it was for.
  const [job, setJob] = useState<ResearchJob | null>(null)
  useEffect(() => {
    const saved = readSavedJob()
    if (!saved) return
    api.research(saved).then((j) => {
      if (!isJob(j)) return
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
  const lookUp = useCallback(async (text: string, again = false): Promise<void> => {
    const prev = jobRef.current
    // Already looked up (or looking up) these words: nothing to start.
    if (!again && prev && prev.query.toLowerCase() === text.toLowerCase()) return
    if (prev?.status === 'running') void api.cancelResearch(prev.id).catch(() => {})
    try {
      const j = await api.startResearch(text)
      if (!isJob(j)) return
      saveJob(j.id)
      setJob(j)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }, [])

  const lookupable = query.length >= 3 && !isBarcodeQuery(query)
  useEffect(() => {
    if (!autoLookup || !lookupable) return
    const t = setTimeout(() => void lookUp(query), AUTO_LOOKUP_DELAY_MS)
    return () => clearTimeout(t)
  }, [autoLookup, lookupable, query, lookUp])

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
          autoCorrect="off"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>
      <div className="drawer-scroll" data-vaul-no-drag>
        {yours.length > 0 && (
          <section className="result-group" aria-label="Yours">
            <h3 className="sheet-h">Yours <span className="src">saved &amp; recent</span></h3>
            {yours.map((f) => <FoodRow key={f.id} food={f} onPick={onPick} />)}
          </section>
        )}
        {/* Above the databases, whose results land within a second and would
            otherwise push this down just as you reach for it. */}
        {lookupable && (
          <OnlineLookup query={query} job={job} auto={autoLookup} onJob={setJob} onStart={() => void lookUp(query, true)} onPick={onPick} />
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
                foods={result.off}
                error={errorFor('off')}
                empty={result.barcode ? 'No product with that barcode yet.' : undefined}
                onPick={onPick}
              />
            )
            : (
              <>
                <ResultGroup title="Whole foods" subtitle="USDA" foods={result.usda} error={errorFor('usda')} onPick={onPick} />
                <ResultGroup title="Packaged" subtitle="Open Food Facts" foods={result.off} error={errorFor('off')} onPick={onPick} />
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

function ResultGroup({ title, subtitle, foods, error, empty = 'No matches.', onPick }: {
  title: string; subtitle: string; foods: Food[]; error?: string; empty?: string; onPick: (f: Food) => void
}) {
  return (
    <section className="result-group" aria-label={title}>
      <h3 className="sheet-h">{title} <span className="src">{subtitle}</span></h3>
      {error && <div className="hint bad">{error}</div>}
      {!error && foods.length === 0 && <div className="hint">{empty}</div>}
      {foods.map((f) => <FoodRow key={f.id} food={f} onPick={onPick} />)}
    </section>
  )
}

function MineTab({ onPick }: { onPick: (f: Food) => void }) {
  const [foods, setFoods] = useState<{ saved: Food[]; recent: Food[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.foods().then(setFoods).catch((err: Error) => setError(err.message))
  }, [])

  const remove = async (food: Food): Promise<void> => {
    try {
      await api.deleteFood(food.id)
      setFoods((f) => f && { ...f, saved: f.saved.filter((x) => x.id !== food.id) })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="drawer-scroll" data-vaul-no-drag>
      {error && <div className="hint bad center">{error}</div>}
      {foods && (
        <>
          <h3 className="sheet-h">Saved</h3>
          {foods.saved.length === 0 && <div className="hint">Star a food when logging it to keep it here.</div>}
          {foods.saved.map((f) => (
            <div key={f.id} className="saved-row">
              <FoodRow food={f} onPick={onPick} />
              <button type="button" className="unsave" aria-label={`Remove ${f.name} from My foods`} onClick={() => void remove(f)}>
                <Star size={16} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          ))}
          <h3 className="sheet-h">Recent</h3>
          {foods.recent.length === 0 && <div className="hint">Foods you log show up here.</div>}
          {foods.recent.map((f) => <FoodRow key={f.id} food={f} onPick={onPick} />)}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Pick how much of a chosen food: a number of any of its servings ("1.5" x
 * "1 cup, sliced"), or a weight in g or oz when its per-100g values are known.
 */
function Amount({ food, onLog }: { food: Food; onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void> }) {
  const [servings, setServings] = useState<Serving[]>(food.servings ?? [])
  const units = useMemo(() => unitsFor({ ...food, servings }), [food, servings])
  const first = units[0]
  const [unitKey, setUnitKey] = useState(first?.key ?? 'g')
  const [qty, setQty] = useState(first?.key === 'g' ? '100' : '1')
  const touched = useRef(false)
  const [save, setSave] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // USDA keeps household measures ("1 medium", "1 cup") on the food record;
    // fetch them so you rarely have to know a weight.
    if (food.source !== 'usda' || !food.sourceId) return
    let live = true
    api.portions(food.sourceId).then((p) => {
      if (!live || p.length === 0) return
      setServings((prev) => [...prev, ...p.filter((s) => !prev.some((x) => x.label === s.label))])
      // Prefer a real household measure over 100 g -- unless the food already
      // had servings, or you've already chosen something.
      if (!food.servings?.length && !touched.current) {
        setUnitKey('s0')
        setQty('1')
      }
    }).catch(() => { /* weights still work */ })
    return () => { live = false }
  }, [food])

  const unit = units.find((u) => u.key === unitKey) ?? first
  const q = parseNum(qty)
  const grams = unit && q != null ? gramsFor(unit, q) : null
  const valid = unit != null && q != null && q > 0 && q <= 10_000 && (grams == null || grams <= 10_000)
  const nutrients = valid && unit && q != null ? nutrientsFor(food, unit, q) : null
  const chips = units.filter((u) => u.key !== 'g' && u.key !== 'oz')

  const choose = (key: string, quantity?: string): void => {
    touched.current = true
    setUnitKey(key)
    if (quantity) setQty(quantity)
  }

  const submit = async (): Promise<void> => {
    if (!valid || !unit || !nutrients) return
    setBusy(true)
    if (save) {
      try {
        await api.saveFood({ ...food, servings })
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    const base = { name: food.name, brand: food.brand, foodId: food.id, source: food.source }
    // Plain grams need no unit; anything else is remembered as measured.
    const amount = unit.key === 'g' ? undefined : { quantity: q!, unit: unit.label, unitGrams: unit.grams }
    await onLog(unit.nutrients
      ? { ...base, grams, perUnit: unit.nutrients, amount }
      : { ...base, grams, per100g: food.per100g, amount })
    setBusy(false)
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        <div className="picked-name">
          <div>
            <div className="entry-name">{food.name}</div>
            {food.brand && <div className="entry-sub">{food.brand}</div>}
          </div>
          <button
            type="button"
            className={`star${save ? ' on' : ''}`}
            aria-pressed={save}
            aria-label="Save to My foods"
            onClick={() => setSave((v) => !v)}
          >
            <Star size={18} fill={save ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        </div>

        {chips.length > 0 && (
          <div className="chips">
            {chips.map((u) => (
              <button
                type="button"
                key={u.key}
                className={`chip${unitKey === u.key ? ' on' : ''}`}
                onClick={() => choose(u.key, '1')}
              >
                {u.label}
              </button>
            ))}
          </div>
        )}

        <div className="amount-row">
          <div className="field grams">
            <label htmlFor="amount-qty">Amount</label>
            <input
              id="amount-qty"
              type="text"
              inputMode="decimal"
              value={qty}
              onChange={(e) => { touched.current = true; setQty(e.target.value) }}
            />
          </div>
          <div className="field">
            <label htmlFor="amount-unit">Unit</label>
            <select
              id="amount-unit"
              value={unit?.key ?? ''}
              onChange={(e) => choose(e.target.value, e.target.value === 'g' ? '100' : e.target.value === 'oz' ? '1' : undefined)}
            >
              {units.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}{u.grams != null && u.key !== 'g' && u.key !== 'oz' ? ` (${fmt('protein', u.grams)} g)` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        {valid && grams != null && unit?.key !== 'g' && <div className="hint">= {fmt('protein', grams)} g</div>}

        {nutrients ? <Preview nutrients={nutrients} /> : <div className="hint bad">Enter an amount greater than 0.</div>}
        {headline(food) && calorieMismatch(headline(food)!.nutrients) && (
          <div className="hint warn" role="status">
            <TriangleAlert size={13} aria-hidden="true" /> This entry&apos;s calories don&apos;t match its
            protein, fat and carbs. It may have a typo — check the label if you have it.
          </div>
        )}
        {food.source === 'web' && <FoundOnline food={food} />}
        {nutrients && NUTRIENTS.some((k) => nutrients[k] == null) && (
          <div className="hint">— means the source doesn&apos;t report it; it won&apos;t count as zero.</div>
        )}
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" className="primary" disabled={!valid || !nutrients || busy} onClick={() => void submit()}>
            Log {valid && unit ? describeAmount({ quantity: q!, unit: unit.label }) : ''}
          </button>
        </div>
      </div>
    </>
  )
}

/** Where a looked-up food's numbers came from, and the model's caveats. */
function FoundOnline({ food }: { food: Food }) {
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

const JOB_KEY = 'macros.research'
const POLL_MS = 2000

function readSavedJob(): string | null {
  try { return localStorage.getItem(JOB_KEY) } catch { return null }
}
function saveJob(id: string): void {
  try { localStorage.setItem(JOB_KEY, id) } catch { /* private mode: just not restored */ }
}
function forgetJob(): void {
  try { localStorage.removeItem(JOB_KEY) } catch { /* nothing to forget */ }
}

/** A job as the server describes it -- not an empty or error body. */
const isJob = (j: unknown): j is ResearchJob =>
  Boolean(j && typeof (j as ResearchJob).id === 'string' && typeof (j as ResearchJob).query === 'string')

const isBarcodeQuery = (q: string): boolean => /^\d{8,14}$/.test(q.replace(/[\s-]/g, ''))

/**
 * Ask LM Studio -- a local model with the deep-research MCP -- to find the
 * food online. For what the databases miss: restaurant dishes, store items, a
 * particular build of a bowl. Takes a minute or two, so it runs on the server
 * and this polls; it starts by itself once typing pauses, unless turned off.
 */
function OnlineLookup({ query, job, auto, onJob, onStart, onPick }: {
  query: string
  job: ResearchJob | null
  auto: boolean
  onJob: (j: ResearchJob | null) => void
  onStart: () => void
  onPick: (f: Food) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const running = job?.status === 'running'
  const jobId = job?.id

  useEffect(() => {
    if (!running || !jobId) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const poll = setInterval(() => {
      api.research(jobId)
        // Only if it's still the current job: a replaced one may answer late.
        .then((j) => { if (isJob(j) && j.id === jobId) onJob(j) })
        .catch(() => { forgetJob(); onJob(null) })
    }, POLL_MS)
    return () => { clearInterval(tick); clearInterval(poll) }
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
            onClick={() => { void api.cancelResearch(mine.id); onJob({ ...mine, status: 'error', error: 'Cancelled.' }) }}
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
        mine.result.foods.length
          ? mine.result.foods.map((f) => <FoodRow key={f.id} food={f} onPick={onPick} />)
          : <div className="hint">Nothing reliable found. {mine.result.note}</div>
      )}
    </section>
  )
}

function toNutrients(draft: NutrientDraft): Nutrients {
  const out = {} as Nutrients
  for (const k of NUTRIENTS) out[k] = parseNum(draft[k])
  return out
}

/**
 * A label, a restaurant guess, a recipe: type the numbers in for one
 * serving, however you'd describe it. The weight is optional.
 */
function ManualTab({ onLog }: { onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void> }) {
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [serving, setServing] = useState('')
  const [grams, setGrams] = useState('')
  const [draft, setDraft] = useState<NutrientDraft>(emptyDraft)
  const [save, setSave] = useState(false)
  const [busy, setBusy] = useState(false)

  const n = toNutrients(draft)
  const g = parseNum(grams)
  const label = serving.trim() || '1 serving'
  const badNumber = NUTRIENTS.some((k) => draft[k].trim() && (n[k] == null || n[k]! < 0))
  const badGrams = grams.trim() !== '' && (g == null || g <= 0 || g > 10_000)
  const valid = name.trim() !== '' && n.calories != null && !badNumber && !badGrams
  const mismatch = calorieMismatch(n)

  const submit = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    const trimmed = name.trim()
    const b = brand.trim() || undefined
    const amount = { quantity: 1, unit: label, unitGrams: g }
    let foodId: string | undefined
    if (save) {
      const food: Food = {
        id: '', name: trimmed, brand: b, source: 'custom',
        perServing: { label, grams: g, nutrients: n },
      }
      if (g) {
        const per100g = {} as Nutrients
        for (const k of NUTRIENTS) per100g[k] = n[k] == null ? null : Math.round((n[k]! * 1000) / g) / 10
        food.per100g = per100g
        food.servings = [{ label, grams: g }]
      }
      try {
        foodId = (await api.saveFood(food)).id
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    await onLog({ name: trimmed, brand: b, grams: g, perUnit: n, amount, foodId, source: 'custom' })
    setBusy(false)
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        <div className="field">
          <label htmlFor="manual-name">Name</label>
          <input id="manual-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Burrito bowl" />
        </div>
        <div className="field">
          <label htmlFor="manual-brand">Brand (optional)</label>
          <input id="manual-brand" type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Trader Joe's" />
        </div>
        <div className="amount-row">
          <div className="field">
            <label htmlFor="manual-serving">Serving</label>
            <input id="manual-serving" type="text" value={serving} onChange={(e) => setServing(e.target.value)} placeholder="1 serving" />
          </div>
          <div className="field">
            <label htmlFor="manual-grams">Weighs (g, optional)</label>
            <input id="manual-grams" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
          </div>
        </div>
        <div className="hint">Numbers below are for {label}: “1 bowl”, “2 cookies”, “1 cup”.</div>
        <NutrientFields idPrefix="manual" value={draft} onChange={setDraft} />
        {badNumber && <div className="hint bad">Amounts must be non-negative numbers.</div>}
        {badGrams && <div className="hint bad">Weight must be between 0 and 10,000 g.</div>}
        {mismatch && (
          <div className="hint warn" role="status">
            <TriangleAlert size={13} aria-hidden="true" /> Protein, fat and carbs add up to about{' '}
            {Math.round(n.protein! * 4 + n.carbs! * 4 + n.fat! * 9)} kcal, not {n.calories}. Worth a second look.
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
          Save to My foods
        </label>
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" className="primary" disabled={!valid || busy} onClick={() => void submit()}>Log {label}</button>
        </div>
      </div>
    </>
  )
}
