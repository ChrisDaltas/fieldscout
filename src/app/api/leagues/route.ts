import { NextResponse } from 'next/server'

import { listMyArchivedLeagues } from '@/lib/leagues/api/league-archive-service'
import { createLeague, listMyLeagues } from '@/lib/leagues/api/leagues-service'
import { createServerClient } from '@/lib/supabase/server'

// League creation is FREE (Q6 ruling 2026-07-20, spec v2.8; §17) —
// deliberately NO requireProUser here. The service layer composes
// Zod parse → validateLeagueSettings → create_league RPC (§12.0 layering);
// the RPC is the only writer (Q8/v2.8.2).

/** POST /api/leagues — create a league (spec §15.1). */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await createLeague(supabase, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** GET /api/leagues — my leagues via league_members (spec §15.1). An
 *  ARCHIVED league is not one of them (212 / F716 — `deleted_at` is the
 *  archived-at stamp); `?archived=1` lists those instead, read-only, for the
 *  Leagues page's "Archived leagues" section. */
export async function GET(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const archived = new URL(request.url).searchParams.get('archived') === '1'
  const result = archived ? await listMyArchivedLeagues(supabase, user.id) : await listMyLeagues(supabase, user.id)
  return NextResponse.json(result.body, { status: result.status })
}
