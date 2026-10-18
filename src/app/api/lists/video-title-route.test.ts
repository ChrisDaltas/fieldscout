/**
 * GET /api/lists/video-title — a pasted video's real title before it is
 * attached (gap list §3 #4), and the phone's reader of it.
 *
 * Pinned here:
 *   1. Signed out → 401, and YouTube is never asked (not an open proxy).
 *   2. Anything but an 11-character YouTube id → 400, and YouTube is never asked.
 *   3. The lookup is the attach route's own, asked for the canonical watch URL;
 *      a title comes back as-is, a failure as `title: null` WITH its reason
 *      ("the real title or nothing" — never a placeholder).
 *   4. The phone's fetcher turns a failed request into an error, never a quiet
 *      null.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  lookUp: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }),
}))
vi.mock('@/lib/lists/youtube-title', () => ({ lookUpYouTubeTitle: h.lookUp }))

import { fetchYouTubeTitle } from '@/hooks/use-youtube-title'

import { GET } from './video-title/route'

const get = (id: string) => GET(new Request(`http://localhost/api/lists/video-title?id=${encodeURIComponent(id)}`))

beforeEach(() => {
  h.user = { id: 'u1' }
  h.lookUp.mockReset()
  vi.restoreAllMocks()
})

describe('GET /api/lists/video-title', () => {
  it('signed out → 401, and YouTube is never asked', async () => {
    h.user = null
    const res = await get('dQw4w9WgXcQ')
    expect(res.status).toBe(401)
    expect(h.lookUp).not.toHaveBeenCalled()
  })

  it('a bad id → 400, and YouTube is never asked', async () => {
    for (const id of ['', 'short', 'dQw4w9WgXcQx', 'dQw4w9WgX/Q', 'https://youtu.be/dQw4w9WgXcQ']) {
      expect((await get(id)).status).toBe(400)
    }
    expect(h.lookUp).not.toHaveBeenCalled()
  })

  it('looks the canonical watch URL up and answers the real title', async () => {
    h.lookUp.mockResolvedValue({ title: 'Week 7 film room', reason: null })
    const res = await get('dQw4w9WgXcQ')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'dQw4w9WgXcQ', title: 'Week 7 film room', reason: null })
    expect(h.lookUp).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('no title from YouTube → title null with the reason (logged), never a placeholder', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.lookUp.mockResolvedValue({ title: null, reason: 'http-error', detail: 'HTTP 404' })
    const res = await get('dQw4w9WgXcQ')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'dQw4w9WgXcQ', title: null, reason: 'http-error' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('http-error: HTTP 404'))
  })
})

describe('fetchYouTubeTitle (the phone’s reader)', () => {
  it('returns the title, or null when YouTube gave none', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ id: 'dQw4w9WgXcQ', title: 'Film', reason: null }))
      .mockResolvedValueOnce(Response.json({ id: 'dQw4w9WgXcQ', title: null, reason: 'timeout' }))
    await expect(fetchYouTubeTitle('dQw4w9WgXcQ')).resolves.toBe('Film')
    await expect(fetchYouTubeTitle('dQw4w9WgXcQ')).resolves.toBeNull()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/lists/video-title?id=dQw4w9WgXcQ')
  })

  it('a failed request is an error, not a quiet null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ error: 'Unauthorized' }, { status: 401 }))
    await expect(fetchYouTubeTitle('dQw4w9WgXcQ')).rejects.toThrow('HTTP 401')
  })
})
