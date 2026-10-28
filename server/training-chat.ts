import { chatText, chooseModel, extractJson } from './research.ts'
import { describeGear, shortDate } from './store/training.ts'
import type { ActivePlan, TrainingStore } from './store/training.ts'
import { OVERRIDE_OPS, REVISION_OPS } from '../src/types.ts'
import type { CoachMessage, CoachStats, CoachStatus, PlanEdit, PlanProposal, Settings, TrainingSchema } from '../src/types.ts'
import type { ChatProgress } from './research.ts'
import { addDays, daysBetween, isDateString } from '../src/lib/nutrition.ts'
import { cleanEquipment, cleanItemIn, cleanSchema } from '../src/lib/training/schema.ts'
import { isRevision, reviseSchema } from '../src/lib/training/edits.ts'
import type { OverrideEdit, RevisionEdit } from '../src/lib/training/edits.ts'
import { weekOf, weekSequence } from '../src/lib/training/resolve.ts'
import { MOVEMENTS } from '../src/lib/training/movements.ts'
import { outline } from './training-gen.ts'

/**
 * The training coach: a conversation about the plan with the local model.
 * It answers questions and gives feedback, and when asked for a change it
 * proposes typed edits -- one-off changes for some days, lasting changes
 * from a week on, or a rewrite of the rest of the plan. The code checks
 * every edit and works out what it would do by trying it and rolling it
 * back; nothing changes until the person applies it.
 */

export const COACH_TIMEOUT_MS = 5 * 60_000
/** Room for a model that thinks before it answers (the big Qwen can't be told not to). */
export const COACH_MAX_TOKENS = 12_000
/** How far ahead the coach sees the plan day by day. */
const AHEAD_DAYS = 14
/** The longest a one-off change can run. */
const MAX_RANGE_DAYS = 42
const HISTORY = 12

export const EDIT_SPEC = `Edits (only when the person wants the plan changed; otherwise "edits": []):
One-off changes for some days (the plan itself stays as it is):
  { "op": "move", "sessionId": id, "from": date, "to": date }          do a session on another day
  { "op": "skip", "date": date, "sessionId"?: id }                      skip one session, or the whole day
  { "op": "load", "from": date, "to": date, "factor": 0.5-1.2, "lifts"?: [lift ids] }   lighter or heavier weights
  { "op": "swap", "from": date, "to": date, "itemId": id, "item": Item }   a stand-in for an item over some days
  { "op": "equipment", "from": date, "to": date, "equipment": { "gear": [...], "dumbbells": [lb], "kettlebells": [lb] } }   traveling
Lasting changes to the plan from a week on (fromWeek defaults to the current week; weeks already trained never change):
  { "op": "replaceItem", "itemId": id, "item": Item, "fromWeek"?: n }
  { "op": "addItem", "sessionId": id, "item": Item, "fromWeek"?: n }
  { "op": "removeItem", "itemId": id, "fromWeek"?: n }
  { "op": "addSession", "weekday": 1-7 (7 = Sunday), "session": { "id", "title", "kind", "items": [Item] }, "fromWeek"?: n }
  { "op": "removeSession", "sessionId": id, "fromWeek"?: n }
  { "op": "moveSession", "sessionId": id, "toWeekday": 1-7, "fromWeek"?: n }
  { "op": "setOptional", "sessionId"?: id, "itemId"?: id, "optional": true | false }   nice to do, not needed for the day to count as done
A rewrite of the rest of the plan, when the person asks for one or for something bigger than a few edits:
  { "op": "rewrite", "instruction": "what to change, in a sentence or two", "fromWeek": n }   (alone, no other edits)
Item = { "id": new unique id, "name", "lift"?: lift id, "notes"?, and exactly one of:
  "sets": { "sets": [{ "reps"?: n | "max", "seconds"?: n, "pct"?: fraction of the PR, "weight"?: lb }] }   the same every week
  "progression": {...} as in the schema, "minutes": { "<week>": n }, "wod": { "maxMinutes": n, "focus"?: [...] }, "check": true }
Dates are YYYY-MM-DD and from today on. Use only the session ids, item ids and lift ids shown.`

/** The model's edits, tidied: `type` read as `op`, and anything that isn't an object dropped. */
function normalize(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e) => e && typeof e === 'object').map((e) => {
    const o = { ...(e as Record<string, unknown>) }
    if (typeof o.op !== 'string' && typeof o.type === 'string') o.op = o.type
    delete o.type
    return o as unknown as PlanEdit
  })
}

