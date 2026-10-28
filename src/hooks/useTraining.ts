import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import type { TrainingDay } from '../types.ts'

export interface TrainingState {
  /** The day on screen: while another loads, still the last one (see `stale`), so paging days doesn't blank the view. */
  day: TrainingDay | null
  /** `day` is an earlier date's, kept on screen until the asked-for one arrives. */
  stale: boolean
  error: string | null
  /** Bumped by Shuffle, to be offered other WODs. */
  shuffle: number
  setShuffle: (n: number) => void
  /** Put in what a write answered with, so the page doesn't fetch again. */
  setDay: (day: TrainingDay) => void
  refresh: () => Promise<void>
}

/** The Train tab's day: fetched only while the tab is the one on screen. */
export default function useTraining(date: string, active: boolean): TrainingState {
  const [day, setDay] = useState<TrainingDay | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shuffle, setShuffle] = useState(0)
  const request = useRef(0)

  const load = useCallback(async () => {
    const mine = ++request.current
    try {
      const next = await api.training(date, shuffle)
      if (mine === request.current) {
        setDay(next)
        setError(null)
      }
    } catch (err) {
      if (mine === request.current) setError((err as Error).message)
    }
  }, [date, shuffle])

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (active) void load() }, [active, load])

  const put = useCallback((next: TrainingDay) => {
    request.current++
    setDay(next)
  }, [])

  return { day, stale: !!day && day.date !== date, error, shuffle, setShuffle, setDay: put, refresh: load }
}
