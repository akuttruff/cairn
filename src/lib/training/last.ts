import type { LastTime, ResolvedItem } from '../../types.ts'

/** "5×65 · 5×65 · 5×70", "20 s · 20 s", "35 min", or "done": what the last time had, set by set. */
export function lastSets(item: Pick<ResolvedItem, 'type'>, last: LastTime): string {
  if (item.type === 'minutes') {
    const s = last.sets[0]?.seconds
    return s != null ? `${Math.round(s / 60)} min` : 'done'
  }
  const sets = last.sets.map((x) => {
    if (x.seconds !== null) return `${x.seconds} s${x.weight !== null ? ` @ ${x.weight}` : ''}`
    if (x.reps !== null) return x.weight !== null ? `${x.reps}×${x.weight}` : `${x.reps}`
    return x.weight !== null ? `${x.weight} lb` : 'done'
  })
  return sets.every((x) => x === 'done') ? 'done' : sets.join(' · ')
}
