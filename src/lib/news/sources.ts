/**
 * Player-news sources (F575; Chris's rulings 2026-10-18; PROGRESS D550/D551).
 * FREE sources only, plain fetch, the feed's / API's own fields only — never
 * an article page, never a scraping service, never X/Twitter (paid).
 *
 * Every entry was fetched and checked on 2026-10-18. Dropped then:
 * NFL.com (`/rss/rsslanding` serves an HTML page; `/feeds/rss/news` 404),
 * SI (`/nfl/rss` 404), Bleacher Report (feed 404).
 */

export interface RssSource {
  kind: 'rss'
  key: string
  label: string
  url: string
}

export interface BlueskySource {
  kind: 'bluesky'
  key: string
  /** The reporter's name — the source label on the News tab. */
  label: string
  handle: string
}

export type NewsSource = RssSource | BlueskySource

export const RSS_SOURCES: readonly RssSource[] = [
  { kind: 'rss', key: 'espn', label: 'ESPN', url: 'https://www.espn.com/espn/rss/nfl/news' },
  { kind: 'rss', key: 'cbs', label: 'CBS Sports', url: 'https://www.cbssports.com/rss/headlines/nfl/' },
  { kind: 'rss', key: 'yahoo', label: 'Yahoo Sports', url: 'https://sports.yahoo.com/nfl/rss/' },
  { kind: 'rss', key: 'pft', label: 'ProFootballTalk', url: 'https://profootballtalk.nbcsports.com/feed/' },
  { kind: 'rss', key: 'rotowire', label: 'RotoWire', url: 'https://www.rotowire.com/rss/news.php?sport=NFL' },
]

/**
 * Bluesky reporters verified 2026-10-18 on the public AppView
 * (`app.bsky.feed.getAuthorFeed`, no auth): the account exists, posts NFL
 * news, and posted within the last ~2 weeks. Checked and LEFT OUT as
 * inactive (last post months ago): Adam Schefter, Jordan Schultz, Jay
 * Glazer, James Palmer, Brooke Pryor, Stephen Holder, Cam Inman; Charles
 * Robinson (no posts returned); Jonathan Jones / Ben Standig (last post Aug).
 */
export const BLUESKY_SOURCES: readonly BlueskySource[] = [
  { kind: 'bluesky', key: 'bsky:rapsheet.bsky.social', label: 'Ian Rapoport', handle: 'rapsheet.bsky.social' },
  { kind: 'bluesky', key: 'bsky:rotoworld-fb.bsky.social', label: 'Rotoworld Football', handle: 'rotoworld-fb.bsky.social' },
  { kind: 'bluesky', key: 'bsky:mattlombardo.bsky.social', label: 'Matt Lombardo', handle: 'mattlombardo.bsky.social' },
  { kind: 'bluesky', key: 'bsky:timmcmanus42.bsky.social', label: 'Tim McManus', handle: 'timmcmanus42.bsky.social' },
  { kind: 'bluesky', key: 'bsky:joriepstein.bsky.social', label: 'Jori Epstein', handle: 'joriepstein.bsky.social' },
  { kind: 'bluesky', key: 'bsky:ralphvacchiano.bsky.social', label: 'Ralph Vacchiano', handle: 'ralphvacchiano.bsky.social' },
  { kind: 'bluesky', key: 'bsky:minakimes.bsky.social', label: 'Mina Kimes', handle: 'minakimes.bsky.social' },
]

export const NEWS_SOURCES: readonly NewsSource[] = [...RSS_SOURCES, ...BLUESKY_SOURCES]

export const BLUESKY_APPVIEW = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed'
