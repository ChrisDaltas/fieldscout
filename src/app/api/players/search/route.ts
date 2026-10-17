import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  position: z.enum(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Set to false to include free agents and retired players in results. */
  activeOnly: z.coerce.boolean().default(true),
  /**
   * `true`: a query that IS a team code ("phi", "LAR") also finds that NFL
   * team's players (the phone's full-screen search, gap list §3 #1). Opt-in,
   * so every other caller keeps its name-only matching.
   */
  matchTeam: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
})

/** A query shaped like an NFL team code: two or three letters. Only then is
 *  it added to the filter — and only as upper-cased letters, so nothing the
 *  user typed reaches the filter string but A–Z. */
const TEAM_CODE = /^[A-Za-z]{2,3}$/

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    q: searchParams.get('q') ?? '',
    position: searchParams.get('position') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    activeOnly: searchParams.get('activeOnly') ?? undefined,
    matchTeam: searchParams.get('matchTeam') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { q, position, limit, activeOnly, matchTeam } = parsed.data
  const supabase = await createServerClient()

  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`)
  const collapsed = escaped.replace(/\s+/g, '')

  const team = matchTeam && TEAM_CODE.test(q) ? `,team.eq.${q.toUpperCase()}` : ''

  let query = supabase
    .from('players')
    .select('id, sleeper_id, full_name, position, team, headshot_url, status, adp')
    .or(`full_name.ilike.%${escaped}%,search_name.ilike.%${collapsed}%${team}`)
    .order('adp', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .limit(limit)

  if (position) {
    query = query.eq('position', position)
  }
  // Sleeper marks legendary retired players (Frank Gore, etc.) with
  // active=true. The reliable signal for "still in the league" is having a
  // current team. Free agents / retirees show team = null.
  if (activeOnly) {
    query = query.not('team', 'is', null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ results: data ?? [] })
}
