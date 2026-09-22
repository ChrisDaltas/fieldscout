import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishEditBracket } from '@/lib/leagues/api/commish-bracket-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/bracket — the audited hand-pick of one playoff pairing (spec §11.5 "Bracket is commissioner-editable" → `commish_edit_bracket`, migration 134; §10.3; M6A L.E1.16, PROGRESS F360 / D351).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-bracket-service.ts`, which the stack suite drives directly.
 *
 *  Body: { matchup_id, home_team_id, away_team_id | null, action_id, reason? }
 *  — one UUID per submit (re-sending the same body replays it). `away_team_id`
 *  null = a bye for the home side. `reason` is OPTIONAL (Q66).
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
  const result = await commishEditBracket(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
