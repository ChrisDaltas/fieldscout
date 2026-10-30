import { featureFlags } from '@/lib/feature-flags'
import { ranksOn } from '@/lib/rankings/ranks-on'

/**
 * The community search's address (`/api/search/community`) — the phone's
 * search and the desktop command palette both ask it here.
 *
 * While Community is on, the lists it finds are the ones Community shows
 * (plan C3, readiness S9): lists with players, and rankings only while
 * they're switched on (`ranksOn()`). It says so with `show`:
 *  - `lists`: lists with players, no rankings;
 *  - `all`: anything with players, rankings included.
 * While Community is off, no `show` is sent and search finds what it always
 * has — a screen outside Community doesn't change until Community does.
 *
 * The switches are read here, on the screen, and sent along: a route handler
 * never reads a feature flag itself (`flag-free-server-paths` — a flag gates
 * surfaces, never what the server allows).
 */
export const COMMUNITY_SEARCH_SHOW_PARAM = 'show'
export type CommunitySearchShow = 'lists' | 'all'

/** What search should find, or null for "as before Community". */
export function communitySearchShow(): CommunitySearchShow | null {
  if (!featureFlags.community) return null
  return ranksOn() ? 'all' : 'lists'
}

export function communitySearchHref(q: string, limit: number): string {
  const params = new URLSearchParams({ q, limit: String(limit) })
  const show = communitySearchShow()
  if (show) params.set(COMMUNITY_SEARCH_SHOW_PARAM, show)
  return `/api/search/community?${params}`
}
