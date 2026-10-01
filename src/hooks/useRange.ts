import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.ts'
import { addDays, addMonths, endOfMonth, localDate, startOfMonth, startOfWeek } from '../lib/nutrition.ts'
import { monthLabel, weekLabel } from '../lib/format.ts'
import type { RangeView } from '../types.ts'

export type RangeMode = 'week' | 'month'

interface Bounds {
  start: string
  end: string
  label: string
}

/** The week or month containing `anchor`, and how to name it. */
function boundsFor(mode: RangeMode, anchor: string): Bounds {
  if (mode === 'week') {
    const start = startOfWeek(anchor)
    const end = addDays(start, 6)
    return { start, end, label: weekLabel(start, end) }
  }
  const start = startOfMonth(anchor)
  const end = endOfMonth(anchor)
  return { start, end, label: monthLabel(anchor) }
}

/** Step the anchor one whole period, in either direction. */
function step(mode: RangeMode, anchor: string, dir: 1 | -1): string {
  return mode === 'week' ? addDays(anchor, dir * 7) : addMonths(anchor, dir)
}

export interface RangeState {
  start: string
  end: string
  label: string
  /** Whether the range shown contains today -- the "jump to current" button hides when it does. */
  isCurrent: boolean
  view: RangeView | null
  loading: boolean
  error: string | null
  prev: () => void
  next: () => void
  jumpToCurrent: () => void
  refresh: () => Promise<void>
}

/**
 * The week or month being viewed, and its summary -- useDay's sibling for
 * the aggregate views. A separate anchor from useDay's `date`, so switching
 * to Week and back leaves the day you were looking at untouched.
 *
 * `enabled` skips fetching while this mode isn't the one on screen: App
 * keeps both a week and a month instance mounted (so each keeps its own
 * navigated position across switches), and only one should ever be doing
 * network work at a time.
 */
export default function useRange(mode: RangeMode, enabled: boolean): RangeState {
  const [anchor, setAnchor] = useState(localDate)
  const [view, setView] = useState<RangeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const { start, end, label } = boundsFor(mode, anchor)

  const load = useCallback(async (s: string, e: string) => {
    const mine = ++request.current
    try {
      const next = await api.range(s, e)
      if (mine === request.current) { setView(next); setError(null) }
    } catch (err) {
      if (mine === request.current) setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    // oxlint-disable-next-line react/set-state-in-effect
    void load(start, end)
  }, [enabled, start, end, load])

  const prev = useCallback(() => setAnchor((a) => step(mode, a, -1)), [mode])
  const next = useCallback(() => setAnchor((a) => step(mode, a, 1)), [mode])
  const jumpToCurrent = useCallback(() => setAnchor(localDate()), [])
  const refresh = useCallback(() => load(start, end), [start, end, load])

  const today = localDate()
  const isCurrent = today >= start && today <= end
  const loading = (view?.start !== start || view?.end !== end) && !error
  return { start, end, label, isCurrent, view, loading, error, prev, next, jumpToCurrent, refresh }
}
