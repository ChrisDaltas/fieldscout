/** The News section's wire shape (F575, D550). */
export interface PlayerNewsItem {
  id: string
  headline: string
  source: string
  url: string
  published_at: string
}

export interface PlayerNewsPage {
  items: PlayerNewsItem[]
  nextPage: number | null
}

export const NEWS_PAGE_SIZE = 10

/** "5m ago" / "3h ago" / "2d ago" / "Oct 4" — `now` injected (no raw clock). */
export function newsAge(publishedAt: string, now: Date): string {
  const t = Date.parse(publishedAt)
  if (Number.isNaN(t)) return ''
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000))
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
}

/** The link out, only when it is http(s) (defence in depth over the DB CHECK). */
export function outboundHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}
