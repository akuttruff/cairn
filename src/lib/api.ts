import type {
  DayType, DayView, Entry, Food, Goals, Meal, MealPreset, MealPresetItem, NewEntry, Nutrients, PublicSettings, RangeView, Serving,
  AlcoholKind, AlcoholLog, AppIcon, ChartKey, WaterLog, LmModelOption, MeditationLog, WorkoutKind, WorkoutLog, WorkoutPlan,
} from '../types.ts'

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // No reply at all (a dropped connection, the server restarting): say which request, so a repeat can be traced.
    throw new ApiError(`Couldn't reach Cairn (${method} ${path.split('?')[0]}). Check the connection and try again.`)
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
  search: (q: string, signal?: AbortSignal) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal }).then(async (res) => {
      const data = await res.json() as SearchResult & { error?: string }
      if (!res.ok) throw new ApiError(data.error || 'Search failed')
      return data
    }),
  portions: (fdcId: string) => request<Serving[]>('GET', `/api/portions/${encodeURIComponent(fdcId)}`),
  goals: () => request<Goals>('GET', '/api/goals'),
  setGoals: (goals: Partial<Goals>) => request<Goals>('PUT', '/api/goals', goals),
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
  settings: () => request<PublicSettings>('GET', '/api/settings'),
  setSettings: (s: { usdaApiKey?: string; lmStudioUrl?: string; lmStudioToken?: string; researchModel?: string; autoLookup?: boolean; appIcon?: AppIcon; charts?: ChartKey[] }) =>
    request<PublicSettings>('PUT', '/api/settings', s),
  /** LLMs LM Studio has downloaded, for the model picker. `error` says why the list is empty. */
  lmModels: () => request<{ models: LmModelOption[]; error: string | null }>('GET', '/api/lm-models'),
  /** `refresh` skips the cached answer and runs a fresh lookup. */
  startResearch: (q: string, refresh = false) =>
    request<ResearchJob>('POST', '/api/research', refresh ? { q, refresh: true } : { q }),
  research: (id: string) => request<ResearchJob>('GET', `/api/research/${encodeURIComponent(id)}`),
  cancelResearch: (id: string) => request<{ cancelled: boolean }>('DELETE', `/api/research/${encodeURIComponent(id)}`),
  meals: () => request<MealPreset[]>('GET', '/api/meals'),
  /** Create with no id; save an edit with the id of the meal it replaces. */
  saveMeal: (meal: { id?: string; name: string; items: MealPresetItem[] }) =>
    request<MealPreset>('POST', '/api/meals', meal),
  deleteMeal: (id: string) => request<{ ok: true }>('DELETE', `/api/meals/${encodeURIComponent(id)}`),
  /** Logs every food in the meal to one date and meal-of-day, in one action. */
  applyMeal: (id: string, date: string, meal: Meal) =>
    request<Entry[]>('POST', `/api/meals/${encodeURIComponent(id)}/apply`, { date, meal }),
}