interface Checked { overrides: OverrideEdit[]; revisions: RevisionEdit[]; rewrite: Extract<PlanEdit, { op: 'rewrite' }> | null; revised: TrainingSchema | null; errors: string[] }

/** Every edit checked against the plan as it stands; readable errors for the model when anything's off. */
export function checkEdits(training: TrainingStore, plan: ActivePlan, edits: PlanEdit[], today: string, settings: Settings): Checked {
  const errors: string[] = []
  const out: Checked = { overrides: [], revisions: [], rewrite: null, revised: null, errors }
  const ctx = { kinds: settings.workoutKinds.map((k) => k.id), equipment: settings.equipment }
  const end = plan.summary.endDate
  const inPlan = (d: unknown): d is string => typeof d === 'string' && isDateString(d) && d >= today && d >= plan.schema.startDate && d <= end
  const where = (i: number, e: PlanEdit): string => `edit ${i + 1} (${e.op})`
  const itemIds = new Set(plan.schema.days.flatMap((d) => d.sessions.flatMap((s) => s.items.map((i) => i.id))))
  const current = weekOf(plan.schema, today, plan.repeats)?.week ?? plan.schema.firstWeek

  edits.forEach((e, i) => {
    const w = where(i, e)
    if (!e || typeof e.op !== 'string' || ![...OVERRIDE_OPS, ...REVISION_OPS, 'rewrite'].includes(e.op)) {
      errors.push(`edit ${i + 1}: op must be one of ${[...OVERRIDE_OPS, ...REVISION_OPS, 'rewrite'].join(', ')}`)
      return
    }
    if (e.op === 'rewrite') {
      if (edits.length > 1) errors.push(`${w}: a rewrite goes alone, with no other edits`)
      if (typeof e.instruction !== 'string' || !e.instruction.trim()) errors.push(`${w}: instruction says what to change`)
      if (!Number.isInteger(e.fromWeek) || e.fromWeek < current || e.fromWeek > plan.schema.weeks) errors.push(`${w}: fromWeek must be from ${current} (this week) to ${plan.schema.weeks}`)
      else out.rewrite = { op: 'rewrite', instruction: e.instruction.trim().slice(0, 500), fromWeek: e.fromWeek }
      return
    }
    if (isRevision(e)) { out.revisions.push(e); return }
    const range = (from: unknown, to: unknown): boolean => {
      if (!inPlan(from) || !inPlan(to)) { errors.push(`${w}: dates must be within the plan, from today (${today}) to ${end}`); return false }
      if (to < from) { errors.push(`${w}: "to" is before "from"`); return false }
      if (daysBetween(from, to) > MAX_RANGE_DAYS) { errors.push(`${w}: at most ${MAX_RANGE_DAYS} days; for longer, change the plan itself`); return false }
      return true
    }
    switch (e.op) {
      case 'move': {
        if (!inPlan(e.from) || !inPlan(e.to) || e.from === e.to) { errors.push(`${w}: from and to must be two different days within the plan, from today on`); return }
        if (!training.planOf(plan, e.from).some((s) => s.id === e.sessionId)) { errors.push(`${w}: there's no session "${e.sessionId}" on ${e.from}`); return }
        out.overrides.push({ op: 'move', sessionId: e.sessionId, from: e.from, to: e.to })
        return
      }
      case 'skip': {
        if (!inPlan(e.date)) { errors.push(`${w}: date must be within the plan, from today on`); return }
        if (e.sessionId && !training.planOf(plan, e.date).some((s) => s.id === e.sessionId)) { errors.push(`${w}: there's no session "${e.sessionId}" on ${e.date}`); return }
        out.overrides.push({ op: 'skip', date: e.date, ...(e.sessionId ? { sessionId: e.sessionId } : {}) })
        return
      }
      case 'load': {
        if (!range(e.from, e.to)) return
        if (typeof e.factor !== 'number' || e.factor < 0.5 || e.factor > 1.2) { errors.push(`${w}: factor must be 0.5 to 1.2 (0.9 is 10% lighter)`); return }
        const unknown = (e.lifts ?? []).filter((l) => !plan.schema.lifts.some((x) => x.id === l))
        if (unknown.length) { errors.push(`${w}: unknown lifts ${unknown.join(', ')}; the lifts are ${plan.schema.lifts.map((l) => l.id).join(', ')}`); return }
        out.overrides.push({ op: 'load', from: e.from, to: e.to, factor: Math.round(e.factor * 100) / 100, ...(e.lifts?.length ? { lifts: e.lifts } : {}) })
        return
      }
      case 'swap': {
        if (!range(e.from, e.to)) return
        if (!itemIds.has(e.itemId)) { errors.push(`${w}: there's no item "${e.itemId}"`); return }
        const raw = e.item && typeof e.item === 'object' ? { ...e.item } : e.item
        if (raw && typeof raw === 'object' && (!raw.id || itemIds.has(raw.id))) raw.id = `${e.itemId}-swap-${e.from}`.slice(0, 40)
        const { item, errors: bad } = cleanItemIn(raw, plan.schema, ctx)
        if (!item) { errors.push(...bad.map((b) => `${w}: ${b}`)); return }
        out.overrides.push({ op: 'swap', from: e.from, to: e.to, itemId: e.itemId, item })
        return
      }
      case 'equipment': {
        if (!range(e.from, e.to)) return
        out.overrides.push({ op: 'equipment', from: e.from, to: e.to, equipment: cleanEquipment(e.equipment) })
        return
      }
    }
  })
  if (out.revisions.length) {
    const { schema, errors: bad } = reviseSchema(plan.schema, out.revisions, current)
    errors.push(...bad)
    if (!bad.length) {
      const whole = cleanSchema(schema, ctx)
      if (whole.schema) out.revised = whole.schema
      else errors.push(...whole.errors.map((x) => `after the lasting changes: ${x}`))
    }
  }
  return out
}

