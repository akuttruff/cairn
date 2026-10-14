import { useEffect, useState } from 'react'

/**
 * A label, a restaurant guess, a recipe: type the numbers in for one
 * serving, however you'd describe it. The weight is optional.
 */
/** Whole seconds since `started` (a timestamp), ticking while there is one; 0 when null. */
export function useElapsed(started: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (started == null) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [started])
  return started == null ? 0 : Math.max(0, Math.round((now - started) / 1000))
}
