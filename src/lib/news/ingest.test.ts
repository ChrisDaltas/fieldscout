/**
 * R1590 / R1592 — the ingest's fetch budget and body cap, with stub sources
 * and a stub db (no network, no stack).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import { type FetchLike, ingestPlayerNews, readCapped } from './ingest'
import type { BlueskySource, RssSource } from './sources'

const rss = (key: string): RssSource => ({ kind: 'rss', key, label: key, url: `https://${key}.test/feed` })
const FEED = `<?xml version="1.0"?><rss><channel><item><guid>g1</guid><title>Jordan Love throws 3 TDs</title><link>https://ok.test/a</link><pubDate>Sun, 18 Oct 2026 20:00:00 GMT</pubDate></item></channel></rss>`

function stubDb() {
  const writes: Array<{ table: string; rows: unknown[] }> = []
  const db = {
    from(table: string) {
      const q = {
        select: () => q,
        not: () => q,
        neq: () => q,
        order: () => q,
        range: async () => ({ data: [{ id: 'love', full_name: 'Jordan Love', team: 'GB' }], error: null }),
        upsert: (rows: Array<Record<string, unknown>>) => {
          writes.push({ table, rows })
          return {
            select: async () => ({
              data: rows.map((r, i) => (table === 'player_news' ? { id: `n${i}`, external_id: r.external_id } : { news_id: r.news_id })),
              error: null,
            }),
          }
        },
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, writes }
}

/** A source that never answers — it only rejects when its signal aborts, like real fetch. */
const hung: FetchLike = (_url, init) =>
  new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
  })

describe('ingestPlayerNews — budget (R1590)', () => {
  it('a hung source is cut at the budget and named; the others still land', async () => {
    const { db, writes } = stubDb()
    const f: FetchLike = (url, init) => (url.includes('hung') ? hung(url, init) : Promise.resolve(new Response(FEED)))
    const started = performance.now()
    const report = await ingestPlayerNews({
      db,
      time: { now: () => new Date('2026-10-18T21:00:00Z') },
      fetch: f,
      sources: [rss('ok'), rss('hung')],
      budgetMs: 200,
    })
    expect(performance.now() - started).toBeLessThan(2_000)
    expect(report.ok).toBe(false)
    expect(report.sources).toEqual([
      { key: 'ok', fetched: 1, matched: 1 },
      { key: 'hung', fetched: 0, matched: 0, error: 'timed out' },
    ])
    expect(writes.map((w) => w.table)).toEqual(['player_news', 'player_news_players'])
  })

  it('sources are fetched concurrently, not one after another', async () => {
    const { db } = stubDb()
    let inFlight = 0
    let peak = 0
    const f: FetchLike = async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return new Response(FEED)
    }
    await ingestPlayerNews({ db, time: { now: () => new Date() }, fetch: f, sources: [rss('a'), rss('b'), rss('c')] })
    expect(peak).toBe(3)
  })
})

describe('readCapped (R1592)', () => {
  it('refuses a declared length over the cap without reading', async () => {
    const res = new Response('x', { headers: { 'content-length': '6000000' } })
    await expect(readCapped(res)).rejects.toThrow('response too large')
    expect(res.bodyUsed).toBe(false)
  })
  it('cuts off an undeclared stream at the cap', async () => {
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(1024))
      },
    })
    await expect(readCapped(new Response(big), 10_000)).rejects.toThrow('response too large')
  })
  it('reads a body under the cap', async () => {
    expect(await readCapped(new Response('hello'))).toBe('hello')
  })
})

describe('ingestPlayerNews — Bluesky reads back a full day', () => {
  const src: BlueskySource = { kind: 'bluesky', key: 'bsky:r.test', label: 'R', handle: 'r.test' }
  const NOW = new Date('2026-10-18T21:00:00Z')
  const post = (n: number, hoursAgo: number) => ({
    post: {
      uri: `at://did:plc:r/app.bsky.feed.post/p${n}`,
      author: { handle: 'r.test' },
      record: { text: `Jordan Love note ${n}`, createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString() },
    },
  })
  const run = async (pages: Array<{ feed: unknown[]; cursor?: string }>) => {
    const urls: string[] = []
    const f: FetchLike = async (url) => {
      urls.push(url)
      return new Response(JSON.stringify(pages[urls.length - 1] ?? { feed: [] }))
    }
    const report = await ingestPlayerNews({ db: stubDb().db, time: { now: () => NOW }, fetch: f, sources: [src] })
    return { urls, report }
  }

  it('asks for 100 a page and follows the cursor until a page reaches past 26 h', async () => {
    const { urls, report } = await run([
      { feed: [post(1, 1), post(2, 10)], cursor: 'c1' },
      { feed: [post(3, 20), post(4, 25)], cursor: 'c2' },
      { feed: [post(5, 25.5), post(6, 30)], cursor: 'c3' },
      { feed: [post(7, 40)], cursor: 'c4' },
    ])
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain('limit=100')
    expect(urls[0]).not.toContain('cursor=')
    expect(urls[1]).toContain('cursor=c1')
    expect(urls[2]).toContain('cursor=c2')
    expect(report.sources[0].fetched).toBe(6)
  })

  it('stops when the feed has no cursor', async () => {
    const { urls } = await run([{ feed: [post(1, 1)] }])
    expect(urls).toHaveLength(1)
  })

  it('never reads more than 5 pages', async () => {
    const pages = Array.from({ length: 9 }, (_, i) => ({ feed: [post(i, 1)], cursor: `c${i}` }))
    const { urls } = await run(pages)
    expect(urls).toHaveLength(5)
  })
})