type DayPlan = ReturnType<TrainingStore['planOf']>

/**
 * What the edits would do, in lines: the affected days resolved before and
 * after (the after inside a transaction that's rolled back), then compared
 * session by session and item by item.
 */
export function previewEdits(training: TrainingStore, plan: ActivePlan, checked: Checked, today: string): string[] {
  if (checked.rewrite) return [`Rewrite the plan from week ${checked.rewrite.fromWeek}: ${checked.rewrite.instruction}`]
  const dates = new Set<string>()
  const span = (from: string, to: string): void => { for (let d = from; d <= to && dates.size < 120; d = addDays(d, 1)) dates.add(d) }
  for (const e of checked.overrides) {
    if (e.op === 'move') { dates.add(e.from); dates.add(e.to) }
    else if (e.op === 'skip') dates.add(e.date)
    else span(e.from, e.to)
  }
  if (checked.revised) {
    // From the earliest week a lasting change starts (this week unless it says), four weeks on.
    const current = weekOf(plan.schema, today, plan.repeats)?.week ?? plan.schema.firstWeek
    const week = Math.min(...checked.revisions.map((r) => r.fromWeek ?? current))
    const index = weekSequence(plan.schema, plan.repeats).indexOf(Math.max(week, current))
    const begin = index >= 0 ? addDays(plan.schema.startDate, index * 7) : today
    const from = begin < today ? today : begin
    span(from, addDays(from, 27))
  }
  const sorted = [...dates].filter((d) => d <= plan.summary.endDate).sort()
  const before = new Map(sorted.map((d) => [d, training.planOf(plan, d)]))
  const after = training.trial(() => {
    if (checked.overrides.length) training.addOverrides(plan.id, checked.overrides, null)
    if (checked.revised) training.revise(plan.id, checked.revised, 'preview', null)
  }, () => {
    const next = training.activePlan()!
    return new Map(sorted.map((d) => [d, training.planOf(next, d)]))
  })

  const lines: string[] = []
  // Optional or not holds for every week, so it reads once, without dates.
  const nowOptional = new Set<string>()
  const nowRequired = new Set<string>()
  const gone = new Map<string, { date: string; title: string }>()
  const added = new Map<string, { date: string; session: DayPlan[number] }>()
  for (const d of sorted) {
    const was = before.get(d) ?? []
    const now = after.get(d) ?? []
    for (const s of was) if (!now.some((x) => x.id === s.id)) gone.set(`${s.id}|${d}`, { date: d, title: s.title })
    for (const s of now) if (!was.some((x) => x.id === s.id)) added.set(`${s.id}|${d}`, { date: d, session: s })
    for (const s of now) {
      const old = was.find((x) => x.id === s.id)
      if (!old) continue
      if (old.optional !== s.optional) (s.optional ? nowOptional : nowRequired).add(s.title)
      for (const i of s.items) {
        const o = old.items.find((x) => x.id === i.id)
        if (o && o.optional !== i.optional) (i.optional ? nowOptional : nowRequired).add(i.name)
      }
      const removed = old.items.filter((i) => !s.items.some((x) => x.id === i.id))
      const fresh = s.items.filter((i) => !old.items.some((x) => x.id === i.id))
      for (const i of s.items) {
        const o = old.items.find((x) => x.id === i.id)
        if (o && o.text !== i.text) lines.push(`${shortDate(d)} · ${i.name}: ${o.text} → ${i.text}`)
      }
      // A removed item and a new one in the same session read as one swapped for the other.
      removed.forEach((r, k) => {
        const n = fresh[k]
        lines.push(n ? `${shortDate(d)} · ${r.name} ${r.text} → ${n.name} ${n.text}` : `${shortDate(d)} · no ${r.name}`)
      })
      fresh.slice(removed.length).forEach((n) => lines.push(`${shortDate(d)} · + ${n.name} ${n.text}`))
    }
  }
  // A session gone from one day and arrived on another moved.
  for (const [key, g] of gone) {
    const id = key.split('|')[0]!
    const arrival = [...added.entries()].find(([k]) => k.split('|')[0] === id)
    if (arrival) {
      lines.push(`${shortDate(g.date)} → ${shortDate(arrival[1].date)}: ${g.title}`)
      added.delete(arrival[0])
    } else lines.push(`${shortDate(g.date)}: no ${g.title}`)
  }
  for (const { date, session } of added.values()) lines.push(`${shortDate(date)}: + ${session.title} (${session.items.map((i) => i.name).join(', ')})`)
  if (nowOptional.size) lines.push(`Optional from now on: ${[...nowOptional].join(', ')}`)
  if (nowRequired.size) lines.push(`Part of the day again: ${[...nowRequired].join(', ')}`)
  for (const e of checked.overrides) if (e.op === 'equipment') lines.push(`${shortDate(e.from)}–${shortDate(e.to)}: WODs for ${describeGear(e.equipment)}`)
  // The same change on several days reads once: "Sun, Dec 13, Dec 20: + Easy Sunday run".
  const grouped = new Map<string, string[]>()
  const plain: string[] = []
  for (const l of lines) {
    const m = /^(\w{3}, \w{3} \d{1,2})( · |: )(.*)$/.exec(l)
    if (!m) { plain.push(l); continue }
    const key = `${m[2]}${m[3]}`
    grouped.set(key, [...(grouped.get(key) ?? []), m[1]!])
  }
  const joinDates = (ds: string[]): string => (ds.length > 4 ? `From ${ds[0]} (${ds.length} days)` : ds.map((d, i) => (i === 0 ? d : d.replace(/^\w{3}, /, ''))).join(', '))
  const unique = [...new Set([...[...grouped].map(([key, ds]) => `${joinDates(ds)}${key}`), ...plain])]
  return unique.length > 14 ? [...unique.slice(0, 14), `…and ${unique.length - 14} more`] : unique
}

