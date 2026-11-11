import type { LastTime, ResolvedItem } from '../../types.ts'

/** "2 sets of 5×65 · 5×70", "3 sets of 8 reps", "35 min", or "done": what the last time had. */
export function lastSets(item: Pick<ResolvedItem, 'type'>, last: LastTime): string {
  if (item.type === 'minutes') {
    const s = last.sets[0]?.seconds
    return s != null ? `${Math.round(s / 60)} min` : 'done'
  }
  const sets = last.sets.map((x) => {
    if (x.seconds !== null) return `${x.seconds} s${x.weight !== null ? ` @ ${x.weight}` : ''}`
    if (x.reps !== null) return x.weight !== null ? `${x.reps}×${x.weight}` : `${x.reps} reps`
    return x.weight !== null ? `${x.weight} lb` : 'done'
  })
  if (sets.every((x) => x === 'done')) return 'done'
  // Runs of the same set fold together: "4 sets of 5×35 · 5×40".
  const runs: { what: string; n: number }[] = []
  for (const what of sets) {
    const prev = runs[runs.length - 1]
    if (prev?.what === what) prev.n++
    else runs.push({ what, n: 1 })
  }
  return runs.map((r) => (r.n > 1 ? `${r.n} sets of ${r.what}` : r.what)).join(' · ')
}
