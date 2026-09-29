import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readTradeDeadline } from '@/lib/leagues/api/trades-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/trades/deadline — the league's trade deadline: its
 *  week, the instant (week N+1's start, Q76), the league-zone label and
 *  whether it has passed (M5 L.D3.12 → `trade_deadline`, migration 162;
 *  PROGRESS D426, F452).
 *
 *  Thin per the D68/D71 layering. A member reads it; a non-member gets the
 *  no-leak 403. Until 162 is pushed the function is missing and this answers
 *  a named 503 — the trade screen then falls back to the week-only line. */
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

  const result = await readTradeDeadline(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}
