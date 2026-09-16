import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishMovePlayer } from '@/lib/leagues/api/commish-roster-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/move-player — the audited move of a player between rosters
 *  (spec §15.4:1694 → `commish_move_player`; §10.3; M6A L.E1.10, PROGRESS D351).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-roster-service.ts`, which the stack suite drives directly.
 *
 *  Body: { player_id, from_team_id, to_team_id, action_id, reason? } — one UUID per submit (re-sending the same body replays it).
 *  `reason` is OPTIONAL (Q66, spec v2.16.41) and blank normalises to absent.
 *  ⚠ Transitional: the RPC's own in-body gate still refuses a missing reason
 *  (22023 → 400, its text verbatim) until L.E1.15 / F362 relaxes it; this
 *  route maps that like any refusal and adds no `.min(1)` to hide it.
 *
 *  Authorization is the RPC's: ONE no-leak 42501 for "no such league" and
 *  "not a commissioner" alike. This handler deliberately does not pre-check
 *  the role — that would duplicate the gate and could drift from it. */
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
  const result = await commishMovePlayer(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
