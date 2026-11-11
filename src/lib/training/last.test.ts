import { describe, it, expect } from 'vitest'
import { lastSets } from './last.ts'

const at = (sets: { reps: number | null; weight: number | null; seconds: number | null }[]) => ({ date: '2026-11-02', sets })

describe('lastSets', () => {
  it('folds runs of the same set: "4 sets of 5×35"', () => {
    const set = (reps: number | null, weight: number | null, seconds: number | null = null) => ({ reps, weight, seconds })
    expect(lastSets({ type: 'sets' }, at([set(5, 35), set(5, 35), set(5, 35), set(5, 35)]))).toBe('4 sets of 5×35')
    expect(lastSets({ type: 'sets' }, at([set(5, 65), set(5, 65), set(5, 70)]))).toBe('2 sets of 5×65 · 5×70')
    expect(lastSets({ type: 'sets' }, at([set(5, 70), set(4, 75)]))).toBe('5×70 · 4×75')
    expect(lastSets({ type: 'sets' }, at([set(8, null), set(8, null), set(8, null)]))).toBe('3 sets of 8 reps')
    expect(lastSets({ type: 'sets' }, at([set(12, null)]))).toBe('12 reps')
    expect(lastSets({ type: 'sets' }, at([set(null, null, 30), set(null, null, 30), set(null, 10, 30)]))).toBe('2 sets of 30 s · 30 s @ 10')
  })

  it('gives a timed item its minutes, and says done when nothing was measured', () => {
    expect(lastSets({ type: 'minutes' }, at([{ reps: null, weight: null, seconds: 2100 }]))).toBe('35 min')
    expect(lastSets({ type: 'minutes' }, at([{ reps: null, weight: null, seconds: null }]))).toBe('done')
    expect(lastSets({ type: 'wod' }, at([{ reps: null, weight: null, seconds: null }]))).toBe('done')
  })
})
