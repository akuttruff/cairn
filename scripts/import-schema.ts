import fs from 'node:fs'
import path from 'node:path'
import { Store } from '../server/store.ts'
import type { WorkoutKindDef, WorkoutPlan } from '../src/types.ts'

/**
 * Loads a training schema into Cairn: `npm run import:schema -- plan.json [--dir .data-dev] [--draft]`.
 * Without --dir it writes to .data, the live app's data. The file is either a bare schema
 * (docs/training-schema.md) or an import wrapper around one:
 *
 *   { "schema": {...}, "prs": { "squat": 145 }, "equipment": {...},
 *     "kinds": [{ "id": "gymnastics", "label": "Gymnastics", "icon": "activity", "training": false }],
 *     "weeklyPlan": { "weightlifting": 3, ... } }
 *
 * Activities the schema needs and Settings lacks are added from "kinds"; equipment is set only if
 * Settings has none yet; PRs are recorded as of today.
 */

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--dir')
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : undefined
if (!file) {
  console.error('usage: npm run import:schema -- <file.json> [--dir .data-dev] [--draft]')
  process.exit(2)
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
const wrapped = raw.schema !== undefined
const schema = wrapped ? raw.schema : raw
const store = new Store({ dir: dirArg ? path.resolve(dirArg) : undefined })

if (wrapped && Array.isArray(raw.kinds)) {
  const have = store.getSettings().workoutKinds
  const missing = (raw.kinds as WorkoutKindDef[]).filter((k) => !have.some((h) => h.id === k.id))
  if (missing.length) {
    store.setSettings({ workoutKinds: [...have, ...missing] })
    console.log(`added activities: ${missing.map((k) => k.label).join(', ')}`)
  }
}
if (wrapped && raw.equipment && !store.getSettings().equipment.gear.length) {
  store.setSettings({ equipment: raw.equipment as never })
  console.log('set the equipment')
}

try {
  const saved = store.training.save(schema, args.includes('--draft') ? 'draft' : 'active')
  console.log(`imported "${saved.name}" (${saved.status}): ${saved.startDate} to ${saved.endDate}`)
} catch (err) {
  console.error((err as Error).message)
  process.exit(1)
}

if (wrapped && raw.prs && typeof raw.prs === 'object') {
  for (const [lift, pr] of Object.entries(raw.prs as Record<string, number>)) {
    store.training.setPr(lift, { pr })
    console.log(`PR ${lift}: ${pr} lb`)
  }
}
if (wrapped && raw.weeklyPlan) {
  // Only activities Settings has; one that was removed there (a run, say) is skipped.
  const have = new Set(store.getSettings().workoutKinds.map((k) => k.id))
  const wanted = Object.fromEntries(Object.entries(raw.weeklyPlan as WorkoutPlan).filter(([k]) => have.has(k)))
  store.setGoals({ workoutPlan: { ...store.getGoals().workoutPlan, ...wanted } })
  console.log('set the weekly workout plan')
}
