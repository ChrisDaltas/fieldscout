import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { systemTime } from '@/lib/leagues/time/time-provider'
import { DEFAULT_SCORING_SYSTEM, type ScoringSystemKey } from '@/lib/players/core-stats-ops'
import { computePoolStandings, type PoolCache, readPlayerCoreStats, systemRules } from '@/lib/players/core-stats-service'
import { createServerClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

interface RouteParams {
  params: Promise<{ id: string }>
}

const querySchema = z
  .strictObject({
    league: z.uuid().optional(),
    scoring: z.enum(['espn_standard', 'half_ppr', 'ppr']).optional(),
  })
  .refine((q) => !(q.league && q.scoring), { message: 'league and scoring are exclusive' })

/**
 * R1503: the preset pool standings are the same for every viewer — scored
 * once per (system, season, week) and cached ~5 minutes. Read through an
 * anon client (no cookies inside a cache scope): `player_stats` / `players`
 * are public reads.
 */
const poolCache: PoolCache = (system: ScoringSystemKey, season: number, week: number | null) =>
  unstable_cache(
    async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      if (!url || !key) throw new Error('supabase env missing')
      const anon = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      return computePoolStandings(anon, systemRules(system), new Map(), season, week)
    },
    ['player-core-stats-pool', system, String(season), String(week)],
    { revalidate: 300 },
  )()

/** GET /api/players/[id]/core-stats?scoring=|?league= — the player page's
 *  core-stats row (D486(10)/(11)); read-only, login required. `league` is
 *  member-gated; otherwise a preset system (default ESPN Standard). */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (id.length === 0 || id.length > 64) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) if (value !== '') query[key] = value
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 })

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const choice = parsed.data.league
    ? ({ kind: 'league', leagueId: parsed.data.league } as const)
    : ({ kind: 'system', system: parsed.data.scoring ?? DEFAULT_SCORING_SYSTEM } as const)
  const result = await readPlayerCoreStats(supabase, id, choice, systemTime, { poolCache })
  return NextResponse.json(result.body, { status: result.status })
}
