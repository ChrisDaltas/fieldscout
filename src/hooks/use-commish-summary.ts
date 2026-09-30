'use client'

import { useQuery } from '@tanstack/react-query'

import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { CommishSummary } from '@/lib/leagues/api/commish-summary-service'

import { commishLogKeys } from './use-commish-log'

/**
 * What needs the commissioner now — M6 task L.E1.32 (spec §10.1 / §16.2;
 * PROGRESS D443, D455). `GET /api/leagues/[id]/commish/summary`,
 * commissioners only. The console (L.E1.33) renders it; it never computes a
 * section itself — each is the server's, and a section the database cannot
 * answer yet arrives as `{ state: 'unavailable', missing, message }` (say
 * the message; never render it as "nothing needs you").
 *
 * THE KEY LIVES UNDER THE AUDIT LOG'S ROOT on purpose: every `use-commish-*`
 * mutation hook (and the trade / claim hooks' commissioner arms) invalidates
 * `commishLogKeys.all` on success AND on error (R822(i); the last five since
 * R1360), and each can change what needs him (a seat put on autopilot, a
 * trade approved, a score corrected) — so the list re-reads after each
 * without a second invalidation list to keep in step. Since L.E1.33 the
 * draft-room, membership / invite, settings and `set_lineup` hooks — which
 * write receipts too (168 / 169) — re-read the same root through
 * `invalidateCommishLog` (F535(d), pinned per hook).
 *
 * Games finish, managers accept trades and seats empty on their own clock,
 * so the read also re-polls once a minute — until it is refused (a 403 is
 * an answer, not a blip: no retry, and the poll stops, R1363). `enabled`
 * lets the console mount it for commissioners only. Reads only.
 */
export const commishSummaryKeys = {
  one: (leagueId: string) => [...commishLogKeys.all(leagueId), 'summary'] as const,
}

/** How often the list re-reads itself (the matchup lock's cadence). */
export const COMMISH_SUMMARY_REPOLL_MS = 60_000

/** Poll each minute while the read answers; stop once it has been refused
 *  (a manager's 403 will not turn into a yes by asking again). Exported for
 *  its pin. */
export function commishSummaryRefetchInterval(query: { state: { error: unknown } }): number | false {
  return query.state.error ? false : COMMISH_SUMMARY_REPOLL_MS
}

export function useCommishSummary(leagueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: commishSummaryKeys.one(leagueId ?? 'none'),
    enabled: Boolean(leagueId) && enabled,
    retry: false,
    refetchInterval: commishSummaryRefetchInterval,
    queryFn: () => sendLeagueAction<CommishSummary>(`/api/leagues/${leagueId!}/commish/summary`),
  })
}
