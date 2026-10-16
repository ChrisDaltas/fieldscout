/**
 * YouTube link helpers — pure, shared by the mobile Lists screens (the link
 * input, covers, thumbnails) and the server's attach route (the oEmbed title
 * lookup, `lib/lists/youtube-title.ts`), so both agree on what a YouTube
 * video link is.
 */

const YT_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i

/**
 * The 11-character video id of a YouTube link, or null. The design's regex
 * (`youtu.be/`, `?v=`/`&v=`, `/shorts/`, `/embed/`), tightened to YouTube's
 * own hosts and widened to `/live/` (lr-lists gap 21).
 */
export function youTubeId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return null
  }
  if (!YT_HOST.test(url.hostname)) return null
  const match = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(url.href)
  return match ? match[1] : null
}

export function youTubeThumb(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}

/** The canonical watch URL for a video id. */
export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`
}

/**
 * What a video with no stored title is CALLED on screen. Display only — the
 * real title comes from YouTube's oEmbed at attach time.
 */
export const VIDEO_TITLE_FALLBACK = 'YouTube video'
