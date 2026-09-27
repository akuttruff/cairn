import { describe, it, expect } from 'vitest'
import { emptyDraft, withAutoCalories } from './format.ts'
import type { NutrientDraft } from './format.ts'

const draft = (over: Partial<NutrientDraft> = {}): NutrientDraft => ({ ...emptyDraft(), ...over })

/** Apply a sequence of drafts in order, as a sequence of user edits would. */
function run(start: { draft: NutrientDraft; caloriesIsAuto: boolean }, ...edits: NutrientDraft[]) {
  let state = start
  for (const next of edits) state = withAutoCalories(state.draft, next, state.caloriesIsAuto)
  return state
}

describe('withAutoCalories', () => {
  it('starts blank and fills in as each macro is typed, live', () => {
    // Each step spreads the previous draft, as NutrientFields' onChange does
    // ({ ...value, [key]: next }) -- carrying the last computed calories
    // forward, rather than resetting it, is exactly what's under test.
    let state = { draft: emptyDraft(), caloriesIsAuto: true }
    state = withAutoCalories(state.draft, { ...state.draft, protein: '30' }, state.caloriesIsAuto)
    expect(state.draft.calories).toBe('120') // 30 * 4
    state = withAutoCalories(state.draft, { ...state.draft, fat: '25' }, state.caloriesIsAuto)
    expect(state.draft.calories).toBe('345') // + 25 * 9
    state = withAutoCalories(state.draft, { ...state.draft, carbs: '80' }, state.caloriesIsAuto)
    expect(state.draft.calories).toBe('665') // + 80 * 4
    expect(state.caloriesIsAuto).toBe(true)
  })

  it('leaves calories blank until at least one macro is typed', () => {
    const state = withAutoCalories(emptyDraft(), draft({ protein: '' }), true)
    expect(state.draft.calories).toBe('')
  })

  it('a typed calories value is kept exactly, and locks out the macros', () => {
    const state = run(
      { draft: emptyDraft(), caloriesIsAuto: true },
      draft({ calories: '6500' }),
      draft({ calories: '6500', protein: '30' }),
      draft({ calories: '6500', protein: '30', fat: '25' }),
      draft({ calories: '6500', protein: '30', fat: '25', carbs: '80' }),
    )
    expect(state.draft.calories).toBe('6500') // never overwritten by the 665 the macros imply
    expect(state.caloriesIsAuto).toBe(false)
  })

  it('clearing calories is taken verbatim -- it does not snap back to the implied value in the same edit', () => {
    // Regression: recomputing immediately would turn a clear-then-retype
    // ("650") into the old implied value plus what's typed next ("665650").
    const locked = run(
      { draft: emptyDraft(), caloriesIsAuto: true },
      draft({ calories: '6500' }),
      draft({ calories: '6500', protein: '30', fat: '25', carbs: '80' }),
    )
    const cleared = withAutoCalories(locked.draft, { ...locked.draft, calories: '' }, locked.caloriesIsAuto)
    expect(cleared.draft.calories).toBe('')
    expect(cleared.caloriesIsAuto).toBe(true) // control handed back to the macros...
    // ...so the very next character starts fresh, not appended to a refilled value.
    const retyped = withAutoCalories(cleared.draft, { ...cleared.draft, calories: '6' }, cleared.caloriesIsAuto)
    expect(retyped.draft.calories).toBe('6')
  })

  it('clearing calories resumes live tracking on the next macro edit', () => {
    const locked = run(
      { draft: emptyDraft(), caloriesIsAuto: true },
      draft({ calories: '6500' }),
      draft({ calories: '6500', protein: '30', fat: '25', carbs: '80' }),
    )
    const cleared = withAutoCalories(locked.draft, { ...locked.draft, calories: '' }, locked.caloriesIsAuto)
    const resumed = withAutoCalories(cleared.draft, { ...cleared.draft, carbs: '90' }, cleared.caloriesIsAuto)
    expect(resumed.draft.calories).toBe('705') // 30*4 + 90*4 + 25*9
    expect(resumed.caloriesIsAuto).toBe(true)
  })

  it('starting from an existing value (editing a saved entry) does not overwrite it on the next macro edit', () => {
    const initial = { draft: draft({ calories: '650', protein: '30', fat: '25', carbs: '80' }), caloriesIsAuto: false }
    const state = withAutoCalories(initial.draft, { ...initial.draft, protein: '35' }, initial.caloriesIsAuto)
    expect(state.draft.calories).toBe('650')
    expect(state.draft.protein).toBe('35')
  })

  it('a fresh edit unrelated to calories leaves an already-typed calories value alone', () => {
    const state = run(
      { draft: emptyDraft(), caloriesIsAuto: true },
      draft({ calories: '400' }),
      draft({ calories: '400', fiber: '5' }),
    )
    expect(state.draft.calories).toBe('400')
  })
})
