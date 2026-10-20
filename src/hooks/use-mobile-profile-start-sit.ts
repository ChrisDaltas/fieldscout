'use client'

import { useQuery } from '@tanstack/react-query'

import type { SsPlayer, SsQuestion } from '@/components/mobile/profile/profile-ops'
import { createBrowserClient } from '@/lib/supabase/client'

/** PostgREST's default row cap — a full page means "maybe more", never "all". */
const CAP = 1000

/** One embedded row as PostgREST may hand it back (object, one-row array, or
 *  null). */
export type Embedded<T> = T | T[] | null

export function one<T>(p: Embedded<T>): T | null {
  return Array.isArray(p) ? (p[0] ?? null) : p
}

/** A question's columns and its two players — the read My start/sit, the
 *  Profile preview and a question's own page share. */
export const SS_QUESTION_SELECT =
  'id, context_note, season, week, vote_count_a, vote_count_b, voting_closes_at, resolved_at, created_at, player_a:players!start_sit_questions_player_a_id_fkey(id, full_name, team, position, headshot_url), player_b:players!start_sit_questions_player_b_id_fkey(id, full_name, team, position, headshot_url)'

/** The columns `SS_QUESTION_SELECT` reads, as they come back. */
export interface SsQuestionRow {
  id: string
  context_note: string | null
  season: number
  week: number
  vote_count_a: number | null
  vote_count_b: number | null
  voting_closes_at: string
  resolved_at: string | null
  created_at: string | null
  player_a: unknown
  player_b: unknown
}

/** A read row → `SsQuestion`. Both players are NOT NULL foreign keys; a
 *  missing one is a broken read, not a question to draw half of. */
export function toSsQuestion(r: SsQuestionRow, where: string): SsQuestion {
  const playerA = one(r.player_a as Embedded<SsPlayer>)
  const playerB = one(r.player_b as Embedded<SsPlayer>)
  if (!playerA || !playerB) throw new Error(`${where}: question ${r.id} is missing a player`)
  return {
    id: r.id,
    note: r.context_note,
    season: r.season,
    week: r.week,
    votesA: r.vote_count_a ?? 0,
    votesB: r.vote_count_b ?? 0,
    closesAt: r.voting_closes_at,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
    playerA,
    playerB,
  }
}

/**
 * The signed-in user's own start/sit questions (`start_sit_questions`, public
 * SELECT under RLS) for Profile › Start/Sit and My start/sit — the same rows
 * Home's My stuff tile counts: voided questions are left out.
 *
 * A short read is an error, not a smaller list: a page that comes back full
 * while the count says there are more would understate every total.
 */
export function useMobileProfileStartSit(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['mobile-profile', 'start-sit', userId ?? 'anon'],
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<SsQuestion[]> => {
      const supabase = createBrowserClient()
      const { data, error, count } = await supabase
        .from('start_sit_questions')
        .select(SS_QUESTION_SELECT, { count: 'exact' })
        .eq('poster_id', userId!)
        .not('is_voided', 'is', true)
        .order('created_at', { ascending: false })
        .range(0, CAP - 1)
      if (error) throw error
      const rows = data ?? []
      if (count === null) throw new Error('My start/sit: the question count came back empty')
      if (count > rows.length) throw new Error(`My start/sit: read ${rows.length} of ${count} questions`)

      return rows.map((r) => toSsQuestion(r, 'My start/sit'))
    },
  })
}
