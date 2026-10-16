/**
 * A YouTube video's real title, from YouTube's OFFICIAL oEmbed endpoint
 * (Chris, 2026-10-15, mobile gap list #11: "look the title up through
 * YouTube's official title service (not scraping)").
 *
 *   GET https://www.youtube.com/oembed?url=<watch url>&format=json
 *
 * No API key, one plain server-side `fetch` of a JSON document YouTube
 * publishes for exactly this — within the standing "RSS + YouTube only, no
 * scraping service" rule (CLAUDE.md / memory). Nothing else on the page is
 * read.
 *
 * ## Never the reason an attach fails
 *
 * The lookup is a nicety on top of attaching a video, so every failure —
 * not a YouTube link, a non-200 (private, deleted or embed-disabled videos
 * answer 401/403/404), a timeout, a network error, a body that is not the
 * documented shape — resolves to `{ title: null, reason }` rather than
 * throwing. The REASON is kept (CLAUDE.md: "nothing happened" must carry
 * its why) so the caller can log it instead of silently falling back.
 *
 * Only the video id leaves the server: the request names the canonical
 * `https://www.youtube.com/watch?v=<id>`, never the user's raw URL.
 */
import { z } from 'zod'

import { youTubeId, youTubeWatchUrl } from '@/utils/youtube'

export const YOUTUBE_OEMBED_ENDPOINT = 'https://www.youtube.com/oembed'

/** How long an attach waits for YouTube before giving up on the title. */
export const YOUTUBE_TITLE_TIMEOUT_MS = 3000

/** 080's `list_links_title_check` ceiling (code points, after trimming). */
export const MAX_LINK_TITLE_LENGTH = 200

/** The documented oEmbed response — only `title` is used. */
const oembedSchema = z.object({ title: z.string() })

export type YouTubeTitleFailure = 'not-youtube' | 'http-error' | 'timeout' | 'network' | 'bad-response'

export type YouTubeTitleResult =
  | { title: string; reason: null }
  | { title: null; reason: YouTubeTitleFailure; detail?: string }

export interface YouTubeTitleOptions {
  /** Injected in tests; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/**
 * A title as the database will hold it: whitespace collapsed, trimmed, and
 * cut to 080's 200-character ceiling (by code point, as Postgres counts) so
 * a long title can never turn a successful lookup into a 23514.
 */
export function cleanVideoTitle(raw: string): string | null {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) return null
  const points = Array.from(collapsed)
  if (points.length <= MAX_LINK_TITLE_LENGTH) return collapsed
  return `${points.slice(0, MAX_LINK_TITLE_LENGTH - 1).join('').trimEnd()}…`
}

/** `AbortSignal.timeout` rejects with a `TimeoutError` DOMException. */
function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

export async function lookUpYouTubeTitle(
  url: string,
  { fetchImpl = fetch, timeoutMs = YOUTUBE_TITLE_TIMEOUT_MS }: YouTubeTitleOptions = {},
): Promise<YouTubeTitleResult> {
  const id = youTubeId(url)
  if (!id) return { title: null, reason: 'not-youtube' }

  const query = new URLSearchParams({ url: youTubeWatchUrl(id), format: 'json' })
  let response: Response
  try {
    response = await fetchImpl(`${YOUTUBE_OEMBED_ENDPOINT}?${query.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
  } catch (error) {
    if (isTimeout(error)) return { title: null, reason: 'timeout', detail: `no answer within ${timeoutMs}ms` }
    return { title: null, reason: 'network', detail: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    return { title: null, reason: 'http-error', detail: `HTTP ${response.status}` }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    // The timeout can also land mid-body.
    if (isTimeout(error)) return { title: null, reason: 'timeout', detail: `no answer within ${timeoutMs}ms` }
    return { title: null, reason: 'bad-response', detail: 'body is not JSON' }
  }

  const parsed = oembedSchema.safeParse(body)
  if (!parsed.success) return { title: null, reason: 'bad-response', detail: 'no string `title`' }

  const title = cleanVideoTitle(parsed.data.title)
  if (!title) return { title: null, reason: 'bad-response', detail: 'empty title' }
  return { title, reason: null }
}
