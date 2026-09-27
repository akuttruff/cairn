import type {
  DayView, Entry, Food, Goals, Meal, NewEntry, Nutrients, PublicSettings, Serving,
} from '../types.ts'

export interface SearchResult {
  usda: Food[]
  off: Food[]
  errors: { source: 'usda' | 'off'; message: string }[]
}

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({})) as { error?: string }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`)
  return data as T
}

export const api = {
  day: (date: string) => request<DayView>('GET', `/api/day/${date}`),
  addEntry: (entry: NewEntry) => request<Entry>('POST', '/api/entries', entry),
  updateEntry: (id: string, patch: { grams?: number; meal?: Meal; name?: string; nutrients?: Nutrients }) =>
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
  settings: () => request<PublicSettings>('GET', '/api/settings'),
  setSettings: (s: { usdaApiKey: string }) => request<PublicSettings>('PUT', '/api/settings', s),
}
