import { NextResponse } from 'next/server'
import { z } from 'zod'

import { systemTime } from '@/lib/leagues/time/time-provider'
import { readPlayerCoreStats } from '@/lib/players/core-stats-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const querySchema = z.strictObject({ league: z.uuid().optional() })

/** GET /api/players/[id]/core-stats[?league=] — the player page's core-stats
 *  row (D486(10)); read-only. With `league` it is scored under that league's
 *  rules (member-gated), otherwise under the default template. */
export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  if (id.length === 0 || id.length > 64) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 })
  }
  const url = new URL(request.url)
  const query: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) if (value !== '') query[key] = value
  const parsed = querySchema.safeParse(query)
  if (!parsed.success) return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 })

  const supabase = await createServerClient()
  if (parsed.data.league) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await readPlayerCoreStats(supabase, id, parsed.data.league ?? null, systemTime)
  return NextResponse.json(result.body, { status: result.status })
}
