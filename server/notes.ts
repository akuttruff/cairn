import { createHash } from 'node:crypto'
import { chatText, chooseModel } from './research.ts'
import { localDate } from '../src/lib/nutrition.ts'
import type { RangeView, Settings } from '../src/types.ts'

/** How long the model gets to write the notes before they are given up on. */
export const NOTES_TIMEOUT_MS = 120_000

export const NOTES_PROMPT = [
  'You are a steady, encouraging coach reviewing someone\'s own food, water, drink and training log.',
  'Write notes on the period for them: two or three short paragraphs, at most 170 words, plain prose,',
  'addressed as "you". Be specific with their numbers against their goals: what went well, what slipped',
  'and on which days, and one concrete, small suggestion for the next period. No headings, bullets,',
  'bold or emoji. Do not moralize.',
  'The period may still be under way: the input says which day is today and marks the days still ahead.',
  'Days still ahead have not happened, so a weekly target (workouts, drinks) that can still be reached in them is',
  'not missed: say what is left to do, or leave it out. Judge only the days that are over. Reply with the notes only.',
].join(' ')
export const NOTES_MAX_TOKENS = 700

const n = (v: number | null | undefined): string => (v == null ? '-' : String(Math.round(v)))

/** The range, laid out for the model: goals, the period's averages, each day's line, and which days are still ahead. */
export function notesInput(view: RangeView, today: string = localDate()): string {
  const g = view.goals
  const lines: string[] = []
  const kind = view.days.length <= 7 ? 'Week' : 'Month'
  const ahead = view.days.filter((d) => d.date > today).length
  lines.push(`${kind}: ${view.start} to ${view.end}. Logged ${view.loggedDays} of ${view.totalDays} days.`)
  lines.push(ahead > 0
    ? `Today is ${today}. This ${kind.toLowerCase()} is still under way: ${ahead} day${ahead === 1 ? '' : 's'} still ahead, so weekly targets are not final.`
    : `This ${kind.toLowerCase()} is over (today is ${today}).`)
  lines.push(`Daily goals: calories max ${n(g.calories.max)}, protein min ${n(g.protein.min)} g, fat min ${n(g.fat.min)} g, fiber min ${n(g.fiber)} g (carbs are counted but have no goal), water ${n(g.water)} oz (mugs of tea count); alcohol at most ${n(g.alcoholWeekly)} drinks a week; meditation ${n(g.meditationMinutes)} min a day; dog walks ${n(g.dogWalks)} a day.`)
  lines.push(`Averages over ${view.averagedDays} finished days: ${n(view.averages.calories)} kcal, protein ${n(view.averages.protein)} g, fat ${n(view.averages.fat)} g, carbs ${n(view.averages.carbs)} g, fiber ${n(view.averages.fiber)} g; water ${n(view.water.average)} oz a day (goal met ${view.water.met} of ${view.water.of} logged days).`)
  const sc = view.scorecard
  lines.push(`Goal days met: calories ${sc.calories.met}/${sc.calories.of}, protein ${sc.protein.met}/${sc.protein.of}, fat ${sc.fat.met}/${sc.fat.of}, fiber ${sc.fiber.met}/${sc.fiber.of}.`)
  const w = view.workouts
  const byKind = w.kinds.filter((k) => w.byKind[k.id] > 0 || w.goalByKind[k.id] > 0).map((k) => `${k.label} ${w.byKind[k.id]}/${w.goalByKind[k.id]}`).join(', ')
  lines.push(`Workouts so far: ${w.sessions} sessions on ${w.days} days (${w.minutes} min)${byKind ? `; by activity (done/planned for the whole ${kind.toLowerCase()}): ${byKind}` : ''}; goal ${w.goal}${ahead > 0 ? `, with ${ahead} day${ahead === 1 ? '' : 's'} left to reach it` : ''}.`)
  lines.push(`Alcohol: ${view.alcohol.total} drinks (${Math.round(view.alcohol.calories)} kcal). Meditation: ${view.meditation.total} min on ${view.meditation.days} days, goal met ${view.meditation.met}/${view.meditation.of}, streak ${view.meditation.streak}. Dog walks: ${view.dog.walks} walks, ${view.dog.miles} miles on ${view.dog.days} days.`)
  lines.push('Each day (date, kcal/P/F/C/Fib, water oz, drinks, workouts, meditation min, dog walks):')
  for (const d of view.days) {
    if (d.date > today) {
      lines.push(`${d.date}: still ahead`)
      continue
    }
    if (d.entryCount === 0 && d.water === 0 && d.alcohol === 0 && d.workouts === 0 && d.meditationMinutes === 0 && d.dogWalks === 0) {
      lines.push(`${d.date}: nothing logged`)
      continue
    }
    lines.push(`${d.date}: ${n(d.totals.calories)}/${n(d.totals.protein)}/${n(d.totals.fat)}/${n(d.totals.carbs)}/${n(d.totals.fiber)}, water ${n(d.water)}, drinks ${d.alcohol}, workouts ${d.workouts}, meditation ${d.meditationMinutes}, walks ${d.dogWalks}`)
  }
  return lines.join('\n')
}

/** What the notes were written from: changes when any of the range's numbers do. */
export function fingerprint(view: RangeView): string {
  const basis = {
    days: view.days.map((d) => [d.date, d.entryCount, d.totals, d.water, d.alcohol, d.workouts, d.workoutMinutes, d.meditationMinutes, d.dogWalks]),
    goals: view.goals,
  }
  return createHash('sha1').update(JSON.stringify(basis)).digest('hex').slice(0, 16)
}

/** A reply that ran past the cap ends mid-sentence: keep whole sentences, and drop any bold the model added. */
export function tidyNotes(text: string): string {
  const t = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '').trim()
  if (/[.!?…")\]]$/.test(t)) return t
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('.\n'))
  return cut < 40 ? t : t.slice(0, cut + 1).trim()
}

/** Write the notes for a range with the notes model (else the research one), and say which model wrote them. */
export async function writeNotes(view: RangeView, settings: Settings, fetchImpl: typeof fetch, abort?: AbortSignal): Promise<{ text: string; model: string }> {
  // Given up on after the timeout, or as soon as `abort` says nobody is waiting for the answer.
  const signal = AbortSignal.any([AbortSignal.timeout(NOTES_TIMEOUT_MS), ...(abort ? [abort] : [])])
  const { model, reasoning } = await chooseModel(settings, fetchImpl, signal, settings.notesModel)
  const body: Record<string, unknown> = { model, system_prompt: NOTES_PROMPT, input: notesInput(view), max_output_tokens: NOTES_MAX_TOKENS }
  if (reasoning) body.reasoning = reasoning
  const text = tidyNotes(await chatText(settings, body, fetchImpl, signal))
  if (!text) throw new Error('The model wrote nothing.')
  return { text, model }
}
