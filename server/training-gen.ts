import { chatText, chooseModel, extractJson } from './research.ts'
import type { Progression, Settings, SchemaSummary, TrainingItem, TrainingSchema } from '../src/types.ts'
import { addDays } from '../src/lib/nutrition.ts'
import { cleanSchema } from '../src/lib/training/schema.ts'
import { MOVEMENTS } from '../src/lib/training/movements.ts'
import { describe, itemOn, planSets, prescriptionFor, weekdayOf } from '../src/lib/training/resolve.ts'
import type { TrainingStore } from './store/training.ts'

/**
 * Writing the next training schema with the local model. Everything that
 * can be worked out is worked out here first -- how the last schema actually
 * went, set by set, and when the new one starts -- so the model's job is
 * the coaching: what to progress, what to change, and why. Its schema is
 * checked like any import; if it has problems the model gets the list once
 * to fix them, and a schema that's still wrong is never saved.
 */

/** A long schema on a big local model can take several minutes. */
export const TRAINING_TIMEOUT_MS = 20 * 60_000
export const TRAINING_MAX_TOKENS = 16_000
/** Each one is another few minutes; most slips are fixed by the first. */
const MAX_RETRIES = 2

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The schema format, for the model; docs/training-schema.md says the same for people. */
export const SCHEMA_SPEC = `A training schema is one JSON object:
{
  "schemaVersion": 1,
  "name": string,
  "firstWeek": 1,
  "weeks": number (last week, at most 16),
  "deloadWeeks": number[],
  "testWeek": number (optional; a week where lifts are tested),
  "goals": string (the targets for this schema, and in a sentence or three why you changed what you changed),
  "lifts": [{ "id": string, "name": string, "increment": 2.5 | 5 }]   (the lifts percentages are of; keep the existing ids),
  "days": [{ "weekday": 1-7 (1 = Monday), "sessions": [Session] }],
  "wods": [Wod] (optional: new WODs; only if the bank lacks what a slot needs)
}
Session = { "id": string, "title": string, "kind": activity id, "items": [Item] }
Item = { "id": string, "name": string, "lift"?: lift id, "onlyWeeks"?: [from, to], and EXACTLY ONE of:
  "progression": { "phases": [{ "weeks": [from, to], "sets": n, "reps": n, "startPct": 0.3-1.05, "stepPct": -0.1..0.1 }],
                   "deload"?: { "sets": n, "reps": n, "pct": 0.3-0.9 }, "test"?: "ladder" | "single" }
      -- a barbell lift in percentages of its PR. Deload weeks inside a phase don't count as steps. "ladder" works up
         to a PR attempt in the test week; "single" stops at a sure single (use it for snatch and clean without bumper plates).
  "weeks": { "<week>": { "sets": [{ "reps"?: n | "max", "seconds"?: n, "pct"?: fraction, "weight"?: lb }], "note"?: string } }
      -- spelled out per week, for accessories and skill work (reps or seconds, optional fixed weight).
  "minutes": { "<week>": minutes }   -- timed work such as zone 2 on the bike.
  "wod": { "maxMinutes": n, "minMinutes"?: n, "focus"?: ["upper"|"legs"|"full"|"bike"|"core"], "lowImpact"?: true }
      -- a WOD picked from the bank on the day; focus lists what it may work (core is always allowed).
  "check": true   -- a simple tick, e.g. yoga or Pilates.
}
Wod = { "id", "name", "format": "rft"|"amrap"|"emom"|"chipper"|"ladder"|"intervals", "minutes": n, "rounds"?: n (rft),
        "scheme"?: [21,15,9] (ladder), "text"?: string (intervals), "parts": [{ "move": movement id, "amount"?: n, "weight"?: lb }] }
Ids are lowercase letters, digits, - and _. Reuse an item's id when it carries on from the last schema: its how-to notes carry over.`

/** The previous schema in a few lines per item: what it asked for each week, at today's PRs. */
function outline(schema: TrainingSchema, prs: Map<string, number | null>): string {
  const lines: string[] = []
  for (const day of schema.days) {
    for (const session of day.sessions) {
      lines.push(`${DAYS[day.weekday]} -- ${session.title} [session ${session.id}, kind ${session.kind}]`)
      for (const item of session.items) {
        const head = `  - ${item.name} [item ${item.id}${item.lift ? `, lift ${item.lift}` : ''}]`
        if (item.weeks || item.progression) {
          const increment = schema.lifts.find((l) => l.id === item.lift)?.increment ?? 5
          const weeks: string[] = []
          for (let w = schema.firstWeek; w <= schema.weeks; w++) {
            const p = prescriptionFor(item, w, schema)
            if (p) weeks.push(`w${w} ${describe(p.sets.flatMap((t) => planSets(t, item.lift ? prs.get(item.lift) ?? null : null, increment)))}`)
          }
          lines.push(`${head}: ${weeks.join('; ')}`)
        } else if (item.minutes) {
          lines.push(`${head}: minutes ${Object.entries(item.minutes).map(([w, m]) => `w${w} ${m}`).join(', ')}`)
        } else if (item.wod) {
          lines.push(`${head}: WOD slot ${JSON.stringify(item.wod)}`)
        } else {
          lines.push(`${head}: check${item.onlyWeeks ? ` (weeks ${item.onlyWeeks.join('-')})` : ''}`)
        }
      }
    }
  }
  return lines.join('\n')
}

