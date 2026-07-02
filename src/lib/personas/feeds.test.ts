import { describe, expect, it } from 'vitest'

import {
  contentHash,
  listingHash,
  newestPublishedAt,
  parseFeed,
  selectNewItems,
  type FeedItem,
} from './feeds'

const RSS_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Fantasy Takes</title>
    <item>
      <title>Week 1 &amp; the RB dead zone</title>
      <link>https://example.com/posts/rb-dead-zone</link>
      <guid isPermaLink="false">post-102</guid>
      <pubDate>Tue, 30 Jun 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>The <b>RB dead zone</b> is real &amp; spectacular.</p>]]></description>
    </item>
    <item>
      <title>Sleepers I love</title>
      <link>https://example.com/posts/sleepers</link>
      <guid isPermaLink="false">post-101</guid>
      <pubDate>Mon, 22 Jun 2026 09:30:00 GMT</pubDate>
      <description>Five sleepers with league-winning upside.</description>
    </item>
  </channel>
</rss>`

// Shape mirrors a real YouTube channel feed (Atom + media extensions).
const YOUTUBE_ATOM_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <title>Fantasy Channel</title>
  <entry>
    <id>yt:video:abc123XYZ</id>
    <title>Top 10 WRs for 2026</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=abc123XYZ"/>
    <published>2026-06-28T15:00:00+00:00</published>
    <updated>2026-06-29T01:00:00+00:00</updated>
    <media:group>
      <media:title>Top 10 WRs for 2026</media:title>
      <media:description>My updated WR rankings. Chase stays №1.</media:description>
    </media:group>
  </entry>
</feed>`

describe('parseFeed', () => {
  it('parses RSS 2.0 items with entities and CDATA html stripped', () => {
    const items = parseFeed(RSS_FIXTURE)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      id: 'post-102',
      title: 'Week 1 & the RB dead zone',
      url: 'https://example.com/posts/rb-dead-zone',
    })
    expect(items[0].published_at).toBe('2026-06-30T12:00:00.000Z')
    expect(items[0].summary).toBe('The RB dead zone is real & spectacular.')
  })

  it('parses YouTube Atom entries including media:description', () => {
    const items = parseFeed(YOUTUBE_ATOM_FIXTURE)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'yt:video:abc123XYZ',
      title: 'Top 10 WRs for 2026',
      url: 'https://www.youtube.com/watch?v=abc123XYZ',
      published_at: '2026-06-28T15:00:00.000Z',
    })
    expect(items[0].summary).toContain('WR rankings')
  })

  it('returns [] for junk instead of throwing', () => {
    expect(parseFeed('not xml at all')).toEqual([])
    expect(parseFeed('<html><body>a web page</body></html>')).toEqual([])
  })
})

describe('change gate', () => {
  const items = parseFeed(RSS_FIXTURE)

  it('selects nothing strictly older than the watermark — the zero-paid-calls invariant (boundary items are re-selected and deduped before any paid call)', () => {
    // Past the newest item: nothing selected at all.
    expect(selectNewItems(items, '2026-07-01T00:00:00.000Z', 10)).toEqual([])
    // AT the newest item's timestamp: the boundary item is re-selected
    // (at-least-once); the contentHash dedupe skips it before extraction.
    expect(
      selectNewItems(items, '2026-06-30T12:00:00.000Z', 10).map((i) => i.id),
    ).toEqual(['post-102'])
  })

  it('selects items at or after the cutoff', () => {
    const fresh = selectNewItems(items, '2026-06-25T00:00:00.000Z', 10)
    expect(fresh.map((i) => i.id)).toEqual(['post-102'])
  })

  it('selects everything on first ingest, OLDEST first so the watermark drains a backlog chronologically', () => {
    const all = selectNewItems(items, null, 10)
    expect(all.map((i) => i.id)).toEqual(['post-101', 'post-102'])
    // Capping keeps the OLDEST — newer items stay above the watermark for
    // the next run instead of being skipped forever.
    expect(selectNewItems(items, null, 1).map((i) => i.id)).toEqual(['post-101'])
  })

  it('items sharing the boundary timestamp are not lost', () => {
    const twins: FeedItem[] = [
      { id: 'a', title: 't', url: 'u', published_at: '2026-06-30T12:00:00.000Z', summary: '' },
      { id: 'b', title: 't', url: 'u', published_at: '2026-06-30T12:00:00.000Z', summary: '' },
    ]
    expect(selectNewItems(twins, '2026-06-30T12:00:00.000Z', 10)).toHaveLength(2)
  })

  it('never re-selects undated items once a watermark exists (listing hash gates undated feeds)', () => {
    const undated: FeedItem[] = [
      { id: 'x', title: 't', url: 'u', published_at: null, summary: '' },
    ]
    expect(selectNewItems(undated, '2026-01-01T00:00:00.000Z', 10)).toEqual([])
    expect(selectNewItems(undated, null, 10)).toHaveLength(1)
  })

  it('listingHash changes only when the item set changes', () => {
    const a = listingHash(items)
    expect(listingHash(items)).toBe(a)
    expect(listingHash(items.slice(0, 1))).not.toBe(a)
  })

  it('newestPublishedAt returns the max timestamp', () => {
    expect(newestPublishedAt(items)).toBe('2026-06-30T12:00:00.000Z')
    expect(newestPublishedAt([])).toBeNull()
  })

  it('contentHash is stable per (source, item) and distinct across items', () => {
    expect(contentHash('https://f.example/rss', 'post-101')).toBe(
      contentHash('https://f.example/rss', 'post-101'),
    )
    expect(contentHash('https://f.example/rss', 'post-101')).not.toBe(
      contentHash('https://f.example/rss', 'post-102'),
    )
  })
})
