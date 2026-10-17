'use client'

import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'

import { hasCurrentRoster, INJURY_STATUSES } from '@/components/mobile/home/home-ops'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { leagueRosterKeys } from '@/hooks/use-rosters'
import { sendLeagueAction } from '@/lib/leagues/api/client-fetch'
import type { LeagueRosters } from '@/lib/leagues/api/rosters-service'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Home's "Injury news" (m-home §2A.11) over the synced injury feed
 * (`players.status` + `injury_*`, Sleeper — migration 034):
 *  - the viewer's own injured players first ("On your roster · {team}",
 *    from this season's rosters — leagues drafting, in season or in the
 *    playoffs, never a finished league's — through the team page's read),
 *  - then the most relevant injured players league-wide (by projection).
 * The feed carries no news timestamp, so the design's "2h" and its newest-
 * first order are not available; rows are ordered mine-first, then by
 * relevance. A roster read that fails is the section's error (with Try
 * again), never a list that silently drops "On your roster".
 *
 * Both layouts read it: the phone's Home (`mobile/home/home-injuries.tsx`)
 * and the desktop Home's "Injury report" card (`home/injury-news-card.tsx`).
 * The cache key doesn't carry `rows`, so every caller asks for the same five.
 */
export interface HomeInjury {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  status: string
  injury_body_part: string | null
  injury_notes: string | null
  practice_participation: string | null
  /** "On your roster" — the user's team names holding this player. */
  myTeams: string[]
}

const COLUMNS =
  'id, full_name, position, team, headshot_url, status, injury_body_part, injury_notes, practice_participation, projected_pts_ppr'

type InjuryRow = Omit<HomeInjury, 'myTeams'> & { projected_pts_ppr: number | null }

export function useMobileHomeInjuries(leagues: readonly MyLeagueRow[], { rows = 5, ready = true }: { rows?: number; ready?: boolean } = {}) {
  const drafted = leagues.filter((l) => l.my_team_id && hasCurrentRoster(l.status))
  const rosters = useQueries({
    queries: drafted.map((l) => ({
      queryKey: leagueRosterKeys.all(l.id),
      queryFn: () => sendLeagueAction<LeagueRosters>(`/api/leagues/${l.id}/rosters`),
    })),
  })
  // `ready`: the caller's league list has settled, so "mine" is known before
  // the first read (no reshuffle when it lands).
  const rostersSettled = ready && rosters.every((r) => !r.isPending)
  // A roster that never loaded would quietly drop that league's "mine" rows
  // (a failed background refresh keeps its last good read).
  const rosterFailed = rosters.some((r) => r.isError && !r.data)

  // player id → the user's team names that roster him.
  const mine = useMemo(() => {
    const map = new Map<string, string[]>()
    drafted.forEach((l, i) => {
      const team = rosters[i]?.data?.teams.find((t) => t.team_id === l.my_team_id)
      for (const p of team?.roster ?? []) map.set(p.player_id, [...(map.get(p.player_id) ?? []), team!.name])
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rosters` is a fresh array each render; its data is the input
  }, [drafted.map((l) => l.id).join(','), rosters.map((r) => r.dataUpdatedAt).join(',')])
  const mineIds = useMemo(() => [...mine.keys()].sort(), [mine])

  const query = useQuery({
    queryKey: ['mobile-home', 'injuries', mineIds.join(',')],
    enabled: rostersSettled && !rosterFailed,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<InjuryRow[]> => {
      const supabase = createBrowserClient()
      const [top, own] = await Promise.all([
        supabase
          .from('players')
          .select(COLUMNS)
          .in('status', [...INJURY_STATUSES])
          .not('team', 'is', null)
          .order('projected_pts_ppr', { ascending: false, nullsFirst: false })
          .limit(rows * 4),
        mineIds.length > 0
          ? supabase.from('players').select(COLUMNS).in('id', mineIds).in('status', [...INJURY_STATUSES])
          : Promise.resolve({ data: [] as InjuryRow[], error: null }),
      ])
      if (top.error) throw top.error
      if (own.error) throw own.error
      const ownRows = [...((own.data ?? []) as InjuryRow[])].sort(
        (a, b) => (b.projected_pts_ppr ?? -1) - (a.projected_pts_ppr ?? -1),
      )
      const seen = new Set<string>()
      const out: InjuryRow[] = []
      for (const p of [...ownRows, ...((top.data ?? []) as InjuryRow[])]) {
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push(p)
      }
      return out
    },
  })

  const items = useMemo<HomeInjury[]>(
    () => (query.data ?? []).slice(0, rows).map((p) => ({ ...p, myTeams: mine.get(p.id) ?? [] })),
    [query.data, mine, rows],
  )
  const refetch = () => {
    for (const r of rosters) if (r.isError && !r.data) void r.refetch()
    if (query.isError) void query.refetch()
  }
  return {
    items,
    isPending: !rostersSettled || (!rosterFailed && query.isPending),
    isError: rosterFailed || query.isError,
    refetch,
  }
}
