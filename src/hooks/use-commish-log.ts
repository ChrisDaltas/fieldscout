'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

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
 * encoded so half a boundary cannot be sent). M6 L.E1.32 (D455): an
 * infinite query with `fetchNextPage`, filterable by `type` / `team_id` /
 * `week` — each filter the server's (the header of `commish-log-service.ts`
 * says what each one matches). Every `use-commish-*.ts` mutation hook (the
 * score / result / lineup / move / add-drop five since L.E1.32 R1360) and the
 * trade / claim hooks invalidate `commishLogKeys.all` on success AND on
 * error (R822(i)), so a landed override re-reads the log without a realtime
 * subscription; the league room's `league_chat` system post reaches the
 * activity feed through its own channel. The draft-room, membership / invite
 * and settings hooks write receipts (168 / 169) but do not re-read the log
 * yet (F535(d)).
 */

export interface CommishLogFilters {
  limit?: number
  /** L.E1.32: only these `action_type`s. */
  type?: readonly string[]
  /** L.E1.32: only rows that name this team (acting for it, targeting it,
   *  or listing it among the affected teams). */
  team_id?: string
  /** L.E1.32: only rows whose verb recorded acting on this week. */
  week?: number
}

export const commishLogKeys = {
  /** Everything for one league — the invalidation target. */
  all: (leagueId: string) => ['commish-log', leagueId] as const,
  /** One filtered log with all its loaded pages (L.E1.32: an infinite query
   *  — the cursor is the page param, never part of the key). */
  list: (leagueId: string, filters: CommishLogFilters) =>
    [
      'commish-log',
      leagueId,
      'list',
      {
        limit: filters.limit,
        type: filters.type && filters.type.length > 0 ? filters.type.join(',') : undefined,
        team_id: filters.team_id,
        week: filters.week,
      },
    ] as const,
}

/** Only the params that are SET reach the query string; `cursor` is the
 *  page param (the previous page's `next_cursor`). */
export function commishLogSearchParams(filters: CommishLogFilters & { cursor?: string }): string {
  const params = new URLSearchParams()
  if (filters.limit !== undefined) params.set('limit', String(filters.limit))
  if (filters.cursor) params.set('cursor', filters.cursor)
  if (filters.type && filters.type.length > 0) params.set('type', filters.type.join(','))
  if (filters.team_id) params.set('team_id', filters.team_id)
  if (filters.week !== undefined) params.set('week', String(filters.week))
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** The next page's cursor, or `undefined` when the server says the log is
 *  done (`has_more` false) — exported for its pins. */
export function commishLogNextCursor(last: CommishLogPage): string | undefined {
  return last.has_more && last.next_cursor ? last.next_cursor : undefined
}

/**
 * The log, newest first, one page at a time: `data.pages[0]` is the newest
 * page (League Home reads only that); `fetchNextPage()` asks for the next
 * with the SAME filters and the last page's `next_cursor`; `hasNextPage` is
 * the server's `has_more`. Changing a filter is a different key — a fresh
 * log from the top, never a filtered page glued onto an unfiltered one.
 */
export function useCommishLog(leagueId: string | undefined, filters: CommishLogFilters = {}) {
  return useInfiniteQuery({
    queryKey: commishLogKeys.list(leagueId ?? 'none', filters),
    enabled: Boolean(leagueId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: commishLogNextCursor,
    queryFn: ({ pageParam }) =>
      sendLeagueAction<CommishLogPage>(
        `/api/leagues/${leagueId!}/commish/log${commishLogSearchParams({ ...filters, cursor: pageParam })}`,
      ),
  })
}
