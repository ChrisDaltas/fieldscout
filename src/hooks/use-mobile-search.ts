'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { PoolPlayer } from '@/components/draft/available-players-ops'
import { communitySearchHref } from '@/lib/community/community-search'

/**
 * The phone's full-screen search reads (gap list §3 #1): players from
 * `/api/players/search` (a team code finds that team's players too) and
 * people + public lists from `/api/search/community`. One read of each per
 * term, at the single-scope page size (30); the All scope shows the first
 * few of the same rows, so switching chips never re-fetches.
 *
 * A failed read THROWS (CLAUDE.md: never let a failure look like "no
 * results"); the screen says it couldn't search, with Try again.
 */

export const MOBILE_SEARCH_PAGE = 30

export interface SearchUser {
  id: string
  username: string
  avatar_url: string | null
  follower_count: number
}

export interface SearchList {
  id: string
  title: string
  owner_username: string | null
}

export const mobileSearchKeys = {
  players: (term: string) => ['mobile-search', 'players', term] as const,
  community: (term: string) => ['mobile-search', 'community', term] as const,
}

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${what}: ${res.status}`)
  return (await res.json()) as T
}

/** A handle typed with its "@" ("@chris") finds the person — handles are
 *  stored without it. */
export function communityTerm(term: string): string {
  return term.replace(/^@+/, '').trim()
}

/** `term` is the trimmed query; an empty one reads nothing. */
export function useMobileSearch(term: string) {
  const people = communityTerm(term)
  const params = new URLSearchParams({ q: term, limit: String(MOBILE_SEARCH_PAGE) })

  const players = useQuery({
    queryKey: mobileSearchKeys.players(term),
    enabled: term.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<PoolPlayer[]> => {
      const body = await getJson<{ results?: unknown }>(`/api/players/search?${params}&matchTeam=true`, 'Player search')
      if (!Array.isArray(body.results)) throw new Error('Player search: no results array')
      return body.results as PoolPlayer[]
    },
  })

  const community = useQuery({
    queryKey: mobileSearchKeys.community(people),
    enabled: people.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    queryFn: async (): Promise<{ users: SearchUser[]; lists: SearchList[] }> => {
      const body = await getJson<{ users?: unknown; lists?: unknown }>(communitySearchHref(people, MOBILE_SEARCH_PAGE), 'Community search')
      if (!Array.isArray(body.users) || !Array.isArray(body.lists)) throw new Error('Community search: unexpected answer')
      return { users: body.users as SearchUser[], lists: body.lists as SearchList[] }
    },
  })

  return { players, community }
}
