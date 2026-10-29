import { NextResponse } from 'next/server'
import { z } from 'zod'

import { LEAGUE_DELETE_RETIRED_MESSAGE } from '@/lib/leagues/api/league-archive-service'
import { getLeagueDetail, patchLeague } from '@/lib/leagues/api/leagues-service'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id] — detail: settings + members + teams + my role (§15.1). */
export async function GET(_request: Request, { params }: RouteParams) {
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

  // L.D2.13: the waiver window is read at the TimeProvider's now (F425).
  const result = await getLeagueDetail(supabase, user.id, id, systemTime.now())
  return NextResponse.json(result.body, { status: result.status })
}

/**
 * PATCH /api/leagues/[id] — update settings / scoring template / M1 lifecycle
 * (§15.1; L.A1.13). The service composes Zod → validateLeagueSettings →
 * splitSettings → update_league_settings RPC (settings path) or
 * validateLeagueSettings → set_league_status RPC (status path — this route is
 * the enforcement point for settings validity on the scheduled transition).
 */
export async function PATCH(request: Request, { params }: RouteParams) {
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

  const body = await request.json().catch(() => null)
  const result = await patchLeague(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** DELETE /api/leagues/[id] — RETIRED by 212 (F716, Chris 2026-10-27:
 *  leagues are archived, never deleted). Answers 405 in plain words, for
 *  every caller, without touching the database; the commissioner archives
 *  through POST /api/leagues/[id]/archive. */
export async function DELETE() {
  return NextResponse.json({ error: LEAGUE_DELETE_RETIRED_MESSAGE }, { status: 405, headers: { Allow: 'GET, PATCH' } })
}