/** The plan as the coach sees it: today, the days ahead in detail, the whole schema in outline, how it's gone. */
export function coachContext(training: TrainingStore, plan: ActivePlan, today: string, settings: Settings): string {
  const at = weekOf(plan.schema, today, plan.repeats)
  const lifts = training.lifts()
  const ahead: string[] = []
  for (let i = 0; i < AHEAD_DAYS; i++) {
    const d = addDays(today, i)
    if (d > plan.summary.endDate) break
    const sessions = training.planOf(plan, d)
    const wk = weekOf(plan.schema, d, plan.repeats)?.week
    ahead.push(`${shortDate(d)} ${d}${wk !== undefined ? ` (week ${wk})` : ''}: ${sessions.length ? '' : 'rest'}`)
    for (const s of sessions) ahead.push(`  session ${s.id} "${s.title}" [${s.kind}]: ${s.items.map((i) => `${i.name} [item ${i.id}] ${i.text}`).join('; ')}`)
  }
  const changes = plan.overrides.map((o) => `  ${o.edit.op} ${JSON.stringify(o.edit)}`)
  return [
    `Today is ${shortDate(today)} ${today}${at ? `, week ${at.week} of ${plan.schema.weeks}${plan.schema.deloadWeeks.includes(at.week) ? ' (a deload week)' : ''}${plan.schema.testWeek === at.week ? ' (the test week)' : ''}` : ''}.`,
    `The plan: "${plan.schema.name}", ${plan.summary.startDate} to ${plan.summary.endDate}, weeks ${plan.schema.firstWeek}-${plan.schema.weeks}; deloads ${plan.schema.deloadWeeks.join(', ') || 'none'}; test week ${plan.schema.testWeek ?? 'none'}.`,
    plan.schema.goals ? `Its goals:\n${plan.schema.goals}` : '',
    `Lifts and PRs (lb): ${lifts.map((l) => `${l.id} ${l.pr ?? '?'}`).join(', ')}. Equipment: ${describeGear(settings.equipment)}.`,
    `Activities (session kinds): ${settings.workoutKinds.map((k) => k.id).join(', ')}.`,
    '',
    `The next ${AHEAD_DAYS} days, with the ids edits use:`,
    ...ahead,
    changes.length ? `One-off changes already in place:\n${changes.join('\n')}` : '',
    '',
    'The whole plan in outline (weights at today\'s PRs):',
    outline(plan.schema, new Map(lifts.map((l) => [l.id, l.pr]))),
    '',
    'How it has gone so far:',
    training.report(plan.id, today),
    '',
    `Movement ids for WOD-style items: ${MOVEMENTS.map((m) => m.id).join(', ')}.`,
  ].filter((l) => l !== '').join('\n')
}

