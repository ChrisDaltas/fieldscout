/**
 * links-service — the YouTube title lookup on attach (Chris, 2026-10-15,
 * mobile gap list #11), at the UNIT layer: a scripted Supabase stand-in and
 * an injected lookup, so nothing here touches a database or YouTube. The
 * real-PostgREST behaviour of `addLink` stays pinned by `links-api-db.test.ts`
 * (every one of its attaches sends a title, so it never looks one up).
 *
 * Chris's rule (2026-10-15, correcting the first build): "we need the actual
 * YouTube titles or nothing. Having a bunch of videos with the same title is
 * useless." So a title is YouTube's real one or NULL — never a placeholder.
 *
 * Pinned:
 *   - the wire schema admits a missing title ONLY for a YouTube video;
 *   - a looked-up title is what gets stored;
 *   - a failed (or throwing) lookup stores NULL — migration 189 — and says
 *     why in the log;
 *   - on the OLD schema (before 189 is pushed: `title` NOT NULL, simulated
 *     by the fake answering 23502) that attach is refused with a retryable
 *     503 and NOTHING is written — no stand-in title, ever;
 *   - a successful lookup attaches on the old schema too;
 *   - a caller's own title (desktop's attach form) is never looked up;
 *   - a refused request (not the owner) never reaches YouTube.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/types/database'

import { addLink, addLinkInputSchema, TITLE_REQUIRED_MESSAGE, VIDEO_TITLE_UNAVAILABLE_MESSAGE } from './links-service'
import type { YouTubeTitleResult } from './youtube-title'

const OWNER = '11111111-1111-4111-8111-111111111111'
const STRANGER = '33333333-3333-4333-8333-333333333333'
const LIST = '22222222-2222-4222-8222-222222222222'
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

/**
 * Just enough of the PostgREST builder for `addLink`: the owner probe on
 * `lists`, the link reads, and the insert — which is recorded only when it
 * lands. `schema: 'pre-189'` answers a NULL title the way the old schema
 * does: `23502`, nothing stored.
 */
function fakeSupabase({ schema = '189' }: { schema?: '189' | 'pre-189' } = {}) {
  const attempted: Array<Record<string, unknown>> = []
  const inserted: Array<Record<string, unknown>> = []
  const stored: Array<Record<string, unknown>> = []

  function builder(table: string) {
    let pendingInsert: Record<string, unknown> | null = null
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      insert: (row: Record<string, unknown>) => {
        pendingInsert = row
        return chain
      },
      maybeSingle: async () =>
        table === 'lists' ? { data: { id: LIST, owner_id: OWNER }, error: null } : { data: null, error: null },
      single: async () => {
        attempted.push(pendingInsert!)
        if (schema === 'pre-189' && pendingInsert?.title == null) {
          return {
            data: null,
            error: {
              code: '23502',
              message: 'null value in column "title" of relation "list_links" violates not-null constraint',
            },
          }
        }
        const row = {
          id: `44444444-4444-4444-8444-44444444444${stored.length}`,
          created_at: '2026-10-15T00:00:00Z',
          source_label: null,
          duration_label: null,
          ...pendingInsert,
        }
        inserted.push(pendingInsert!)
        stored.push(row)
        return { data: row, error: null }
      },
      // `fetchListLinks` awaits the builder itself.
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [...stored], error: null }),
    }
    return chain
  }

  const client = { from: (table: string) => builder(table) } as unknown as SupabaseClient<Database>
  return { client, inserted, attempted }
}

