'use client'

import { useQuery } from '@tanstack/react-query'

import type { SsPlayer, SsQuestion } from '@/components/mobile/profile/profile-ops'
import { createBrowserClient } from '@/lib/supabase/client'

/** PostgREST's default row cap — a full page means "maybe more", never "all". */
const CAP = 1000

type Embedded = SsPlayer | SsPlayer[] | null

function one(p: Embedded): SsPlayer | null {
  return Array.isArray(p) ? (p[0] ?? null) : p
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
        .select(
          'id, context_note, season, week, vote_count_a, vote_count_b, voting_closes_at, resolved_at, created_at, player_a:players!start_sit_questions_player_a_id_fkey(id, full_name, team, position, headshot_url), player_b:players!start_sit_questions_player_b_id_fkey(id, full_name, team, position, headshot_url)',
          { count: 'exact' },
        )
        .eq('poster_id', userId!)
        .not('is_voided', 'is', true)
        .order('created_at', { ascending: false })
        .range(0, CAP - 1)
      if (error) throw error
      const rows = data ?? []
      if (count === null) throw new Error('My start/sit: the question count came back empty')
      if (count > rows.length) throw new Error(`My start/sit: read ${rows.length} of ${count} questions`)

      return rows.map((r) => {
        const playerA = one(r.player_a as Embedded)
        const playerB = one(r.player_b as Embedded)
        // Both players are NOT NULL foreign keys; a missing one is a broken
        // read, not a question to draw half of.
        if (!playerA || !playerB) throw new Error(`My start/sit: question ${r.id} is missing a player`)
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
      })
    },
  })
}
