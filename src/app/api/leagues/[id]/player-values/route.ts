import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readPoolValues } from '@/lib/leagues/api/pool-values-service'
import { systemTime } from '@/lib/leagues/time/time-provider'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** GET /api/leagues/[id]/player-values?week=&players=a,b,… — league-scored
 *  projection and season-to-date points for up to 300 players (the players
 *  page's window), computed through the league-player-values job's own
 *  code; read-only. Both params required. Reads are RLS-scoped behind the
 *  membership gate in `pool-values-service.ts`; the projection freshness
 *  bound is read at the TimeProvider's now. */
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

  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) {
    if (value !== '') query[key] = value
  }

  const result = await readPoolValues(supabase, id, query, systemTime)
  return NextResponse.json(result.body, { status: result.status })
}
