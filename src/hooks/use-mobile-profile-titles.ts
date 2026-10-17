'use client'

import { useQuery } from '@tanstack/react-query'

import { countTitles } from '@/components/mobile/profile/profile-ops'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { createBrowserClient } from '@/lib/supabase/client'

/**
 * Profile's "Titles" stat: how many of the user's leagues crowned the team
 * they manage (`leagues.champion_team_id`, readable by members under RLS,
 * against `my_team_id` from GET /api/leagues). Waits for the leagues list;
 * pass `enabled: false` while leagues are gated off.
 */
export function useMobileProfileTitles(leagues: MyLeagueRow[] | undefined, enabled: boolean) {
  const managed = (leagues ?? []).filter((l) => l.my_team_id !== null)
  const ids = managed.map((l) => l.id).sort()

  return useQuery({
    queryKey: ['mobile-profile', 'titles', ids, managed.map((l) => l.my_team_id)],
    enabled: enabled && leagues !== undefined,
    queryFn: async (): Promise<number> => {
      if (ids.length === 0) return 0
      const supabase = createBrowserClient()
      const { data, error } = await supabase
        .from('leagues')
        .select('id, champion_team_id')
        .in('id', ids)
        .not('champion_team_id', 'is', null)
      if (error) throw error
      return countTitles(managed, data ?? [])
    },
  })
}
