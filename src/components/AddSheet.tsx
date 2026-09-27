import { useEffect, useMemo, useRef, useState } from 'react'
import { Drawer } from 'vaul'
import { ArrowLeft, Search, Star, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { SearchResult } from '../lib/api.ts'
import { calorieMismatch, scale } from '../lib/nutrition.ts'
import { MEAL_LABELS, emptyDraft, fmt, parseNum } from '../lib/format.ts'
import type { NutrientDraft } from '../lib/format.ts'
import { MEALS, NUTRIENTS } from '../types.ts'
import type { Food, Meal, NewEntry, Nutrients, Serving } from '../types.ts'
import NutrientFields from './NutrientFields.tsx'
import Preview from './Preview.tsx'

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
  const p = food.per100g
  return (
    <button type="button" className="food-row" onClick={() => onPick(food)}>
      <div className="entry-main">
        <span className="entry-name">{food.name}</span>
        {food.brand && <span className="entry-sub">{food.brand}</span>}
      </div>
      <div className="entry-nums">
        <span className="entry-kcal">{fmt('calories', p.calories)}<small> /100g</small></span>
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

  return (
    <>
      <div className="search-box">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          placeholder="Search foods"
          aria-label="Search foods"
          autoCorrect="off"
          enterKeyHint="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="drawer-scroll" data-vaul-no-drag>
        {busy && <div className="hint center">Searching…</div>}
        {error && <div className="hint bad center">{error}</div>}
        {result && !busy && (
          <>
            <ResultGroup title="Whole foods" subtitle="USDA" foods={result.usda} error={errorFor('usda')} onPick={onPick} />
            <ResultGroup title="Packaged" subtitle="Open Food Facts" foods={result.off} error={errorFor('off')} onPick={onPick} />
          </>
        )}
        {!query && (
          <div className="hint center">
            Whole foods come from USDA FoodData Central; branded and packaged
            foods from Open Food Facts.
          </div>
        )}
      </div>
    </>
  )
}

function ResultGroup({ title, subtitle, foods, error, onPick }: {
  title: string; subtitle: string; foods: Food[]; error?: string; onPick: (f: Food) => void
}) {
  return (
    <section className="result-group" aria-label={title}>
      <h3 className="sheet-h">{title} <span className="src">{subtitle}</span></h3>
      {error && <div className="hint bad">{error}</div>}
      {!error && foods.length === 0 && <div className="hint">No matches.</div>}
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

/** Pick how much of a chosen food. Everything is in grams underneath. */
function Amount({ food, onLog }: { food: Food; onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void> }) {
  const [servings, setServings] = useState<Serving[]>(food.servings ?? [])
  const [grams, setGrams] = useState(String(food.servings?.[0]?.grams ?? 100))
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
      // Prefer a real household measure over the 100 g default -- unless the
      // food already had servings, or you've already typed something.
      if (!food.servings?.length) setGrams((g) => (g === '100' ? String(p[0]!.grams) : g))
    }).catch(() => { /* grams still work */ })
    return () => { live = false }
  }, [food])

  const g = parseNum(grams)
  const valid = g != null && g > 0 && g <= 10_000
  const nutrients = useMemo(() => (valid ? scale(food.per100g, g) : null), [food, g, valid])

  const submit = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    if (save) {
      try {
        await api.saveFood({ ...food, servings })
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    await onLog({
      name: food.name, brand: food.brand, grams: g, per100g: food.per100g, foodId: food.id, source: food.source,
    })
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

        {servings.length > 0 && (
          <div className="chips">
            {servings.map((s) => (
              <button
                type="button"
                key={s.label}
                className={`chip${g === s.grams ? ' on' : ''}`}
                onClick={() => setGrams(String(s.grams))}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        <div className="field grams">
          <label htmlFor="amount-grams">Amount (g)</label>
          <input
            id="amount-grams"
            type="text"
            inputMode="decimal"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
          />
        </div>

        {nutrients ? <Preview nutrients={nutrients} /> : <div className="hint bad">Enter a weight between 0 and 10,000 g.</div>}
        {NUTRIENTS.some((k) => food.per100g[k] == null) && (
          <div className="hint">— means the source doesn&apos;t report it; it won&apos;t count as zero.</div>
        )}
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" className="primary" disabled={!valid || busy} onClick={() => void submit()}>
            Log {valid ? `${fmt('protein', g)} g` : ''}
          </button>
        </div>
      </div>
    </>
  )
}

function toNutrients(draft: NutrientDraft): Nutrients {
  const out = {} as Nutrients
  for (const k of NUTRIENTS) out[k] = parseNum(draft[k])
  return out
}

/** A label, a restaurant guess, a recipe: type the numbers in. */
function ManualTab({ onLog }: { onLog: (e: Omit<NewEntry, 'date' | 'meal'>) => Promise<void> }) {
  const [name, setName] = useState('')
  const [grams, setGrams] = useState('')
  const [draft, setDraft] = useState<NutrientDraft>(emptyDraft)
  const [save, setSave] = useState(false)
  const [busy, setBusy] = useState(false)

  const n = toNutrients(draft)
  const g = parseNum(grams)
  const badNumber = NUTRIENTS.some((k) => draft[k].trim() && (n[k] == null || n[k]! < 0))
  const badGrams = grams.trim() !== '' && (g == null || g <= 0 || g > 10_000)
  const valid = name.trim() !== '' && n.calories != null && !badNumber && !badGrams
  const mismatch = calorieMismatch(n)

  const submit = async (): Promise<void> => {
    if (!valid) return
    setBusy(true)
    const trimmed = name.trim()
    if (save && g) {
      const per100g = {} as Nutrients
      for (const k of NUTRIENTS) per100g[k] = n[k] == null ? null : Math.round((n[k]! * 1000) / g) / 10
      try {
        const food = await api.saveFood({
          id: '', name: trimmed, source: 'custom', per100g, servings: [{ label: `1 serving (${g} g)`, grams: g }],
        })
        await onLog({ name: trimmed, grams: g, per100g, foodId: food.id, source: 'custom' })
        setBusy(false)
        return
      } catch (err) {
        toast.error(`Couldn't save to My foods: ${(err as Error).message}`)
      }
    }
    await onLog({ name: trimmed, grams: g, nutrients: n, source: 'custom' })
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
          <label htmlFor="manual-grams">Weight (g, optional)</label>
          <input id="manual-grams" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
        </div>
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
          <input type="checkbox" checked={save} disabled={!g} onChange={(e) => setSave(e.target.checked)} />
          Save to My foods {g ? '' : '(needs a weight)'}
        </label>
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" className="primary" disabled={!valid || busy} onClick={() => void submit()}>Log</button>
        </div>
      </div>
    </>
  )
}
