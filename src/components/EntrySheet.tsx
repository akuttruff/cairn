import { useState } from 'react'
import { Drawer } from 'vaul'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { scale } from '../lib/nutrition.ts'
import { MEAL_LABELS, emptyDraft, parseNum } from '../lib/format.ts'
import type { NutrientDraft } from '../lib/format.ts'
import { MEALS, NUTRIENTS } from '../types.ts'
import type { Entry, Meal, Nutrients } from '../types.ts'
import NutrientFields from './NutrientFields.tsx'
import Preview from './Preview.tsx'

interface EntrySheetProps {
  open: boolean
  session: number
  /** Kept after closing, so the sheet doesn't go blank as it slides away. */
  entry: Entry | null
  onClose: () => void
  onChanged: () => void
}

const toDraft = (n: Nutrients): NutrientDraft => {
  const d = emptyDraft()
  for (const k of NUTRIENTS) d[k] = n[k] == null ? '' : String(n[k])
  return d
}

/**
 * Edit something already logged. A food from a database is edited by weight
 * (its per-100g values are kept); a manual entry by its numbers.
 */
export default function EntrySheet({ open, session, entry, onClose, onChanged }: EntrySheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content" aria-describedby={undefined}>
          <div className="drawer-handle" />
          {entry && <EntryForm key={session} entry={entry} onClose={onClose} onChanged={onChanged} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

function EntryForm({ entry, onClose, onChanged }: { entry: Entry; onClose: () => void; onChanged: () => void }) {
  const [meal, setMeal] = useState<Meal>(entry.meal)
  const [grams, setGrams] = useState(entry.grams == null ? '' : String(entry.grams))
  const [draft, setDraft] = useState<NutrientDraft>(() => toDraft(entry.nutrients))
  const [busy, setBusy] = useState(false)

  const byWeight = Boolean(entry.per100g)
  const g = parseNum(grams)
  const gramsOk = g != null && g > 0 && g <= 10_000

  const save = async (): Promise<void> => {
    const patch: Parameters<typeof api.updateEntry>[1] = {}
    if (meal !== entry.meal) patch.meal = meal
    if (byWeight) {
      if (!gramsOk) return
      if (g !== entry.grams) patch.grams = g
    } else {
      const n = {} as Nutrients
      for (const k of NUTRIENTS) n[k] = parseNum(draft[k])
      if (n.calories == null) { toast.error('Calories are required'); return }
      patch.nutrients = n
    }
    setBusy(true)
    try {
      await api.updateEntry(entry.id, patch)
      onChanged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.deleteEntry(entry.id)
      toast.success(`Removed ${entry.name}`)
      onChanged()
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
          <Drawer.Title className="drawer-title">{entry.name}</Drawer.Title>
          <div className="drawer-scroll short" data-vaul-no-drag>
            {entry.brand && <div className="hint" style={{ marginTop: -10, marginBottom: 12 }}>{entry.brand}</div>}
            <div className="field">
              <label htmlFor="edit-meal">Meal</label>
              <select id="edit-meal" value={meal} onChange={(e) => setMeal(e.target.value as Meal)}>
                {MEALS.map((m) => <option key={m} value={m}>{MEAL_LABELS[m]}</option>)}
              </select>
            </div>
            {byWeight && entry.per100g
              ? (
                <>
                  <div className="field grams">
                    <label htmlFor="edit-grams">Amount (g)</label>
                    <input id="edit-grams" type="text" inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} />
                  </div>
                  {gramsOk ? <Preview nutrients={scale(entry.per100g, g)} /> : <div className="hint bad">Enter a weight between 0 and 10,000 g.</div>}
                </>
              )
              : <NutrientFields idPrefix="edit" value={draft} onChange={setDraft} />}
          </div>
          <div className="drawer-actions">
            <div className="row">
              <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Delete</button>
              <button type="button" className="primary" disabled={busy || (byWeight && !gramsOk)} onClick={() => void save()}>Save</button>
            </div>
          </div>
    </>
  )
}
