import { NextResponse } from 'next/server'
import { z } from 'zod'

import { deleteLeague, getLeagueDetail, patchLeague } from '@/lib/leagues/api/leagues-service'
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

  const result = await getLeagueDetail(supabase, user.id, id)
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

/** DELETE /api/leagues/[id] — commish soft delete via RPC (§15.1; Q8/v2.8.2). */
export async function DELETE(_request: Request, { params }: RouteParams) {
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

  const result = await deleteLeague(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
