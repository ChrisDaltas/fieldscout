import { createHash } from 'node:crypto'

import { XMLParser } from 'fast-xml-parser'

/**
 * RSS + YouTube (Atom) feed layer for persona content ingestion
 * (spec-ai-content-engine.md, Slice B). Plain fetch of feed XML — no
 * scraping service, per the 2026-07-02 decision. Feeds are UNTRUSTED
 * input: parsed structurally here, and their text is only ever handed to
 * the constrained Haiku extraction call as data.
 */

export interface FeedItem {
  /** Stable per-item id: guid (RSS) / id (Atom), falling back to the link. */
  id: string
  title: string
  url: string
  /** ISO timestamp when the feed provides one. */
  published_at: string | null
  /** Item text (description / media:description), HTML-stripped + capped. */
  summary: string
}

const MAX_SUMMARY_CHARS = 4000

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Feeds mix single/multiple items; normalize the entry containers to arrays.
  isArray: (name) => name === 'item' || name === 'entry',
})

function stripHtml(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  // fast-xml-parser wraps mixed content as { '#text': ... }
  if (value && typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return text((value as Record<string, unknown>)['#text'])
  }
  return ''
}

function toIso(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Atom <link> can be one object or an array; prefer rel="alternate". */
function atomLink(link: unknown): string {
  const links = Array.isArray(link) ? link : [link]
  const objs = links.filter(
    (l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object',
  )
  const alternate = objs.find((l) => l['@_rel'] === 'alternate' || !l['@_rel'])
  return text(alternate?.['@_href']) || text(objs[0]?.['@_href'])
}

/**
 * Parse RSS 2.0 (<rss><channel><item>) or Atom (<feed><entry> — what YouTube
 * serves) into normalized items, newest-first as feeds conventionally are.
 * Unparseable feeds return [] rather than throwing — the caller treats an
 * empty result as "nothing new".
 */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml) as Record<string, unknown>
  } catch {
    return []
  }

  const rss = doc.rss as Record<string, unknown> | undefined
  const channel = rss?.channel as Record<string, unknown> | undefined
  if (channel?.item) {
    return (channel.item as Record<string, unknown>[])
      .map((item) => {
        const link = text(item.link)
        // Guid-less feeds fall back to the link with query params stripped —
        // rotating tracking params would otherwise make every item look new
        // daily and defeat dedupe (a paid-extraction leak).
        const guid = text(item.guid) || link.split('?')[0] || link
        return {
          id: guid,
          title: stripHtml(text(item.title)),
          url: link,
          published_at: toIso(text(item.pubDate) || text(item['dc:date'])),
          summary: stripHtml(
            [text(item.description), text(item['content:encoded'])]
              .filter(Boolean)
              .join(' '),
          ).slice(0, MAX_SUMMARY_CHARS),
        }
      })
      .filter((item) => item.id)
  }

  const feed = doc.feed as Record<string, unknown> | undefined
  if (feed?.entry) {
    return (feed.entry as Record<string, unknown>[])
      .map((entry) => {
        const media = entry['media:group'] as Record<string, unknown> | undefined
        return {
          id: text(entry.id) || atomLink(entry.link),
          title: stripHtml(text(entry.title)),
          url: atomLink(entry.link),
          published_at: toIso(text(entry.published) || text(entry.updated)),
          summary: stripHtml(
            [
              text(entry.summary),
              text(entry.content),
              text(media?.['media:description']),
            ]
              .filter(Boolean)
              .join(' '),
          ).slice(0, MAX_SUMMARY_CHARS),
        }
      })
      .filter((item) => item.id)
  }

  return []
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_FEED_BYTES = 5_000_000

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: {
      'user-agent': 'FieldScoutBot/0.1 (+https://fieldscout.gg)',
      accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    // One hung feed must not starve the whole cron run.
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Feed fetch failed (${res.status}) for ${url}`)
  const xml = await res.text()
  if (xml.length > MAX_FEED_BYTES) return []
  return parseFeed(xml)
}

// ============================================================================
// Change-gate helpers (pure — unit-tested so the "quiet day costs zero paid
// calls" invariant is enforced in CI, per plan §9).
// ============================================================================

/** Hash of the feed's item ids — the listing-changed fallback when a feed
 * carries no usable dates. */
export function listingHash(items: FeedItem[]): string {
  return createHash('sha256')
    .update(items.map((i) => i.id).join('\n'))
    .digest('hex')
}

/** Dedupe key for one content item within a persona. */
export function contentHash(sourceUrl: string, itemId: string): string {
  return createHash('sha256').update(`${sourceUrl}\n${itemId}`).digest('hex')
}

/**
 * The change gate: candidate items AT or after the high-water mark, OLDEST
 * FIRST, capped.
 *
 * Semantics chosen so nothing is ever silently lost (review-hardened):
 * - `>=` (not `>`): items sharing the boundary timestamp are re-selected;
 *   the cheap contentHash dedupe check skips already-processed ones BEFORE
 *   any paid call. At-least-once selection + idempotent processing.
 * - Oldest-first + cap: a backlog drains chronologically across runs — the
 *   watermark (advanced only through processed items by the caller) never
 *   jumps past unprocessed newer items.
 * - Undated items are candidates only on first ingest (no watermark yet);
 *   afterwards the caller's listing-hash gate handles undated feeds.
 */
export function selectNewItems(
  items: FeedItem[],
  lastItemPublishedAt: string | null,
  maxItems: number,
): FeedItem[] {
  const cutoff = lastItemPublishedAt ? new Date(lastItemPublishedAt).getTime() : null
  const fresh = items.filter((item) => {
    if (cutoff === null) return true
    if (!item.published_at) return false
    return new Date(item.published_at).getTime() >= cutoff
  })
  return fresh
    .sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0
      return ta - tb
    })
    .slice(0, maxItems)
}

/** Newest published_at across items — the next high-water mark. */
export function newestPublishedAt(items: FeedItem[]): string | null {
  let newest: string | null = null
  for (const item of items) {
    if (!item.published_at) continue
    if (!newest || item.published_at > newest) newest = item.published_at
  }
  return newest
}
