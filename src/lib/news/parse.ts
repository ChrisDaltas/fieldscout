import { parseFeed } from '@/lib/personas/feeds'

import type { BlueskySource, RssSource } from './sources'

/**
 * One story as stored (F575, D550). Plain text only: the headline is the
 * feed's own title (HTML-stripped by the persona parser, then re-checked
 * here), `match_text` = headline + the feed's own description, used only for
 * matching and never stored or shown. No article page is ever fetched.
 */
export interface NewsItem {
  source_key: string
  source_label: string
  external_id: string
  url: string
  headline: string
  published_at: string | null
  match_text: string
}

export const MAX_HEADLINE = 300
/** How much of the feed's description joins the headline for matching. */
export const MATCH_LEDE = 240

/** Plain text: no tags, no control characters, collapsed whitespace, capped. */
export function plainText(input: string, cap = MAX_HEADLINE): string {
  const s = input
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    // eslint-disable-next-line no-control-regex -- strip control characters from untrusted text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > cap ? `${s.slice(0, cap - 1).trimEnd()}…` : s
}

/** Only an absolute http(s) link is ever stored (no javascript:, data:, …). */
export function safeUrl(input: string): string | null {
  try {
    const u = new URL(input.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function parseRss(xml: string, source: RssSource): NewsItem[] {
  const out: NewsItem[] = []
  for (const item of parseFeed(xml)) {
    const url = safeUrl(item.url)
    const headline = plainText(item.title)
    if (!url || !headline) continue
    out.push({
      source_key: source.key,
      source_label: source.label,
      external_id: item.id.slice(0, 500),
      url,
      headline,
      published_at: item.published_at,
      // Headline + the lede only: full recap bodies name every player in the
      // game, and a story is "his" news only when he is the subject.
      match_text: `${headline} ${plainText(item.summary, MATCH_LEDE)}`,
    })
  }
  return out
}

interface BskyFeedEntry {
  post?: {
    uri?: unknown
    author?: { handle?: unknown }
    record?: { text?: unknown; createdAt?: unknown }
  }
  reason?: unknown
}

/** `app.bsky.feed.getAuthorFeed` JSON → items. Reposts (an entry with a
 *  `reason`) and posts by anyone but the reporter are skipped; the link out
 *  is the post on bsky.app. */
export function parseBluesky(json: unknown, source: BlueskySource): NewsItem[] {
  const feed = (json as { feed?: unknown } | null)?.feed
  if (!Array.isArray(feed)) return []
  const out: NewsItem[] = []
  for (const entry of feed as BskyFeedEntry[]) {
    if (entry.reason) continue
    const post = entry.post
    if (!post || post.author?.handle !== source.handle) continue
    const uri = typeof post.uri === 'string' ? post.uri : ''
    const rkey = uri.match(/\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]+)$/)?.[1]
    const text = typeof post.record?.text === 'string' ? post.record.text : ''
    const headline = plainText(text)
    if (!rkey || !headline) continue
    const created = typeof post.record?.createdAt === 'string' ? new Date(post.record.createdAt) : null
    out.push({
      source_key: source.key,
      source_label: source.label,
      external_id: uri,
      url: `https://bsky.app/profile/${source.handle}/post/${rkey}`,
      headline,
      published_at: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
      match_text: plainText(text, 2000),
    })
  }
  return out
}
