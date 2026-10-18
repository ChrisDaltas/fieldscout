'use client'

import { useQuery } from '@tanstack/react-query'

import { createBrowserClient } from '@/lib/supabase/client'
import { pageAll } from '@/lib/supabase/page-all'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * FieldScout Mobile — Import a ranking (gap list §3 #5): who is on each of
 * the user's other lists — ids, positions and tiers only — so each option in
 * the sheet can say how many players it would really bring in, and an
 * option that would bring in nobody can't be tapped ("prevent, don't
 * refuse"). The import itself reads the chosen list in full
 * (`/api/lists/[id]`, which carries the season figures the rows show).
 *
 * One paged read for every list (RLS: the owner reads their own rows), with
 * an exact count: a set of lists can pass PostgREST's 1000-row cap, and a
 * short page must never pass for "that's everyone" (CLAUDE.md).
 */

export interface ImportListPlayer {
  player_id: string
  position: string | null
  tier: string | null
}

interface Row {
  id: string
  list_id: string
  player_id: string
  position: number
  tier: string | null
  player: { position: string | null } | Array<{ position: string | null }> | null
}

export function useMobileListsImportPlayers(listIds: readonly string[], enabled: boolean) {
  const ids = [...listIds].sort()
  return useQuery({
    queryKey: ['mobile-lists', 'import-players', ids.join(',')] as const,
    enabled: enabled && ids.length > 0,
    queryFn: async (): Promise<Map<string, ImportListPlayer[]>> => {
      const supabase = createBrowserClient()
      const rows = await pageAll<Row>((from, to) =>
        supabase
          .from('list_players')
          .select('id, list_id, player_id, position, tier, player:players(position)', { count: 'exact' })
          .in('list_id', ids)
          .order('list_id', { ascending: true })
          .order('position', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: Row[] | null
          error: { message: string } | null
          count?: number | null
        }>,
      )
      const byList = new Map<string, ImportListPlayer[]>(ids.map((id) => [id, []]))
      for (const row of rows) {
        byList.get(row.list_id)?.push({
          player_id: row.player_id,
          position: firstEmbed(row.player)?.position ?? null,
          tier: row.tier,
        })
      }
      return byList
    },
  })
}
