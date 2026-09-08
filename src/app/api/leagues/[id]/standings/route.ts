import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readStandings } from '@/lib/leagues/api/standings-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/standings[?view=projected] — the tiebreaker-ordered
 *  table (§15.3 → `league_standings`, migration 117; §7.3.7), or since
 *  L.D5.5 the PROJECTED table (§11.5 v2.16.25 → `league_standings_projected`,
 *  migration 118 — the same chain over the open weeks "as if they ended
 *  now"). Either RPC is the membership gate (in-body `is_league_member`,
 *  42501 → 403); the service picks the RPC from `view`, normalises the
 *  F247(b) scale and passes the document through otherwise. */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The activity route's rule: only the params PRESENT reach the schema; an
  // empty `?view=` is an absent view (the final table), not a parse error.
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readStandings(supabase, id, query)
  return NextResponse.json(result.body, { status: result.status })
}
