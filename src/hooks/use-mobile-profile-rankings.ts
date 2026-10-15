'use client'

import { useQuery } from '@tanstack/react-query'

import type { RankingBoardRow } from '@/components/mobile/profile/profile-ops'
import { createBrowserClient } from '@/lib/supabase/client'

/** Same season the weekly-ranks API files boards under. */
const SEASON = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

interface WeeklyRow {
  week_number: number
  list: { id: string; updated_at: string | null; deleted_at: string | null } | Array<{
    id: string
    updated_at: string | null
    deleted_at: string | null
  }> | null
}

interface SeasonBoardRow {
  id: string
  updated_at: string | null
}

/**
 * The signed-in user's saved ranking boards for Profile › My stuff ›
 * Rankings: every weekly board this season (`big_board_weekly`, owner-only
 * under RLS) plus the pre-draft big board. Read-only — it never creates a
 * board the way opening a week on /app/weekly-ranks does.
 */
export function useMobileProfileRankings(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['mobile-profile', 'rankings', userId ?? 'anon', SEASON],
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<RankingBoardRow[]> => {
      const supabase = createBrowserClient()
      const [weekly, season] = await Promise.all([
        supabase
          .from('big_board_weekly')
          .select('week_number, list:lists(id, updated_at, deleted_at)')
          .eq('user_id', userId!)
          .eq('season', SEASON),
        supabase
          .from('lists')
          .select('id, updated_at')
          .eq('owner_id', userId!)
          .eq('is_big_board', true)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(1),
      ])
      if (weekly.error) throw weekly.error
      if (season.error) throw season.error

      const rows: RankingBoardRow[] = []
      for (const r of (weekly.data ?? []) as WeeklyRow[]) {
        const list = Array.isArray(r.list) ? (r.list[0] ?? null) : r.list
        if (!list || list.deleted_at) continue
        rows.push({ listId: list.id, week: r.week_number, updatedAt: list.updated_at })
      }
      const board = ((season.data ?? []) as SeasonBoardRow[])[0]
      if (board) rows.push({ listId: board.id, week: null, updatedAt: board.updated_at })
      return rows
    },
  })
}
