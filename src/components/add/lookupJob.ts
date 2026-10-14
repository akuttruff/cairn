/** The online lookup left running when the sheet was closed, so it can be picked up again. */
import type { ResearchJob } from '../../lib/api.ts'

export const JOB_KEY = 'macros.research'

export function readSavedJob(): string | null {
  try { return localStorage.getItem(JOB_KEY) } catch { return null }
}

export function saveJob(id: string): void {
  try { localStorage.setItem(JOB_KEY, id) } catch { /* private mode: just not restored */ }
}

export function forgetJob(): void {
  try { localStorage.removeItem(JOB_KEY) } catch { /* nothing to forget */ }
}

/** A job as the server describes it -- not an empty or error body. */
export const isJob = (j: unknown): j is ResearchJob =>
  Boolean(j && typeof (j as ResearchJob).id === 'string' && typeof (j as ResearchJob).query === 'string')
