import { useState } from 'react'
import { emptyDraft, withAutoCalories } from '../lib/format.ts'
import type { NutrientDraft } from '../lib/format.ts'

/**
 * A NutrientDraft whose Calories field auto-computes from protein/fat/carbs
 * until you type your own value into it (see withAutoCalories). Starts in
 * auto mode unless the initial draft already carries a Calories value --
 * e.g. editing an entry that already has one, which is left alone until you
 * touch it.
 */
export default function useNutrientDraft(
  initial: NutrientDraft = emptyDraft(),
): readonly [NutrientDraft, (next: NutrientDraft) => void, boolean] {
  const [state, setState] = useState(() => ({
    draft: initial,
    caloriesIsAuto: initial.calories.trim() === '',
  }))

  const setDraft = (next: NutrientDraft): void => {
    setState((prev) => withAutoCalories(prev.draft, next, prev.caloriesIsAuto))
  }

  return [state.draft, setDraft, state.caloriesIsAuto] as const
}