/** The Monday after the schema's last day. */
export function nextStart(endDate: string): string {
  let d = addDays(endDate, 1)
  while (weekdayOf(d) !== 1) d = addDays(d, 1)
  return d
}

/**
 * A model will sometimes write percentages as percent (70, 2.5) where the
 * schema wants fractions (0.7, 0.025). Only unambiguous cases are fixed: a
 * start over 1.5 can't be a fraction of a PR, nor a weekly step over 0.5.
 */
function asFractions(p: Partial<Progression>): void {
  const fix = (v: unknown, over: number): unknown => (typeof v === 'number' && Math.abs(v) > over && Math.abs(v) <= 100 ? Math.round(v * 10) / 1000 : v)
  for (const ph of Array.isArray(p.phases) ? p.phases : []) {
    if (!ph || typeof ph !== 'object') continue
    // A flat phase written like a deload: { pct } for { startPct, stepPct: 0 }.
    const flat = ph as typeof ph & { pct?: unknown }
    if (flat.startPct === undefined && typeof flat.pct === 'number') { ph.startPct = flat.pct; delete flat.pct }
    if (ph.stepPct === undefined && typeof ph.startPct === 'number') ph.stepPct = 0
    ph.startPct = fix(ph.startPct, 1.5) as number
    ph.stepPct = fix(ph.stepPct, 0.5) as number
  }
  if (p.deload && typeof p.deload === 'object') p.deload.pct = fix(p.deload.pct, 1.5) as number
}

/** Fields the model doesn't decide, and notes carried over to items that kept their id. */
function finish(raw: unknown, previous: TrainingSchema, basedOn: string, startDate: string, kinds: string[]): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const notes = new Map<string, string>()
  for (const d of previous.days) for (const s of d.sessions) for (const i of s.items) if (i.notes) notes.set(i.id, i.notes)
  const obj = raw as Record<string, unknown>
  // The lifts are the PRs' ids, which carry over: a lift the model renamed ("back-squat") is mapped back to its id ("squat").
  const norm = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9]/g, '') : '')
  const liftFor = new Map<string, string>()
  for (const l of Array.isArray(obj.lifts) ? obj.lifts as { id?: unknown; name?: unknown }[] : []) {
    if (typeof l?.id !== 'string') continue
    const same = previous.lifts.find((p) => p.id === l.id)
      ?? previous.lifts.find((p) => norm(p.name) === norm(l.name) || norm(p.name) === norm(l.id))
      ?? previous.lifts.find((p) => norm(l.id).includes(norm(p.id)))
    if (same) liftFor.set(l.id, same.id)
  }
  const extra = (Array.isArray(obj.lifts) ? obj.lifts as { id?: unknown }[] : []).filter((l) => typeof l?.id === 'string' && !liftFor.has(l.id))
  obj.lifts = [...previous.lifts, ...extra]
  // Rest is the absence of a session: a "rest" session with a made-up activity is dropped, and a day left empty with it.
  if (Array.isArray(obj.days)) {
    for (const d of obj.days) {
      if (d && Array.isArray(d.sessions)) d.sessions = d.sessions.filter((s: { kind?: unknown }) => !(typeof s?.kind === 'string' && /^(rest|recovery|off|none)$/i.test(s.kind) && !kinds.includes(s.kind)))
    }
    obj.days = obj.days.filter((d: { sessions?: unknown[] }) => !Array.isArray(d?.sessions) || d.sessions.length > 0)
  }
  for (const d of Array.isArray(obj.days) ? obj.days : []) {
    for (const s of Array.isArray(d?.sessions) ? d.sessions : []) {
      for (const i of Array.isArray(s?.items) ? s.items as Partial<TrainingItem>[] : []) {
        if (i && typeof i.id === 'string' && !i.notes && notes.has(i.id)) i.notes = notes.get(i.id)
        if (i?.progression) asFractions(i.progression)
        // An item with nothing to log but a tick, written without saying so, is a tick.
        if (i && typeof i === 'object' && !['weeks', 'progression', 'wod', 'check', 'minutes'].some((k) => k in i)) i.check = true
        if (i && 'check' in i && i.check !== true && ['weeks', 'progression', 'wod', 'minutes'].every((k) => !(k in i))) i.check = true
        if (i && typeof i.lift === 'string' && liftFor.has(i.lift)) i.lift = liftFor.get(i.lift)
      }
    }
  }
  return { ...obj, schemaVersion: 1, startDate, firstWeek: 1, basedOn }
}

