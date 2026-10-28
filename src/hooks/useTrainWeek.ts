import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import { addDays } from '../lib/nutrition.ts'
import { weekdayOf } from '../lib/training/resolve.ts'
import type { RangeView } from '../types.ts'

/** The Monday of a date's training week: Train counts weeks Monday to Sunday, as schemas do. */
export const mondayOf = (date: string): string => addDays(date, 1 - weekdayOf(date))

/** Workouts, meditation and dog walks over the Monday-to-Sunday week around `date`, fetched while Train's Week is on screen. */
export default function useTrainWeek(date: string, active: boolean): { view: RangeView | null; error: string | null; refresh: () => Promise<void> } {
  const [view, setView] = useState<RangeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const start = mondayOf(date)

  const load = useCallback(async () => {
    const mine = ++request.current
    try {
      const next = await api.range(start, addDays(start, 6))
      if (mine === request.current) { setView(next); setError(null) }
    } catch (err) {
      if (mine === request.current) setError((err as Error).message)
    }
  }, [start])

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (active) void load() }, [active, load])

  return { view, error, refresh: load }
}
