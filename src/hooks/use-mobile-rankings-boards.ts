'use client'

import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/hooks/use-auth'
import { listsKeys, type ListPlayerWithPlayer } from '@/hooks/use-lists'
import { isScoringFormat, type ScoringFormat } from '@/lib/lists/ranking-publish'
import { pageAll } from '@/lib/supabase/page-all'
import { createBrowserClient } from '@/lib/supabase/client'
import type { List } from '@/types/database'
import { firstEmbed } from '@/utils/supabase-embed'

/**
 * The signed-in user's ranking boards for the mobile My rankings screen:
 * the season board (the big board) and every weekly board that already
 * exists this season and isn't deleted, each with a light player list (order, player card
 * fields and the last time each row was saved).
 *
 * Read-only on purpose: the weekly-board GET route CREATES a board on first
 * read, so this index reads `big_board_weekly` directly and never touches a
 * week the user hasn't opened.
 *
 * Migration 190 adds two things a board read carries once it's pushed: each
 * row's position before the last publish (`previous_position`, movement
 * arrows) and the scoring each board was published for (`scoring_format`).
 * Both reads use `select('*')` and never NAME the columns — a read naming a
 * missing column fails outright — so before the push the rows simply lack
 * them (no arrows, no saved scoring).
 */

export const NFL_SEASON = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

export interface BoardPlayerLite {
  list_id: string
  player_id: string
  position: number
  /** Where he was before the board's last publish; null = added by it;
   *  absent until migration 190 is pushed. */
  previous_position?: number | null
  updated_at: string | null
  added_at: string | null
  player: {
    id: string
    full_name: string
    position: string
    team: string | null
    headshot_url: string | null
  }
}

export interface MyBoard {
  listId: string
  /** 0 for the season board. */
  week: number
  players: BoardPlayerLite[]
  /** The scoring the board was last published for (`lists.scoring_format`);
   *  null when none is saved (the editor reads that as Half PPR —
   *  `rankingScoring`); absent (undefined) before migration 190 is pushed —
   *  nothing can save one yet. */
  scoringFormat?: ScoringFormat | null
}

export interface MyRankingBoards {
  season: MyBoard | null
  weeks: MyBoard[]
}

export const mobileRankingBoardsKey = (userId: string | null) =>
  ['mobile-rankings', 'boards', userId ?? 'none', NFL_SEASON] as const

interface PlayerRow {
  id: string
  list_id: string
  player_id: string
  position: number
  previous_position?: number | null
  updated_at: string | null
  added_at: string | null
  player: BoardPlayerLite['player'] | BoardPlayerLite['player'][] | null
}

/** `enabled` lets a screen that only sometimes shows the boards (a list's
 *  Import a ranking sheet) hold the read until it does. */
