import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readPlayoffBracket } from '@/lib/leagues/api/playoffs-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/playoffs — the bracket document (§11.5's Playoffs
 *  bullet, v2.16.25 / Q39; §16.1's standings page "Playoffs" tab, ALL
 *  SEASON → `league_playoff_bracket`, migration 118; M4 task L.D5.5). The
 *  RPC is the membership gate (in-body `is_league_member`, 42501 → 403);
 *  the service coerces the F247(b) score figures and passes the document
 *  through otherwise — no seed, total, tiebreak or instant is computed on
 *  this side. */
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

  const result = await readPlayoffBracket(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
