'use client'

import { useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishLogPage } from '@/lib/leagues/api/commish-log-service'

/**
 * The §10.3 commissioner audit log READ — M6A task L.E1.11 (spec
 * §15.4:1703, *"any member can read"*; §12.12; PROGRESS D351).
 * `GET /api/leagues/[id]/commish/log`.
 *
 * THIS IS WHAT L.E1.13's LEAGUE HOME ACTIVITY SECTION READS (Q66, spec
 * v2.16.41 §10.3: every commissioner action is shown there). Each row's
 * `reason` is `string | null` — render the ABSENCE, never the word "null"
 * and never an empty "— reason:" clause. A row is a CLAIM that a
 * commissioner acted, not proof a verb ran (C70 — see the service's header);
 * no rendering may say "applied" from this feed alone.
 *
 * READ ONLY, page by opaque cursor: `next_cursor` from one page is the
 * `cursor` of the next (the composite `(created_at, id)` boundary, R770,
 * encoded so half a boundary cannot be sent). Every commissioner mutation
 * hook (`use-commish-*.ts`) invalidates `commishLogKeys.all` on success AND
 * on error (R822(i)), so a landed override re-reads the log without a
 * realtime subscription; the league room's `league_chat` system post
 * reaches the activity feed through its own channel.
 */

export const commishLogKeys = {
  /** Everything for one league — the invalidation target. */
  all: (leagueId: string) => ['commish-log', leagueId] as const,
  page: (leagueId: string, cursor: string | undefined, limit: number | undefined) =>
    ['commish-log', leagueId, { cursor, limit }] as const,
}

export interface CommishLogFilters {
  limit?: number
  /** The previous page's `next_cursor`; omit for the newest page. */
  cursor?: string
}

/** Only the params that are SET reach the query string. */
export function commishLogSearchParams(filters: CommishLogFilters): string {
  const params = new URLSearchParams()
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.cursor) params.set('cursor', filters.cursor)
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function useCommishLog(leagueId: string | undefined, filters: CommishLogFilters = {}) {
  return useQuery({
    queryKey: commishLogKeys.page(leagueId ?? 'none', filters.cursor, filters.limit),
    enabled: Boolean(leagueId),
    queryFn: () =>
      sendLeagueAction<CommishLogPage>(`/api/leagues/${leagueId!}/commish/log${commishLogSearchParams(filters)}`),
  })
}
