import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readStandings } from '@/lib/leagues/api/standings-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/standings — the tiebreaker-ordered table (§15.3 →
 *  `league_standings`, migration 117; §7.3.7). The RPC is the membership
 *  gate (in-body `is_league_member`, 42501 → 403); the service normalises
 *  the F247(b) scale and passes the document through otherwise. */
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

  const result = await readStandings(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
