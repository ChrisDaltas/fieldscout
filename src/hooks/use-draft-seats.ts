'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Seat NAMES for a draft, read off the draft's own `draft_order` — MP task
 * MP.8 (spec v2.16 §8.8; D230).
 *
 * The report has to print *what team a player went to*, and it serves BOTH
 * kinds of mock: a standalone one, whose seats are the bot `teams` rows the
 * launch minted (D227), and a league-attached one reached through the legacy
 * recap redirect (D230(4)), whose seats are the league's franchises. One
 * read answers both, because `teams` is the same table in both worlds and
 * `draft_order` is the same column.
 *
 * **Why not `useMockRoomContext`.** That hook is the standalone ROOM's
 * context, and its `.is('league_id', null)` filter is deliberate — the belt
 * that stops a league-attached mock resolving through the standalone mount
 * (its own docblock says so). The report cannot inherit that filter, because
 * the legacy `?draft=<mock_id>` redirect lands league-attached mocks here.
 * So this asks the one narrow question the report needs — names for these
 * ids — and asks nothing else.
 *
 * **Reads, not routes** (D92): RLS scopes it. A standalone mock's seats are
 * the launcher's; a league mock's are its members'. A caller who cannot see
 * a seat gets no row for it, and `namesById` simply has no entry — the
 * report falls back to "Team" rather than rendering an empty cell, and the
 * `missing` count says so out loud rather than letting a short read read as
 * a complete one (CLAUDE.md: "nothing happened" must never mean "it worked").
 */

export const draftSeatKeys = {
  names: (ids: readonly string[]) => ['draft-seat-names', [...ids].sort().join(',')] as const,
}

export interface DraftSeatNames {
  namesById: ReadonlyMap<string, string>
  /** How many requested ids came back with no row (0 on a healthy draft). */
  missing: number
}

export function useDraftSeatNames(teamIds: readonly string[] | undefined) {
  const ids = teamIds ?? []
  return useQuery({
    queryKey: draftSeatKeys.names(ids),
    enabled: ids.length > 0,
    queryFn: async (): Promise<DraftSeatNames> => {
      const supabase = createBrowserClient()
      const { data, error } = await supabase.from('teams').select('id, name').in('id', ids)
      if (error) throw error
      const namesById = new Map((data ?? []).map((row) => [row.id, row.name]))
      return { namesById, missing: ids.filter((id) => !namesById.has(id)).length }
    },
    staleTime: 5 * 60 * 1000,
  })
}
