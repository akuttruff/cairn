import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../../lib/api.ts'
import { draftHasJunk, draftOf, nutrientsOf } from '../../lib/format.ts'
import type { Food } from '../../types.ts'
import NutrientFields from '../NutrientFields.tsx'
import useNutrientDraft from '../../hooks/useNutrientDraft.ts'

/**
 * Correct a saved food's numbers -- fill in the fiber a lookup couldn't find,
 * fix a value it got wrong -- so every future log of it is right. Blank means
 * unknown. Entries already logged keep what they were logged with.
 */
export function EditFood({ food, onCancel, onSaved, fromResult = false }: {
  food: Food
  onCancel: () => void
  onSaved: (food: Food) => void
  /** Editing a search or lookup result rather than a food already in My foods. */
  fromResult?: boolean
}) {
  const [d100, setD100, auto100] = useNutrientDraft(food.per100g ? draftOf(food.per100g) : undefined)
  const [dServing, setDServing, autoServing] = useNutrientDraft(food.perServing ? draftOf(food.perServing.nutrients) : undefined)
  const [busy, setBusy] = useState(false)

  const junk = (food.per100g && draftHasJunk(d100)) || (food.perServing && draftHasJunk(dServing))

  const submit = async (): Promise<void> => {
    if (junk) return
    setBusy(true)
    try {
      const saved = await api.saveFood({
        ...food,
        per100g: food.per100g ? nutrientsOf(d100) : undefined,
        perServing: food.perServing ? { ...food.perServing, nutrients: nutrientsOf(dServing) } : undefined,
      })
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
        <div className="picked-name">
          <span className="entry-name">{food.name}</span>
          {food.brand && <span className="entry-sub">{food.brand}</span>}
        </div>
        {food.per100g && (
          <>
            <h3 className="sheet-h">Per 100 g</h3>
            <NutrientFields idPrefix="food-100g" value={d100} onChange={setD100} autoCalories={auto100} />
          </>
        )}
        {food.perServing && (
          <>
            <h3 className="sheet-h">Per {food.perServing.label}</h3>
            <NutrientFields idPrefix="food-serving" value={dServing} onChange={setDServing} autoCalories={autoServing} />
          </>
        )}
        <div className="hint">
          Leave a field blank if it&apos;s unknown.{' '}
          {fromResult
            ? 'Saving keeps a corrected copy in My foods, and a repeat lookup shows these numbers too. Entries you\u2019ve already logged keep theirs.'
            : 'This changes the saved food for future logs; entries you\u2019ve already logged keep their numbers (fix those from the entry).'}
        </div>
        {junk && <div className="hint bad">Numbers only, please.</div>}
      </div>
      <div className="drawer-actions">
        <div className="row">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary" disabled={busy || Boolean(junk)} onClick={() => void submit()}>Save</button>
        </div>
      </div>
    </>
  )
}