function lookup(result: YouTubeTitleResult) {
  return vi.fn<(url: string) => Promise<YouTubeTitleResult>>(async () => result)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('addLinkInputSchema — a title may be left out only for a YouTube video', () => {
  it('admits a YouTube video with no title (missing or null)', () => {
    expect(addLinkInputSchema.safeParse({ kind: 'video', url: VIDEO }).success).toBe(true)
    expect(addLinkInputSchema.safeParse({ kind: 'video', url: 'youtu.be/dQw4w9WgXcQ', title: null }).success).toBe(true)
  })

  it('still requires a title for an article, or a video that is not on YouTube', () => {
    for (const body of [
      { kind: 'article', url: 'https://example.com/a' },
      { kind: 'article', url: VIDEO },
      { kind: 'video', url: 'https://vimeo.com/123456' },
    ]) {
      const parsed = addLinkInputSchema.safeParse(body)
      expect(parsed.success, JSON.stringify(body)).toBe(false)
      if (!parsed.success) expect(parsed.error.issues[0]?.message).toBe(TITLE_REQUIRED_MESSAGE)
    }
  })

  it('a title that IS sent keeps 080’s bounds (blank is still refused)', () => {
    expect(addLinkInputSchema.safeParse({ kind: 'video', url: VIDEO, title: '  ' }).success).toBe(false)
    expect(addLinkInputSchema.safeParse({ kind: 'video', url: VIDEO, title: 'a'.repeat(201) }).success).toBe(false)
  })
})

describe('addLink — the oEmbed title', () => {
  it('stores YouTube’s real title when none is sent', async () => {
    const { client, inserted } = fakeSupabase()
    const lookUpTitle = lookup({ title: 'Week 6 RB tiers', reason: null })
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result.status).toBe(201)
    expect(lookUpTitle).toHaveBeenCalledWith(VIDEO)
    expect(inserted[0]).toMatchObject({ kind: 'video', url: VIDEO, title: 'Week 6 RB tiers' })
    expect(result.body).toMatchObject({ link: { title: 'Week 6 RB tiers' } })
  })

  it('a failed lookup stores NO title (NULL), never a placeholder, and logs why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, inserted } = fakeSupabase()
    const lookUpTitle = lookup({ title: null, reason: 'timeout', detail: 'no answer within 3000ms' })
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result.status).toBe(201)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.title).toBeNull()
    expect(result.body).toMatchObject({ link: { url: VIDEO, title: null } })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timeout'))
    expect(JSON.stringify(result.body)).not.toMatch(/youtube video/i)
  })

  it('a lookup that throws stores NULL too', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, inserted } = fakeSupabase()
    const lookUpTitle = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result.status).toBe(201)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.title).toBeNull()
  })

  it('before 189 is pushed (title NOT NULL → 23502): a failed lookup is a retryable 503 and nothing is written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, inserted, attempted } = fakeSupabase({ schema: 'pre-189' })
    const lookUpTitle = lookup({ title: null, reason: 'http-error', detail: 'HTTP 404' })
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result).toEqual({ status: 503, body: { error: VIDEO_TITLE_UNAVAILABLE_MESSAGE } })
    expect(VIDEO_TITLE_UNAVAILABLE_MESSAGE).toBe("Couldn't get this video's title from YouTube. Try again in a moment.")
    expect(inserted).toHaveLength(0)
    // Exactly one insert attempt, with NO title — the refusal is not a retry
    // under a stand-in.
    expect(attempted).toHaveLength(1)
    expect(attempted[0]!.title).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 404'))
  })

  it('before 189 is pushed, a lookup that succeeds still attaches with the real title', async () => {
    const { client, inserted } = fakeSupabase({ schema: 'pre-189' })
    const lookUpTitle = lookup({ title: 'Week 6 RB tiers', reason: null })
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result.status).toBe(201)
    expect(inserted[0]).toMatchObject({ title: 'Week 6 RB tiers' })
  })

  it('a 23502 is only read as "no title yet" when the title really was empty', async () => {
    // A not-null violation on an insert that CARRIED a title is some other
    // column — reported as the 500 it is, never as the title refusal.
    const client = {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          insert: () => chain,
          maybeSingle: async () =>
            table === 'lists' ? { data: { id: LIST, owner_id: OWNER }, error: null } : { data: null, error: null },
          single: async () => ({ data: null, error: { code: '23502', message: 'null value in column "kind"' } }),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
        }
        return chain
      },
    } as unknown as SupabaseClient<Database>
    const result = await addLink(client, LIST, OWNER, { kind: 'video', url: VIDEO, title: 'Mine' })
    expect(result.status).toBe(500)
  })

  it('a title the caller sends is stored as sent and never looked up (desktop’s attach form)', async () => {
    const { client, inserted } = fakeSupabase()
    const lookUpTitle = lookup({ title: 'should not be used', reason: null })
    const result = await addLink(
      client,
      LIST,
      OWNER,
      { kind: 'video', url: VIDEO, title: 'My own words' },
      { lookUpTitle },
    )
    expect(result.status).toBe(201)
    expect(lookUpTitle).not.toHaveBeenCalled()
    expect(inserted[0]).toMatchObject({ title: 'My own words' })
  })

  it('a refused request never reaches YouTube', async () => {
    const { client, inserted } = fakeSupabase()
    const lookUpTitle = lookup({ title: 'x', reason: null })
    const result = await addLink(client, LIST, STRANGER, { kind: 'video', url: VIDEO }, { lookUpTitle })
    expect(result.status).toBe(403)
    expect(lookUpTitle).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(0)
  })
})
