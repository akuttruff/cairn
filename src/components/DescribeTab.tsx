import { useEffect, useMemo, useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { api } from '../lib/api.ts'
import type { IntakeItem, IntakeJob } from '../lib/api.ts'
import { suggestAmount, unitByKey } from '../lib/intake.ts'
import { entryFor, nutrientsFor, unitsFor } from '../lib/units.ts'
import { fmt, parseNum } from '../lib/format.ts'
import { sumNutrients } from '../lib/nutrition.ts'
import type { Food, MealPresetItem, Nutrients } from '../types.ts'

const JOB_KEY = 'macros.intake'
const POLL_MS = 1500
const PLACEHOLDER = '2 scrambled eggs with a little butter, a slice of sourdough toast, and a latte with oat milk'

const readSaved = (): string | null => { try { return localStorage.getItem(JOB_KEY) } catch { return null } }
const save = (id: string): void => { try { localStorage.setItem(JOB_KEY, id) } catch { /* not restored, that's all */ } }
const forget = (): void => { try { localStorage.removeItem(JOB_KEY) } catch { /* nothing to forget */ } }

/** What you decided about one described food: whether to log it, which match, how much. */
interface Choice {
  include: boolean
  foodIndex: number
  unitKey: string
  qty: string
}

/**
 * Say what you ate, in words. The model splits it into foods, each is looked
 * up the way a search result is, and the lot comes back as a list to check:
 * untick a wrong one, pick another match, fix an amount, then log them all
 * to the meal chosen above. Like a lookup, it keeps going with the phone
 * locked, and is picked back up on the next opening.
 */
export default function DescribeTab({ onLog, onSearch }: {
  onLog: (entries: MealPresetItem[]) => Promise<void>
  /** Hand a food the lookup could not place over to the search box. */
  onSearch: (text: string) => void
}) {
  const [text, setText] = useState('')
  const [job, setJob] = useState<IntakeJob | null>(null)
  const [choices, setChoices] = useState<Map<number, Choice>>(() => new Map())
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const running = job?.status === 'running'

  // A description still being worked out, or worked out and not yet logged,
  // when the sheet was last closed. The server keeps one for an hour.
  useEffect(() => {
    const id = readSaved()
    if (!id) return
    api.intake(id).then((j) => {
      if (j.status === 'error') forget()
      else { setJob(j); setText(j.text) }
    }).catch(forget)
  }, [])

  useEffect(() => {
    if (!running || !job) return
    const t = setInterval(() => {
      setNow(Date.now())
      api.intake(job.id).then((j) => {
        setJob((cur) => (cur?.id === j.id ? j : cur))
        if (j.status === 'error') forget()
      }).catch(() => { /* try again next tick */ })
    }, POLL_MS)
    return () => clearInterval(t)
  }, [running, job?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Each food, as it comes in, starts at the amount that was described, until you change it.
  const choiceFor = (i: number, item: IntakeItem): Choice | undefined =>
    choices.get(i) ?? (item.status === 'done' && item.foods?.length ? { include: true, foodIndex: 0, ...suggestAmount(item.foods[0]!, item) } : undefined)

  const start = async (): Promise<void> => {
    const words = text.trim()
    if (words.length < 3 || running) return
    setChoices(new Map())
    try {
      const j = await api.startIntake(words)
      setJob(j)
      if (j.status !== 'error') save(j.id)
    } catch (err) {
      setJob({ id: '', text: words, status: 'error', step: 'failed', startedAt: Date.now(), items: [], error: (err as Error).message })
    }
  }

  const cancel = (): void => {
    if (!job) return
    void api.cancelIntake(job.id)
    forget()
    setJob({ ...job, status: 'error', error: 'Cancelled.' })
  }

  const reset = (): void => {
    forget()
    setJob(null)
    setChoices(new Map())
  }

  const update = (i: number, patch: Partial<Choice>): void => {
    const item = job?.items[i]
    const cur = item && choiceFor(i, item)
    if (!cur) return
    setChoices((prev) => new Map(prev).set(i, { ...cur, ...patch }))
  }

  const rows = useMemo(() => (job?.items ?? []).map((item, i) => {
    const choice = choiceFor(i, item)
    const food = choice ? item.foods?.[choice.foodIndex] ?? item.foods?.[0] : undefined
    const unit = food && choice ? unitByKey(food, choice.unitKey) : undefined
    const q = choice ? parseNum(choice.qty) : null
    const valid = food != null && unit != null && q != null && q > 0 && q <= 10_000
    const nutrients = valid ? nutrientsFor(food, unit, q) : null
    return { item, i, choice, food, unit, q, valid, nutrients }
  }), [job, choices]) // eslint-disable-line react-hooks/exhaustive-deps -- choiceFor reads only these two

  const picked = rows.filter((r) => r.choice?.include && r.food)
  const ready = job?.status === 'done' && picked.length > 0 && picked.every((r) => r.valid && r.nutrients)
  const total = sumNutrients(picked.map((r) => r.nutrients).filter((n): n is Nutrients => n != null))

  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    try {
      await onLog(picked.map((r) => entryFor(r.food!, r.unit!, r.q!)))
      forget()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="drawer-scroll describe" data-vaul-no-drag>
        <div className="field">
          <label htmlFor="describe-text">What did you eat?</label>
          <textarea
            id="describe-text"
            rows={3}
            value={text}
            placeholder={PLACEHOLDER}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {!job && (
          <>
            <button type="button" className="lookup-btn" disabled={text.trim().length < 3} onClick={() => void start()}>
              <Sparkles size={15} aria-hidden="true" /> Work out the foods
            </button>
            <div className="hint">
              The model splits this into foods and looks each one up online, the way Search does. Amounts come out
              as you said them, so “2 eggs” is logged as two, and you check the list before anything is logged.
            </div>
          </>
        )}

        {job && (
          <section className="describe-result" aria-label="Foods found" aria-live="polite">
            {running && (
              <div className="lookup-status">
                <span className="spinner" aria-hidden="true" />
                <span>Working it out… {job.step} · {Math.max(0, Math.round((now - job.startedAt) / 1000))}s</span>
                <button type="button" className="link-btn" onClick={cancel}>Cancel</button>
              </div>
            )}
            {job.status === 'error' && (
              <>
                <div className="hint bad" role="alert">{job.error}</div>
                <div className="row">
                  <button type="button" onClick={() => void start()}>Try again</button>
                  <button type="button" onClick={reset}>Start over</button>
                </div>
              </>
            )}
            {rows.map(({ item, i, choice, food, unit, nutrients, valid }) => (
              <div key={i} className={`described${choice?.include === false ? ' off' : ''}`}>
                <button
                  type="button"
                  className="described-head"
                  disabled={!choice}
                  aria-pressed={choice?.include ?? false}
                  aria-label={`${choice?.include ? 'Skip' : 'Include'} ${item.text}`}
                  onClick={() => update(i, { include: !choice?.include })}
                >
                  <span className={`pick-check${choice?.include ? ' on' : ''}`} aria-hidden="true">
                    {choice?.include && <Check size={13} aria-hidden="true" />}
                  </span>
                  <span className="described-text">{item.text}</span>
                  <span className="described-kcal">{nutrients ? `${fmt('calories', nutrients.calories)} kcal` : ''}</span>
                </button>
                {item.status === 'pending' && <div className="hint">Waiting…</div>}
                {item.status === 'looking' && <div className="hint"><span className="spinner inline" aria-hidden="true" /> Looking it up… {item.step}</div>}
                {item.status === 'error' && <NotFound item={item} why={item.error} onSearch={onSearch} />}
                {item.status === 'done' && !item.foods?.length && <NotFound item={item} why={item.note} onSearch={onSearch} />}
                {item.status === 'done' && food && choice && (
                  <div className="described-body">
                    {item.foods!.length > 1
                      ? (
                        <select
                          aria-label={`Match for ${item.text}`}
                          value={choice.foodIndex}
                          onChange={(e) => {
                            const idx = Number(e.target.value)
                            const f = item.foods![idx]!
                            update(i, { foodIndex: idx, ...suggestAmount(f, item) })
                          }}
                        >
                          {item.foods!.map((f, idx) => <option key={f.id} value={idx}>{foodLabel(f)}</option>)}
                        </select>
                      )
                      : <div className="described-match">{foodLabel(food)}</div>}
                    <div className="described-amount">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Amount of ${item.text}`}
                        value={choice.qty}
                        onChange={(e) => update(i, { qty: e.target.value })}
                      />
                      <select
                        aria-label={`Unit of ${item.text}`}
                        value={unit?.key ?? ''}
                        onChange={(e) => update(i, { unitKey: e.target.value, qty: e.target.value === 'g' ? '100' : '1' })}
                      >
                        {unitsFor(food).map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                      </select>
                    </div>
                    {!valid && <div className="hint bad">Amount must be a number up to 10,000.</div>}
                    {nutrients && (
                      <div className="described-macros">
                        P {fmt('protein', nutrients.protein)} · F {fmt('fat', nutrients.fat)} · C {fmt('carbs', nutrients.carbs)} · Fib {fmt('fiber', nutrients.fiber)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {job.status === 'done' && (
              <div className="lookup-again">
                {job.model && <span className="hint-inline">via {job.model}</span>}
                <button type="button" className="link-btn" onClick={reset}>Start over</button>
              </div>
            )}
          </section>
        )}
      </div>
      {job?.status === 'done' && (
        <div className="drawer-actions">
          <div className="row">
            <button type="button" className="primary" disabled={!ready || busy} onClick={() => void submit()}>
              Log {picked.length} food{picked.length === 1 ? '' : 's'}{ready ? ` · ${fmt('calories', total.calories)} kcal` : ''}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

const foodLabel = (f: Food): string => (f.brand ? `${f.name} · ${f.brand}` : f.name)

function NotFound({ item, why, onSearch }: { item: IntakeItem; why?: string; onSearch: (text: string) => void }) {
  return (
    <div className="described-body">
      <div className="hint">Nothing reliable found{why ? `: ${why}` : '.'}</div>
      <button type="button" className="link-btn accent" onClick={() => onSearch(item.food)}>Search for “{item.food}” instead</button>
    </div>
  )
}
