import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  position: z.enum(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Set to false to include free agents and retired players in results. */
  activeOnly: z.coerce.boolean().default(true),
})

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    q: searchParams.get('q') ?? '',
    position: searchParams.get('position') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    activeOnly: searchParams.get('activeOnly') ?? undefined,
  })

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { q, position, limit, activeOnly } = parsed.data
  const supabase = await createServerClient()

  const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`)
  const collapsed = escaped.replace(/\s+/g, '')

  let query = supabase
    .from('players')
    .select('id, sleeper_id, full_name, position, team, headshot_url, status, adp')
    .or(`full_name.ilike.%${escaped}%,search_name.ilike.%${collapsed}%`)
    .order('adp', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .limit(limit)

  if (position) {
    query = query.eq('position', position)
  }
  // Sleeper marks legendary retired players (Frank Gore, etc.) with
  // active=true. The reliable signal for "still in the league" is having a
  // current team. Free agents / retirees show team = null.
  if (activeOnly) {
    query = query.not('team', 'is', null)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ results: data ?? [] })
}
