import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Star, Trash2, UtensilsCrossed, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { sumNutrients } from '../../lib/nutrition.ts'
import { amountOf, entryFor, foodFromItem, nutrientsFor, resolveNutrients, unitsFor } from '../../lib/units.ts'
import { fmt, parseNum } from '../../lib/format.ts'
import type { Food, MealPreset, MealPresetItem, Nutrients } from '../../types.ts'
import Preview from '../Preview.tsx'
import { EditFood } from './EditFood.tsx'
import { FoodRow } from './FoodRow.tsx'
import { normalizeFoods, mealFoodIds, normalizeMeals } from './foods.ts'
export function MineTab({ onPick, onApplyMeal }: { onPick: (f: Food) => void; onApplyMeal: (preset: MealPreset) => Promise<void> }) {
  const [foods, setFoods] = useState<{ saved: Food[]; recent: Food[] } | null>(null)
  const [presets, setPresets] = useState<MealPreset[]>([])
  const [error, setError] = useState<string | null>(null)
  // Selecting which saved foods go into a new meal, and building it once
  // they're chosen (see CreateMeal) -- a food is never re-fetched for this,
  // only the amount of each is picked, same as logging one normally would.
  const [picking, setPicking] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [building, setBuilding] = useState<Food[] | null>(null)
  const [editing, setEditing] = useState<Food | null>(null)
  // A saved meal being edited: its name and amounts prefill the builder, and
  // picking more foods keeps it, so "Add foods" comes back to the same meal.
  const [editingMeal, setEditingMeal] = useState<MealPreset | null>(null)

  /** The foods a meal's items were built from -- the saved copy when it is still there, else one rebuilt from the item. */
  const foodsOfMeal = (preset: MealPreset): Food[] => preset.items.map((item, i) => (
    (item.foodId && foods?.saved.find((f) => f.id === item.foodId)) || foodFromItem(item, `meal-item:${preset.id}:${i}`)
  ))
  const editMeal = (preset: MealPreset): void => {
    setEditingMeal(preset)
    setBuilding(foodsOfMeal(preset))
  }

  useEffect(() => {
    api.foods().then((f) => setFoods(normalizeFoods(f))).catch((err: Error) => setError(err.message))
    api.meals().then((p) => setPresets(normalizeMeals(p))).catch(() => { /* meals just won't show */ })
  }, [])

  const remove = async (food: Food): Promise<void> => {
    try {
      await api.deleteFood(food.id)
      setFoods((f) => f && { ...f, saved: f.saved.filter((x) => x.id !== food.id) })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const inMeal = useMemo(() => mealFoodIds(presets), [presets])

  const removeMeal = async (preset: MealPreset): Promise<void> => {
    try {
      await api.deleteMeal(preset.id)
      setPresets((list) => list.filter((p) => p.id !== preset.id))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  if (editing) {
    return (
      <EditFood
        food={editing}
        onCancel={() => setEditing(null)}
        onSaved={(saved) => {
          setFoods((f) => f && { ...f, saved: f.saved.map((x) => (x.id === saved.id ? saved : x)) })
          setEditing(null)
        }}
      />
    )
  }

  if (building) {
    return (
      <CreateMeal
        items={building}
        preset={editingMeal ?? undefined}
        onCancel={() => { setBuilding(null); setEditingMeal(null) }}
        onSaved={(preset) => {
          setPresets((list) => [...list.filter((p) => p.id !== preset.id), preset].sort((a, b) => a.name.localeCompare(b.name)))
          setBuilding(null)
          setEditingMeal(null)
        }}
        onAddFoods={(draft) => {
          // Keep what has been typed so far, then go pick: the saved foods
          // already in the meal start ticked.
          const kept: MealPreset = { id: editingMeal?.id ?? '', name: draft.name, items: draft.items, createdAt: editingMeal?.createdAt ?? Date.now() }
          setEditingMeal(kept)
          setSelected(new Set(draft.items.map((i) => i.foodId).filter((id): id is string => Boolean(id))))
          setBuilding(null)
          setPicking(true)
        }}
      />
    )
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        {error && <div className="hint bad center">{error}</div>}
        {presets.length > 0 && !picking && (
          <>
            <h3 className="sheet-h">Meals</h3>
            {presets.map((p) => (
              <MealRow key={p.id} preset={p} onApply={() => void onApplyMeal(p)} onEdit={() => editMeal(p)} onDelete={() => void removeMeal(p)} />
            ))}
          </>
        )}
        {foods && (
          <>
            <div className="sheet-h-row">
              <h3 className="sheet-h">Saved</h3>
              {!picking && foods.saved.length > 0 && (
                <button type="button" className="link-btn accent" onClick={() => { setSelected(new Set()); setPicking(true) }}>
                  + Create meal
                </button>
              )}
            </div>
            {foods.saved.length === 0 && <div className="hint">Star a food when logging it to keep it here.</div>}
            {foods.saved.map((f) => (
              picking ? (
                <PickRow key={f.id} food={f} selected={selected.has(f.id)} onToggle={() => toggle(f.id)} inMeal={inMeal.has(f.id)} />
              ) : (
                <div key={f.id} className="saved-row">
                  <FoodRow food={f} onPick={onPick} inMeal={inMeal.has(f.id)} />
                  <button type="button" className="edit-food" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
                    <Pencil size={15} aria-hidden="true" />
                  </button>
                  <button type="button" className="unsave" aria-label={`Remove ${f.name} from My foods`} onClick={() => void remove(f)}>
                    <Star size={16} fill="currentColor" aria-hidden="true" />
                  </button>
                </div>
              )
            ))}
          </>
        )}
      </div>
      {picking && (
        <div className="drawer-actions">
          <div className="row">
            <button type="button" onClick={() => { setPicking(false); if (editingMeal) setBuilding(foodsOfMeal(editingMeal)) }}>Cancel</button>
            <button
              type="button" className="primary" disabled={selected.size === 0}
              onClick={() => {
                const chosen = (foods?.saved ?? []).filter((f) => selected.has(f.id))
                // Editing: items whose food is no longer saved cannot be re-picked, so they stay as they were.
                const unsaved = editingMeal ? foodsOfMeal(editingMeal).filter((f) => f.id.startsWith('meal-item:')) : []
                setBuilding([...unsaved, ...chosen])
                setPicking(false)
              }}
            >
              Next{selected.size > 0 ? ` (${selected.size})` : ''}
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function PickRow({ food, selected, onToggle, inMeal }: { food: Food; selected: boolean; onToggle: () => void; inMeal?: boolean }) {
  return (
    <button type="button" className="pick-row" onClick={onToggle} aria-pressed={selected}>
      <span className={`pick-check${selected ? ' on' : ''}`} aria-hidden="true">
        {selected && <Check size={13} aria-hidden="true" />}
      </span>
      <div className="entry-main">
        <span className="entry-name">
          {food.name}
          {inMeal && <UtensilsCrossed size={12} className="meal-badge" aria-label="Part of a saved meal" />}
        </span>
        {food.brand && <span className="entry-sub">{food.brand}</span>}
      </div>
    </button>
  )
}

/** A saved meal: tap to log every one of its foods at once; the trash can deletes it. */
function MealRow({ preset, onApply, onEdit, onDelete }: { preset: MealPreset; onApply: () => void; onEdit: () => void; onDelete: () => void }) {
  const total = sumNutrients(preset.items.map(resolveNutrients).filter((n): n is Nutrients => n != null))
  return (
    <div className="saved-row">
      <button type="button" className="food-row" onClick={onApply}>
        <div className="entry-main">
          <span className="entry-name">{preset.name}</span>
          <span className="entry-sub">{preset.items.length} food{preset.items.length === 1 ? '' : 's'}</span>
        </div>
        <div className="entry-nums">
          <span className="entry-kcal">{fmt('calories', total.calories)}</span>
          <span className="entry-macros">
            P {fmt('protein', total.protein)} · F {fmt('fat', total.fat)} · C {fmt('carbs', total.carbs)} · Fib {fmt('fiber', total.fiber)}
          </span>
        </div>
      </button>
      <button type="button" className="edit-food" aria-label={`Edit ${preset.name}`} onClick={onEdit}>
        <Pencil size={15} aria-hidden="true" />
      </button>
      <button type="button" className="unsave" aria-label={`Delete ${preset.name}`} onClick={onDelete}>
        <Trash2 size={16} aria-hidden="true" />
      </button>
    </div>
  )
}

interface MealDraftItem {
  food: Food
  unitKey: string
  qty: string
}

/**
 * Name a new meal and pick how much of each selected food it contains --
 * the same amount-picking as logging one food, once per item, then saved as
 * a single reusable preset instead of logged right away.
 */
function CreateMeal({ items, preset, onCancel, onSaved, onAddFoods }: {
  items: Food[]
  /** Editing: the meal's name, id and the amounts its items were saved with. */
  preset?: Pick<MealPreset, 'id' | 'name' | 'items'>
  onCancel: () => void
  onSaved: (preset: MealPreset) => void
  /** Go and pick more foods, keeping the name and amounts entered so far. */
  onAddFoods?: (draft: { name: string; items: MealPresetItem[] }) => void
}) {
  const [name, setName] = useState(preset?.name ?? '')
  const [drafts, setDrafts] = useState<MealDraftItem[]>(() => items.map((food) => {
    // Edited: how this food was measured in the meal; new: the food's most natural unit.
    const saved = preset?.items.find((i) => i.foodId === food.id || (!i.foodId && i.name === food.name))
    if (saved) return { food, ...amountOf(food, saved) }
    const first = unitsFor(food)[0]
    return { food, unitKey: first?.key ?? 'g', qty: first?.key === 'g' ? '100' : '1' }
  }))
  const [busy, setBusy] = useState(false)

  const rows = drafts.map((d) => {
    const units = unitsFor(d.food)
    const unit = units.find((u) => u.key === d.unitKey) ?? units[0]
    const q = parseNum(d.qty)
    const valid = unit != null && q != null && q > 0
    return { draft: d, units, unit, valid, nutrients: valid ? nutrientsFor(d.food, unit!, q!) : null }
  })
  const allValid = name.trim() !== '' && rows.length > 0 && rows.every((r) => r.valid)
  const total = sumNutrients(rows.map((r) => r.nutrients).filter((n): n is Nutrients => n != null))

  const update = (id: string, patch: Partial<MealDraftItem>): void => {
    setDrafts((prev) => prev.map((d) => (d.food.id === id ? { ...d, ...patch } : d)))
  }

  const submit = async (): Promise<void> => {
    if (!allValid) return
    setBusy(true)
    try {
      const built = rows.map(({ draft, unit }) => entryFor(draft.food, unit!, parseNum(draft.qty)!))
      const saved = await api.saveMeal({ ...(preset?.id ? { id: preset.id } : {}), name: name.trim(), items: built })
      toast.success(`Saved ${saved.name}`)
      onSaved(saved)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="drawer-scroll" data-vaul-no-drag>
        <div className="field">
          <label htmlFor="meal-name">Meal name</label>
          <input
            id="meal-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Breakfast burrito"
          />
        </div>
        {rows.length === 0 && <div className="hint bad">Every food was removed. Cancel and pick again.</div>}
        {rows.map(({ draft, units, unit, nutrients }) => (
          <div key={draft.food.id} className="meal-item">
            <div className="meal-item-main">
              <span className="entry-name">{draft.food.name}</span>
              <span className="entry-sub">{nutrients ? `${fmt('calories', nutrients.calories)} kcal` : 'Enter an amount'}</span>
            </div>
            <input
              type="text" inputMode="decimal" className="meal-item-qty" aria-label={`Amount of ${draft.food.name}`}
              value={draft.qty} onChange={(e) => update(draft.food.id, { qty: e.target.value })}
            />
            <select
              className="meal-item-unit" aria-label={`Unit for ${draft.food.name}`}
              value={unit?.key ?? ''} onChange={(e) => update(draft.food.id, { unitKey: e.target.value })}
            >
              {units.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
            <button
              type="button" className="meal-item-remove" aria-label={`Remove ${draft.food.name} from this meal`}
              onClick={() => setDrafts((prev) => prev.filter((d) => d.food.id !== draft.food.id))}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
        {onAddFoods && (
          <button
            type="button" className="link-btn accent"
            onClick={() => onAddFoods({
              name,
              // Whatever is valid so far comes along; a half-typed amount starts over.
              items: rows.filter((r) => r.valid).map(({ draft, unit }) => entryFor(draft.food, unit!, parseNum(draft.qty)!)),
            })}
          >
            + Add foods
          </button>
        )}
        {rows.length > 0 && (
          <>
            <h3 className="sheet-h">Total</h3>
            <Preview nutrients={total} />
          </>
        )}
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={!allValid || busy} onClick={() => void submit()}>Save meal</button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
