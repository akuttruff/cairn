import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import { localDate } from '../lib/nutrition.ts'
import type { DayView } from '../types.ts'

export interface DayState {
  date: string
  isToday: boolean
  view: DayView | null
  loading: boolean
  error: string | null
  setDate: (date: string) => void
  refresh: () => Promise<void>
}

/**
 * The day being viewed, and its log.
 *
 * "Today" is the phone's calendar date, not the server's: the log is filed by
 * when you ate, as you experienced it. And an app left open overnight should
 * roll forward to the new day on return, rather than quietly logging
 * breakfast into yesterday.
 */
export default function useDay(): DayState {
  const [date, setDateState] = useState(localDate)
  const [view, setView] = useState<DayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const followingToday = useRef(true)
  const request = useRef(0)

  const load = useCallback(async (d: string) => {
    const mine = ++request.current
    try {
      const next = await api.day(d)
      // Ignore a slow response for a day we have already moved away from.
      if (mine === request.current) {
        setView(next)
        setError(null)
      }
    } catch (err) {
      if (mine === request.current) setError((err as Error).message)
    }
  }, [])

  // Fetching is what effects are for; load only sets state once the response
  // is in, never synchronously.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(date) }, [date, load])

  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      const today = localDate()
      if (followingToday.current && today !== date) setDateState(today)
      else void load(date)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [date, load])

  const setDate = useCallback((d: string) => {
    followingToday.current = d === localDate()
    setDateState(d)
  }, [])

  const refresh = useCallback(() => load(date), [date, load])

  // Loading until the view on screen is the day asked for.
  const loading = view?.date !== date && !error
  return { date, isToday: date === localDate(), view, loading, error, setDate, refresh }
}
