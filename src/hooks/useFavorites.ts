import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import type { Food } from '../types.ts'

export interface Favorites {
  /** Ids of the foods currently in My foods, among the ones this hook was given. */
  ids: Set<string>
  toggle: (food: Food) => Promise<void>
}

/**
 * Which of a list of foods are already saved to My foods, and a toggle to
 * save or unsave one directly from a result row -- without picking an
 * amount or logging it first. Especially worth having for an online
 * lookup, which can take a minute or two to repeat.
 */
export function useFavorites(saved: Food[]): Favorites {
  const [ids, setIds] = useState<Set<string>>(() => new Set(saved.map((f) => f.id)))
  // Reseed from a freshly (re)fetched saved list, adjusted during render
  // rather than in an effect -- toggle's own updates are the local state
  // moving on ahead of `saved`, not a value to resync on every render.
  const [seededFrom, setSeededFrom] = useState(saved)
  if (saved !== seededFrom) {
    setSeededFrom(saved)
    setIds(new Set(saved.map((f) => f.id)))
  }

  const toggle = async (food: Food): Promise<void> => {
    const favorited = ids.has(food.id)
    try {
      if (favorited) {
        await api.deleteFood(food.id)
        setIds((prev) => { const next = new Set(prev); next.delete(food.id); return next })
        toast.success(`Removed ${food.name} from My foods`)
      } else {
        await api.saveFood(food)
        setIds((prev) => new Set(prev).add(food.id))
        toast.success(`Saved ${food.name} to My foods`)
      }
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return { ids, toggle }
}
