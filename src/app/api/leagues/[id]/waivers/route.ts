import { NextResponse } from 'next/server'
import { z } from 'zod'

import { readClaims, submitClaim } from '@/lib/leagues/api/waivers-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/waivers — submit a blind waiver claim (§15.3,
 *  §13.2 → `waiver_claim_submit`, migration 145; M5 L.D2.12).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard live in
 *  `waivers-service.ts`, which the stack suite drives directly.
 *
 *  Body: { team_id, add_player_id, drop_player_id?, faab_bid?, action_id,
 *  reason? } — one `action_id` per submit (re-sending the same body replays
 *  it). A commissioner may claim for any team (TD5); `reason` is stored only
 *  on that arm. */
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
  const result = await submitClaim(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}

/** GET /api/leagues/[id]/waivers — a team's claims (§15.3 "my pending claims").
 *
 *  Query: `status` (pending | all; default pending) · `team_id` (default: the
 *  caller's own team; another team's is the commissioner's only — bids are
 *  blind, E13). A non-member gets the in-season family's no-leak 403 (R807);
 *  a member asking for another team's claims gets a 403 by name, never an
 *  empty list. Empty query values are dropped; the strict schema refuses an
 *  unknown key. */
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

  const result = await readClaims(supabase, id, user.id, query)
  return NextResponse.json(result.body, { status: result.status })
}
