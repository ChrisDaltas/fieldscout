/**
 * youtube-title — the oEmbed title lookup (gap list #11), with `fetch`
 * mocked: no test here reaches YouTube.
 *
 * The contract under test: a real title comes back cleaned; EVERY failure
 * resolves (never throws) to `title: null` with the reason it failed.
 */
import { describe, expect, it, vi } from 'vitest'

import { MAX_LINK_TITLE_LENGTH, YOUTUBE_OEMBED_ENDPOINT, cleanVideoTitle, lookUpYouTubeTitle } from './youtube-title'

const VIDEO = 'https://youtu.be/dQw4w9WgXcQ?si=tracking'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('lookUpYouTubeTitle', () => {
  it('returns the real title from oEmbed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ title: 'Week 6 Rankings: every RB, tiered', author_name: 'FieldScout', type: 'video' }),
    )
    await expect(lookUpYouTubeTitle(VIDEO, { fetchImpl })).resolves.toEqual({
      title: 'Week 6 Rankings: every RB, tiered',
      reason: null,
    })
  })

  it('asks the official endpoint for the canonical watch URL only, as JSON, with a timeout signal', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ title: 'x' }))
    await lookUpYouTubeTitle(VIDEO, { fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [input, init] = fetchImpl.mock.calls[0]!
    const requested = new URL(String(input))
    expect(`${requested.origin}${requested.pathname}`).toBe(YOUTUBE_OEMBED_ENDPOINT)
    expect(requested.searchParams.get('format')).toBe('json')
    // The user's tracking parameters never leave the server — just the id.
    expect(requested.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('a non-200 (private / deleted / embed-disabled video) is no title, with its status', async () => {
    for (const status of [401, 403, 404, 500]) {
      const fetchImpl = vi.fn(async () => new Response('Not Found', { status }))
      await expect(lookUpYouTubeTitle(VIDEO, { fetchImpl })).resolves.toEqual({
        title: null,
        reason: 'http-error',
        detail: `HTTP ${status}`,
      })
    }
  })

  it('gives up at the timeout instead of holding the attach', async () => {
    // A fetch that never answers on its own — only the abort signal ends it.
    const fetchImpl = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const started = Date.now()
    const result = await lookUpYouTubeTitle(VIDEO, { fetchImpl, timeoutMs: 30 })
    expect(result).toMatchObject({ title: null, reason: 'timeout' })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a body that is not JSON is no title', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>consent wall</html>', { status: 200 }))
    await expect(lookUpYouTubeTitle(VIDEO, { fetchImpl })).resolves.toMatchObject({
      title: null,
      reason: 'bad-response',
    })
  })

  it('JSON without a string title (or a blank one) is no title', async () => {
    for (const body of [{}, { title: 42 }, { title: null }, { title: '   ' }, ['title']]) {
      const fetchImpl = vi.fn(async () => jsonResponse(body))
      const result = await lookUpYouTubeTitle(VIDEO, { fetchImpl })
      expect(result, JSON.stringify(body)).toMatchObject({ title: null, reason: 'bad-response' })
    }
  })

  it('a network error is no title, never a throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(lookUpYouTubeTitle(VIDEO, { fetchImpl })).resolves.toEqual({
      title: null,
      reason: 'network',
      detail: 'fetch failed',
    })
  })

  it('never calls out for a link that is not a YouTube video', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ title: 'x' }))
    for (const url of ['https://vimeo.com/123456', 'https://example.com/?v=abcdefghijk', 'not a url']) {
      await expect(lookUpYouTubeTitle(url, { fetchImpl })).resolves.toEqual({ title: null, reason: 'not-youtube' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('cleanVideoTitle', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanVideoTitle('  Week 6\n\tRankings  ')).toBe('Week 6 Rankings')
    expect(cleanVideoTitle(' \n ')).toBeNull()
  })

  it('cuts a long title to 080’s 200-character ceiling, counted as Postgres counts', () => {
    const long = '🏈'.repeat(250)
    const cut = cleanVideoTitle(long)!
    expect(Array.from(cut)).toHaveLength(MAX_LINK_TITLE_LENGTH)
    expect(cut.endsWith('…')).toBe(true)
    expect(cleanVideoTitle('a'.repeat(200))).toBe('a'.repeat(200))
  })
})
