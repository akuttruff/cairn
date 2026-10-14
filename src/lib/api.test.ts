import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api.ts'

const answer = { usda: [], off: [], errors: [] }
const ok = () => new Response(JSON.stringify(answer), { status: 200 })

describe('api.search', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('tries again when a request gets no reply, as the other reads do', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockRejectedValueOnce(new TypeError('NetworkError when attempting to fetch resource.'))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.search('apple')).resolves.toEqual(answer)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('names the search when Cairn stays out of reach', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))
    await expect(api.search('apple')).rejects.toThrow("Couldn't reach Cairn (GET /api/search)")
  })

  it('stops at once when the search is overtaken by more typing', async () => {
    const ctl = new AbortController()
    const fetchMock = vi.fn(() => { ctl.abort(); return Promise.reject(new DOMException('aborted', 'AbortError')) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(api.search('apple', ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("passes on the server's own error", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'search is too long' }), { status: 400 })))
    await expect(api.search('x'.repeat(101))).rejects.toThrow('search is too long')
  })
})
