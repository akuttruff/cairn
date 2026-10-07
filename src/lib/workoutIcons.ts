import {
  Activity, Bike, Dumbbell, Flame, Footprints, HeartPulse, Medal, Mountain, Music, PersonStanding, Sailboat, Snowflake,
  Sparkles, Sun, Swords, Target, Tent, Timer, Trophy, Volleyball, Waves, Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { WorkoutIcon, WorkoutKindDef } from '../types.ts'

/** The drawing for each icon name an activity can carry (see WORKOUT_ICONS). */
export const WORKOUT_ICON: Record<WorkoutIcon, LucideIcon> = {
  flame: Flame, dumbbell: Dumbbell, footprints: Footprints, bike: Bike, sparkles: Sparkles, 'person-standing': PersonStanding,
  waves: Waves, mountain: Mountain, 'heart-pulse': HeartPulse, activity: Activity, zap: Zap, target: Target, timer: Timer,
  trophy: Trophy, medal: Medal, swords: Swords, music: Music, snowflake: Snowflake, sun: Sun, sailboat: Sailboat,
  tent: Tent, volleyball: Volleyball,
}

/** How an activity shows: its label and icon, with a plain fallback for a kind no longer in Settings (an old log). */
export function kindView(kinds: WorkoutKindDef[], id: string): { label: string; Icon: LucideIcon } {
  const def = kinds.find((k) => k.id === id)
  return { label: def?.label ?? id, Icon: def ? WORKOUT_ICON[def.icon] : Activity }
}

/** An id for a new activity, from its label: "Rock climbing" -> "rock-climbing"; kept apart from the ids in use. */
export function kindIdFor(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'activity'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base.slice(0, 21)}-${n}`
  return id
}