export interface GenerateArgs {
  training: TrainingStore
  settings: Settings
  fetchImpl: typeof fetch
  note?: string
  signal?: AbortSignal
}

export async function generateSchema({ training, settings, fetchImpl, note, signal: abort }: GenerateArgs): Promise<{ draft: SchemaSummary; model: string }> {
  const active = training.activeSchema()
  if (!active) throw new Error('There\'s no active training schema to build on. Import one first.')
  const signal = AbortSignal.any([AbortSignal.timeout(TRAINING_TIMEOUT_MS), ...(abort ? [abort] : [])])
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal, settings.trainingModel)
  const startDate = nextStart(active.summary.endDate)
  const lifts = training.lifts()
  const prs = new Map(lifts.map((l) => [l.id, l.pr]))
  const kinds = settings.workoutKinds.map((k) => `${k.id} (${k.label})`).join(', ')
  const gear = settings.equipment
  const ctx = { kinds: settings.workoutKinds.map((k) => k.id), equipment: gear }

  const system = [
    'You are a strength and conditioning coach writing the next training block for one person who trains at home.',
    'Reply with ONLY the JSON object of the new schema -- no prose before or after, no comments in the JSON.',
    '',
    SCHEMA_SPEC,
    '',
    'Coaching rules:',
    '- Build on the last schema and on how it actually went: progress lifts that were completed as planned, hold or repeat-style',
    '  progressions for lifts that were missed, lifted lighter, or had weeks repeated. Percentages are of the CURRENT PRs.',
    '- A rest day is a weekday left out of "days"; never write a "rest" session. Every item has exactly one of progression, weeks, minutes, wod or check.',
    '- Keep the weekly layout unless the report shows a session was regularly skipped; keep a deload every 3-4 weeks and a test week at the end.',
    '- Respect the equipment: no movement or load the gear can\'t provide. Only use these activity kinds: ' + kinds + '.',
    '- Keep the person\'s stated goals and the person\'s note, if any, in mind; write the targets and your reasoning in "goals".',
  ].join('\n')

  const input = [
    `The last schema, "${active.schema.name}", as it was planned (weights at today's PRs):`,
    outline(active.schema, prs),
    '',
    active.schema.goals ? `Its goals and notes:\n${active.schema.goals}\n` : '',
    'How it went:',
    training.report(active.id),
    '',
    `Equipment on hand: ${gear.gear.join(', ') || 'none listed'}; dumbbells (lb each): ${gear.dumbbells.join(', ') || 'none'}; kettlebells: ${gear.kettlebells.join(', ') || 'none'}.`,
    `Lift ids (fixed; they're where the PRs are kept): ${active.schema.lifts.map((l) => `${l.id} (${l.name}, PR ${prs.get(l.id) ?? '?'} lb)`).join(', ')}.`,
    `Movement ids for new WODs: ${MOVEMENTS.map((m) => m.id).join(', ')}.`,
    `The new schema starts ${startDate} (a Monday) as week 1.`,
    note ? `The person asks: ${note}` : '',
    '',
    'Write the new schema now.',
  ].filter((l) => l !== '').join('\n')

  const ask = async (text: string): Promise<string> => {
    const body: Record<string, unknown> = { model, system_prompt: system, input: text, max_output_tokens: TRAINING_MAX_TOKENS }
    if (reasoning) body.reasoning = reasoning
    return chatText(settings, body, fetchImpl, signal)
  }

  let reply = await ask(input)
  let checked = cleanSchema(finish(extractJson(reply), active.schema, active.id, startDate, ctx.kinds), ctx)
  for (let retry = 0; retry < MAX_RETRIES && !checked.schema; retry++) {
    reply = await ask([
      input, '', 'Your previous reply was:', reply.slice(0, 40_000), '',
      'It has these problems:', ...checked.errors.map((e) => `- ${e}`), '',
      'Reply with the whole corrected schema JSON.',
    ].join('\n'))
    checked = cleanSchema(finish(extractJson(reply), active.schema, active.id, startDate, ctx.kinds), ctx)
  }
  if (!checked.schema) {
    throw new Error(`The model's schema still had problems after ${MAX_RETRIES + 1} tries: ${checked.errors.slice(0, 4).join('; ')}`)
  }
  // Every item it names on a training day should be on in at least one week; one that never is was a mistake.
  const neverOn = checked.schema.days.flatMap((d) => d.sessions.flatMap((s) => s.items))
    .filter((i) => !Array.from({ length: checked.schema!.weeks }, (_, k) => k + 1).some((w) => itemOn(i, w, checked.schema!)))
  if (neverOn.length) throw new Error(`The model's schema has items that are never on: ${neverOn.map((i) => i.name).join(', ')}`)
  return { draft: training.save(checked.schema, 'draft'), model }
}
