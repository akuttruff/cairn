import type {
  DayType, DayView, Entry, Food, Goals, LabelReading, Meal, MealPreset, MealPresetItem, NewEntry, Nutrients, PublicSettings, RangeNotes, RangeView, Serving,
  AlcoholKind, AlcoholLog, AppIcon, ChartKey, WaterLog, LmModelOption, MeditationLog, DogWalkLog, WorkoutKind, WorkoutKindDef, WorkoutLog, WorkoutPlan,
} from '../types.ts'
import { TIMING } from './timing.ts'

/** An online lookup in progress or finished; see server/research.ts. */
export interface ResearchJob {
  id: string
  query: string
  status: 'running' | 'done' | 'error'
  step: string
  startedAt: number
  result?: { query: string; foods: Food[]; note?: string; model: string; seconds: number }
  error?: string
}

export interface SearchResult {
  usda: Food[]
  off: Food[]
  errors: { source: 'usda' | 'off'; message: string }[]
  brand?: string
  barcode?: boolean
}

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  // A request that gets no reply at all is tried again, when trying again is
  // safe (a read changes nothing). It happens for a moment while the server
  // restarts, and in Firefox, whose Local Network Access check can fail the
  // first request to a Tailscale address while it decides to allow it.
  const waits = method === 'GET' ? TIMING.retryWaitsMs : []
  let res: Response | undefined
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (err) {
      // Cancelled by the caller (a search overtaken by more typing): not a failure.
      if (signal?.aborted) throw err
      const wait = waits[attempt]
      // Out of tries: say which request, so a repeat can be traced.
      if (wait === undefined) throw new ApiError(`Couldn't reach Cairn (${method} ${path.split('?')[0]}). Check the connection and try again.`)
      await new Promise((r) => setTimeout(r, wait))
      signal?.throwIfAborted()
    }
  }
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`)
  return data as T
}

export const api = {
  day: (date: string) => request<DayView>('GET', `/api/day/${date}`),
  range: (start: string, end: string) => request<RangeView>('GET', `/api/range?start=${start}&end=${end}`),
  addEntry: (entry: NewEntry) => request<Entry>('POST', '/api/entries', entry),
  updateEntry: (id: string, patch: {
    grams?: number; quantity?: number; meal?: Meal; name?: string; nutrients?: Nutrients; perUnit?: Nutrients
  }) =>
    request<Entry>('PATCH', `/api/entries/${encodeURIComponent(id)}`, patch),
  deleteEntry: (id: string) => request<{ ok: true }>('DELETE', `/api/entries/${encodeURIComponent(id)}`),
  foods: () => request<{ saved: Food[]; recent: Food[] }>('GET', '/api/foods'),
  saveFood: (food: Food) => request<Food>('POST', '/api/foods', food),
  deleteFood: (id: string) => request<{ ok: true }>('DELETE', `/api/foods/${encodeURIComponent(id)}`),
  search: (q: string, signal?: AbortSignal) => request<SearchResult>('GET', `/api/search?q=${encodeURIComponent(q)}`, undefined, signal),
  portions: (fdcId: string) => request<Serving[]>('GET', `/api/portions/${encodeURIComponent(fdcId)}`),
  // "targets", not "goals": privacy blockers (Firefox's, uBlock's lists) block URLs with "goals" in them,
  // since analytics tools use the word. /api/goals still answers for anything else.
  goals: () => request<Goals>('GET', '/api/targets'),
  setGoals: (goals: Partial<Goals>) => request<Goals>('PUT', '/api/targets', goals),
  setDayType: (date: string, type: DayType) =>
    request<{ date: string; type: DayType }>('PUT', `/api/day-type/${encodeURIComponent(date)}`, { type }),
  addWater: (date: string, ounces: number) => request<WaterLog>('POST', '/api/water', { date, ounces }),
  deleteWater: (id: string) => request<{ ok: true }>('DELETE', `/api/water/${encodeURIComponent(id)}`),
  addAlcohol: (date: string, kind: AlcoholKind) => request<AlcoholLog>('POST', '/api/alcohol', { date, kind }),
  deleteAlcohol: (id: string) => request<{ ok: true }>('DELETE', `/api/alcohol/${encodeURIComponent(id)}`),
  addWorkout: (w: { date: string; kind: WorkoutKind; minutes?: number | null; note?: string }) =>
    request<WorkoutLog>('POST', '/api/workouts', w),
  deleteWorkout: (id: string) => request<{ ok: true }>('DELETE', `/api/workouts/${encodeURIComponent(id)}`),
  /** Give one week (by its Sunday) its own plan, or put it back on the default. */
  setWeekPlan: (weekStart: string, plan: WorkoutPlan) =>
    request<{ weekStart: string; plan: WorkoutPlan; custom: boolean }>('PUT', `/api/workout-plan/${encodeURIComponent(weekStart)}`, { plan }),
  clearWeekPlan: (weekStart: string) =>
    request<{ weekStart: string; plan: WorkoutPlan; custom: boolean }>('DELETE', `/api/workout-plan/${encodeURIComponent(weekStart)}`),
  addMeditation: (m: { date: string; minutes: number; note?: string }) => request<MeditationLog>('POST', '/api/meditation', m),
  deleteMeditation: (id: string) => request<{ ok: true }>('DELETE', `/api/meditation/${encodeURIComponent(id)}`),
  addDogWalk: (w: { date: string; miles?: number }) => request<DogWalkLog>('POST', '/api/dog-walks', w),
  deleteDogWalk: (id: string) => request<{ ok: true }>('DELETE', `/api/dog-walks/${encodeURIComponent(id)}`),
  settings: () => request<PublicSettings>('GET', '/api/settings'),
  setSettings: (s: { usdaApiKey?: string; lmStudioUrl?: string; lmStudioToken?: string; researchModel?: string; notesModel?: string; labelModel?: string; autoLookup?: boolean; appIcon?: AppIcon; charts?: ChartKey[]; workoutKinds?: WorkoutKindDef[] }) =>
    request<PublicSettings>('PUT', '/api/settings', s),
  /** Read a photographed nutrition label (a JPEG/PNG/WebP data URL) into the Manual tab's fields. Seconds, once the model is loaded. */
  readLabel: (image: string) => request<{ reading: LabelReading }>('POST', '/api/label', { image }),
  /** LLMs LM Studio has downloaded, for the model picker. `error` says why the list is empty. */
  lmModels: () => request<{ models: LmModelOption[]; error: string | null }>('GET', '/api/lm-models'),
  /** `refresh` skips the cached answer and runs a fresh lookup. */
  startResearch: (q: string, refresh = false) =>
    request<ResearchJob>('POST', '/api/research', refresh ? { q, refresh: true } : { q }),
  research: (id: string) => request<ResearchJob>('GET', `/api/research/${encodeURIComponent(id)}`),
  cancelResearch: (id: string) => request<{ cancelled: boolean }>('DELETE', `/api/research/${encodeURIComponent(id)}`),
  /** Notes on a week or month, if written; `stale` when the numbers moved since. */
  notes: (start: string, end: string) => request<{ notes: RangeNotes | null }>('GET', `/api/notes?start=${start}&end=${end}`),
  /** Write (or rewrite) the notes now; a few seconds on a small model. */
  writeNotes: (start: string, end: string) => request<{ notes: RangeNotes | null }>('POST', '/api/notes', { start, end }),
  meals: () => request<MealPreset[]>('GET', '/api/meals'),
  /** Create with no id; save an edit with the id of the meal it replaces. */
  saveMeal: (meal: { id?: string; name: string; items: MealPresetItem[] }) =>
    request<MealPreset>('POST', '/api/meals', meal),
  deleteMeal: (id: string) => request<{ ok: true }>('DELETE', `/api/meals/${encodeURIComponent(id)}`),
  /** Logs every food in the meal to one date and meal-of-day, in one action. */
  applyMeal: (id: string, date: string, meal: Meal) =>
    request<Entry[]>('POST', `/api/meals/${encodeURIComponent(id)}/apply`, { date, meal }),
}