const SYSTEM = [
  'You are a friendly, knowledgeable strength and conditioning coach talking with one person about their home training plan.',
  'Be conversational and concise: a few sentences, plain words, no headings. Answer questions, give honest feedback on the plan and their',
  'progress when asked (what is going well, what to watch, whether the plan fits their goals), and suggest changes when they would help.',
  'Only propose edits when the person asks for a change or agrees to one; a question gets an answer and "edits": [].',
  'Be careful with pain: for sharp or lasting pain, suggest easing off that movement and seeing a professional.',
  'Edits are proposals: the person sees exactly what they would do and applies them, so say what you would change',
  '("I can move…", "Here is a lighter week…"), never that it is done. Describe only the edits you include.',
  'When the gear is limited (traveling), add an "equipment" edit AND swap or skip what that gear cannot do on those days: barbell lifts become',
  'dumbbell versions ("swap" with a "sets" item at a sensible fixed weight), or skip the session if nothing fits.',
  '',
  'Reply with ONLY a JSON object: { "reply": "what you say to them", "edits": [ ... ] }',
  '',
  EDIT_SPEC,
].join('\n')

export interface CoachArgs {
  training: TrainingStore
  settings: Settings
  fetchImpl: typeof fetch
  text: string
  today: string
  signal?: AbortSignal
  /** Told what the coach is doing while it answers: loading, reading the plan, thinking, writing, checking. */
  onStatus?: (status: CoachStatus) => void
}

