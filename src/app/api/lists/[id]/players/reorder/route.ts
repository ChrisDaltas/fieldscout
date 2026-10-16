import { NextResponse } from 'next/server'

import {
  publishPositionsSchema,
  rpcPositions,
  saveScoringFormat,
  scoringFormatSchema,
  type ScoringSave,
} from '@/lib/lists/ranking-publish'
import { createServerClient } from '@/lib/supabase/server'
import { reorderPlayersSchema } from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * The reorder body, plus what a ranking PUBLISH carries (migration 190,
 * Chris 2026-10-15): per entry, whether this publish added the player (he
 * then has no previous position — the RPC records everyone else's on a
 * ranking board), and the scoring the ranking was made for. Plain list
 * reorders send neither and behave as before. A ranking published with no
 * scoring (desktop's Weekly ranks) keeps the one it has — Half PPR if one
 * was never chosen, which the RPC fills (Chris, 2026-10-16).
 */
const publishSchema = reorderPlayersSchema.extend({
  positions: publishPositionsSchema,
  scoringFormat: scoringFormatSchema.optional(),
})

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = publishSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Atomic reorder via Postgres function. Function asserts ownership itself.
  const { error } = await supabase.rpc('reorder_list_players', {
    p_list_id: id,
    p_positions: rpcPositions(parsed.data.positions),
  })

  if (error) {
    const status = error.message.includes('Unauthorized')
      ? 401
      : error.message.includes('Forbidden')
        ? 403
        : error.message.includes('not found')
          ? 404
          : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  // The order is saved (and the RPC proved ownership). A scoring that
  // doesn't stick is reported, never a failed save — before migration 190
  // is pushed it is simply `unsupported`.
  if (!parsed.data.scoringFormat) return NextResponse.json({ ok: true })
  let scoring: ScoringSave | undefined
  let scoringError: string | undefined
  try {
    scoring = await saveScoringFormat(supabase, id, parsed.data.scoringFormat)
  } catch (err) {
    scoringError = err instanceof Error ? err.message : String(err)
  }
  return NextResponse.json({ ok: true, scoring, scoringError })
}