export function useMyRankingBoards(enabled = true) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  return useQuery({
    queryKey: mobileRankingBoardsKey(userId),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<MyRankingBoards> => {
      const supabase = createBrowserClient()
      const [seasonRes, weeklyRes] = await Promise.all([
        supabase
          .from('lists')
          .select('id')
          .eq('owner_id', userId!)
          .eq('is_big_board', true)
          .is('deleted_at', null)
          .maybeSingle(),
        supabase
          .from('big_board_weekly')
          .select('week_number, list_id')
          .eq('user_id', userId!)
          .eq('season', NFL_SEASON)
          .order('week_number', { ascending: true }),
      ])
      if (seasonRes.error) throw new Error(seasonRes.error.message)
      if (weeklyRes.error) throw new Error(weeklyRes.error.message)

      const seasonId = seasonRes.data?.id ?? null
      const allWeekly = weeklyRes.data ?? []
      const boardIds = [...(seasonId ? [seasonId] : []), ...allWeekly.map((w) => w.list_id)]
      if (boardIds.length === 0) return { season: null, weeks: [] }

      // The boards' saved scorings (`*`: see the file comment) — and which
      // weekly boards are in the trash: a weekly board is an ordinary list
      // ("Week N Big Board") that desktop My lists can delete, and owner RLS
      // still returns it (and its players).
      const listsRes = await supabase.from('lists').select('*').in('id', boardIds)
      if (listsRes.error) throw new Error(listsRes.error.message)
      // Only when the column was read (keeps "not pushed" — undefined —
      // distinguishable from "none saved").
      const scoringOf = new Map<string, ScoringFormat | null>()
      const deleted = new Set<string>()
      for (const l of (listsRes.data ?? []) as Array<{ id: string; deleted_at?: string | null; scoring_format?: unknown }>) {
        if (l.deleted_at) deleted.add(l.id)
        if ('scoring_format' in l) scoringOf.set(l.id, isScoringFormat(l.scoring_format) ? l.scoring_format : null)
      }
      const weekly = allWeekly.filter((w) => !deleted.has(w.list_id))
      const listIds = [...(seasonId ? [seasonId] : []), ...weekly.map((w) => w.list_id)]
      if (listIds.length === 0) return { season: null, weeks: [] }

      // pageAll + exact count: a board set can pass PostgREST's 1000-row cap,
      // and a short page must never pass for "that's everything".
      const rows = await pageAll<PlayerRow>((from, to) =>
        supabase
          .from('list_players')
          .select('*, player:players(id, full_name, position, team, headshot_url)', { count: 'exact' })
          .in('list_id', listIds)
          .order('list_id', { ascending: true })
          .order('position', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to) as unknown as PromiseLike<{
          data: PlayerRow[] | null
          error: { message: string } | null
          count?: number | null
        }>,
      )

      const byList = new Map<string, BoardPlayerLite[]>()
      for (const r of rows) {
        const player = firstEmbed(r.player)
        if (!player) continue
        const arr = byList.get(r.list_id) ?? []
        arr.push({
          list_id: r.list_id,
          player_id: r.player_id,
          position: r.position,
          // Only when the column was read (keeps "not pushed" distinguishable).
          ...('previous_position' in r ? { previous_position: r.previous_position ?? null } : {}),
          updated_at: r.updated_at,
          added_at: r.added_at,
          player,
        })
        byList.set(r.list_id, arr)
      }
      for (const arr of byList.values()) arr.sort((a, b) => a.position - b.position)

      return {
        season: seasonId
          ? { listId: seasonId, week: 0, players: byList.get(seasonId) ?? [], scoringFormat: scoringOf.get(seasonId) }
          : null,
        weeks: weekly.map((w) => ({
          listId: w.list_id,
          week: w.week_number,
          players: byList.get(w.list_id) ?? [],
          scoringFormat: scoringOf.get(w.list_id),
        })),
      }
    },
  })
}

/** Latest save stamp across a set of board rows (the reorder RPC stamps
 *  `updated_at`; never-reordered rows fall back to when they were added). */
export function latestSaved(rows: readonly BoardPlayerLite[]): string | null {
  let best: string | null = null
  for (const r of rows) {
    const t = r.updated_at ?? r.added_at
    if (t && (!best || t > best)) best = t
  }
  return best
}

/**
 * The season board for the ranking editor — the same request and cache key
 * as `useBigBoard()` (so desktop and mobile share it), but only fetched when
 * the editor is actually on the season board: that GET seeds and tops up the
 * board server-side, which a weekly edit has no reason to trigger.
 */
export function useSeasonBoard(enabled: boolean) {
  return useQuery({
    queryKey: listsKeys.bigBoard(),
    enabled,
    queryFn: async (): Promise<{ list: List; players: ListPlayerWithPlayer[] }> => {
      const res = await fetch('/api/lists/big-board')
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Request failed with ${res.status}`)
      }
      return (await res.json()) as { list: List; players: ListPlayerWithPlayer[] }
    },
  })
}
