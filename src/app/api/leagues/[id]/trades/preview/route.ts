import { NextResponse } from 'next/server'
import { z } from 'zod'

import { previewTrade } from '@/lib/leagues/api/trades-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/trades/preview — what the league would say about an
 *  offer before it is sent, or about accepting one before it is answered
 *  (M5 L.D3.12 → `trade_preview`, migration 162; §13.3, §16.2 "legality
 *  preview"; PROGRESS D426, F462). A READ: nothing is written. POST only
 *  because the offer is a body.
 *
 *  Body: OFFER { from_team_id, to_team_id, items: [{ player_id | faab_amount,
 *  from_team_id }], drops? } · ACCEPT { trade_id, drops? }. Until 162 is
 *  pushed this answers a named 503 and the screen sends as before. */
export async function POST(request: Request, { params }: RouteParams) {
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
  const result = await previewTrade(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
