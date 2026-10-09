import { useEffect, useState } from 'react'
import { UtensilsCrossed } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { MealPreset, MealPresetItem } from '../types.ts'

/**
 * Put this food, at the amount shown, into a saved meal -- one that exists,
 * or a new one named here -- without leaving the screen. The meal is saved
 * back with the food appended; nothing is logged.
 */
export default function AddToMeal({ item, disabled }: { item: MealPresetItem | null; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [presets, setPresets] = useState<MealPreset[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || presets) return
    api.meals().then((p) => setPresets(Array.isArray(p) ? p : [])).catch(() => setPresets([]))
  }, [open, presets])

  const save = async (target: { id?: string; name: string; items: MealPresetItem[] }): Promise<void> => {
    if (!item) return
    setBusy(true)
    try {
      const saved = await api.saveMeal({ ...target, items: [...target.items, item] })
      toast.success(`Added ${item.name} to ${saved.name}`)
      setPresets((list) => (list ?? []).filter((p) => p.id !== saved.id).concat(saved).sort((a, b) => a.name.localeCompare(b.name)))
      setOpen(false)
      setName('')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="link-btn accent add-to-meal" disabled={disabled || !item} onClick={() => setOpen(true)}>
        <UtensilsCrossed size={13} aria-hidden="true" /> Add to a meal
      </button>
    )
  }
  return (
    <section className="add-to-meal-panel" aria-label="Add to a meal">
      <h3 className="sheet-h">Add to a meal</h3>
      {presets === null && <div className="hint">Loading your meals…</div>}
      {presets?.map((p) => (
        <button key={p.id} type="button" className="pick-row" disabled={busy} onClick={() => void save(p)}>
          <span className="entry-main">
            <span className="entry-name">{p.name}</span>
            <span className="entry-sub">{p.items.length} food{p.items.length === 1 ? '' : 's'}</span>
          </span>
        </button>
      ))}
      {presets?.length === 0 && <div className="hint">No saved meals yet. Name one below.</div>}
      <form
        className="add-to-meal-new"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save({ name: name.trim(), items: [] }) }}
      >
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New meal name" aria-label="New meal name" />
        <button type="submit" className="primary" disabled={busy || !name.trim()}>Add</button>
      </form>
      <button type="button" className="link-btn" onClick={() => setOpen(false)}>Cancel</button>
    </section>
  )
}