/** One turn of the conversation: the person's message saved, the coach's reply (and any proposal) saved after it. */
export async function coachReply({ training, settings, fetchImpl, text, today, signal: abort, onStatus }: CoachArgs): Promise<CoachMessage[]> {
  const plan = training.activePlan()
  if (!plan) throw new Error('There\'s no active training schema to talk about. Import one first.')
  const history = training.messages(plan.id).slice(-HISTORY)
  training.addMessage(plan.id, 'user', text)
  const signal = AbortSignal.any([AbortSignal.timeout(COACH_TIMEOUT_MS), ...(abort ? [abort] : [])])
  const startedAt = Date.now()
  let phase: CoachStatus['phase'] = 'reading'
  const report = (p: Partial<CoachStatus>): void => onStatus?.({ phase, progress: null, tokens: 0, model: null, startedAt, ...p })
  report({})
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal, settings.planChatModel)
  // The last answer's stats, with the time for the whole turn (a retry included).
  let last: ChatProgress['stats'] | undefined
  const watch = (p: ChatProgress): void => {
    if (p.phase === 'done') { last = p.stats; return }
    report({ phase: phase === 'retrying' && p.phase !== 'writing' ? 'retrying' : p.phase, progress: p.progress, tokens: p.tokens, model })
  }
  const stats = (): CoachStats | null => (last ? { model, seconds: Math.round((Date.now() - startedAt) / 100) / 10, ...last } : null)
  const past = history.map((m) => {
    const proposal = m.proposal ? ` [proposed: ${m.proposal.preview.join('; ')} -- ${m.status}]` : ''
    // What actually happened, so a reply that claimed a change it didn't make isn't taken as done.
    const note = m.role === 'assistant' && !m.proposal && m.note ? ` [no change was made: ${m.note}]` : ''
    return `${m.role === 'user' ? 'Person' : 'Coach'}: ${m.text}${proposal}${note}`
  })
  const input = [coachContext(training, plan, today, settings), '', 'The conversation so far:', ...past, `Person: ${text}`].join('\n')
  const ask = async (body: string): Promise<string> => {
    const req: Record<string, unknown> = { model, system_prompt: SYSTEM, input: body, max_output_tokens: COACH_MAX_TOKENS }
    if (reasoning) req.reasoning = reasoning
    return chatText(settings, req, fetchImpl, signal, watch)
  }

  const read = (raw: string): { reply: string; edits: PlanEdit[] } => {
    const json = extractJson(raw) as { reply?: unknown; edits?: unknown } | null
    // A plain-text answer is still an answer: conversation needs no JSON.
    if (!json || typeof json.reply !== 'string') return { reply: raw.trim(), edits: [] }
    return { reply: json.reply.trim(), edits: normalize(json.edits) }
  }
  let raw = await ask(input)
  let { reply, edits } = read(raw)
  phase = 'checking'
  if (edits.length) report({ model })
  let checked = checkEdits(training, plan, edits, today, settings)
  if (edits.length && checked.errors.length) {
    phase = 'retrying'
    report({ model })
    raw = await ask([input, '', 'Your reply was:', raw.slice(0, 20_000), '', 'Its edits have these problems:', ...checked.errors.map((e) => `- ${e}`), '', 'Reply again with the corrected JSON.'].join('\n'))
    ;({ reply, edits } = read(raw))
    checked = checkEdits(training, plan, edits, today, settings)
  }
  if (!reply && !edits.length) {
    // Usually a thinking model that spent its whole reply on thinking.
    training.addMessage(plan.id, 'assistant', 'No answer came back that time.', null,
      `${model} didn't say anything. Try again, or choose a quicker Coach model in Settings (a mid-size one answers in seconds).`, stats())
  } else if (!edits.length) {
    training.addMessage(plan.id, 'assistant', reply, null, null, stats())
  } else if (checked.errors.length) {
    training.addMessage(plan.id, 'assistant', reply, null, `I couldn't turn that into a change to the plan (${checked.errors.slice(0, 2).join('; ')}). Try saying it another way.`, stats())
  } else {
    phase = 'checking'
    report({ model })
    const proposal: PlanProposal = { edits: checked.rewrite ? [checked.rewrite] : [...checked.overrides, ...checked.revisions], preview: previewEdits(training, plan, checked, today) }
    if (!proposal.preview.length) training.addMessage(plan.id, 'assistant', reply, null, 'That wouldn\'t change anything on the plan.', stats())
    else training.addMessage(plan.id, 'assistant', reply, proposal, null, stats())
  }
  return training.messages(plan.id)
}

/**
 * Apply a proposal: one-off changes are laid over the plan, lasting ones
 * make a new revision of it. A rewrite only starts here -- `startRewrite`
 * has the training model write it, and it's reviewed as a draft.
 */
export function applyProposal(
  training: TrainingStore, messageId: string, today: string, settings: Settings,
  startRewrite: (rewrite: { instruction: string; fromWeek: number; messageId: string }) => void,
): void {
  const msg = training.message(messageId)
  if (msg.status !== 'proposed' || !msg.proposal) throw new Error('that isn\'t a change waiting to be applied')
  const plan = training.activePlan()
  if (!plan || plan.id !== msg.schemaId) throw new Error('that change was for a plan that is no longer the active one')
  // Checked again: the plan may have moved on since it was proposed.
  const checked = checkEdits(training, plan, msg.proposal.edits, today, settings)
  if (checked.errors.length) throw new Error(`The plan has changed since; ask again. (${checked.errors[0]})`)
  if (checked.rewrite) {
    startRewrite({ instruction: checked.rewrite.instruction, fromWeek: checked.rewrite.fromWeek, messageId })
    training.setMessage(messageId, 'applied', 'Writing the new plan: it takes a few minutes, then it\'s under Block to review.')
    return
  }
  if (checked.overrides.length) training.addOverrides(plan.id, checked.overrides, messageId)
  if (checked.revised) training.revise(plan.id, checked.revised, 'coach', messageId)
  training.setMessage(messageId, 'applied')
}

export function undoProposal(training: TrainingStore, messageId: string): void {
  const msg = training.message(messageId)
  if (msg.status !== 'applied') throw new Error('that change isn\'t applied')
  training.undoMessage(messageId)
  training.setMessage(messageId, 'undone')
}
