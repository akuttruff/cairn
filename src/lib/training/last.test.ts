import { describe, it, expect } from 'vitest'
import { lastSets } from './last.ts'

const at = (sets: { reps: number | null; weight: number | null; seconds: number | null }[]) => ({ date: '2026-11-02', sets })

describe('lastSets', () => {
  it('lists each set: reps × weight, reps alone, or seconds', () => {
    expect(lastSets({ type: 'sets' }, at([{ reps: 5, weight: 65, seconds: null }, { reps: 5, weight: 70, seconds: null }]))).toBe('5×65 · 5×70')
    expect(lastSets({ type: 'sets' }, at([{ reps: 12, weight: null, seconds: null }]))).toBe('12')
    expect(lastSets({ type: 'sets' }, at([{ reps: null, weight: null, seconds: 20 }, { reps: null, weight: 10, seconds: 30 }]))).toBe('20 s · 30 s @ 10')
  })

  it('gives a timed item its minutes, and says done when nothing was measured', () => {
    expect(lastSets({ type: 'minutes' }, at([{ reps: null, weight: null, seconds: 2100 }]))).toBe('35 min')
    expect(lastSets({ type: 'minutes' }, at([{ reps: null, weight: null, seconds: null }]))).toBe('done')
    expect(lastSets({ type: 'wod' }, at([{ reps: null, weight: null, seconds: null }]))).toBe('done')
  })
})
