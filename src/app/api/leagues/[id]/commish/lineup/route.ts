import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishEditLineup } from '@/lib/leagues/api/commish-lineup-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/lineup — the AUDITED commissioner lineup
 *  override (§15.4:1695 → `commish_edit_lineup`, migration 123; §11.2, §10.3).
 *
 *  This is NOT the manager's lineup route with a commissioner arm.
 *  `PATCH /api/leagues/[id]/teams/[tid]/lineup` is unchanged and still
 *  enforces the per-player kickoff lock on every caller, commissioner
 *  included. This route is the exception path: it lifts the lock, the
 *  past-week gate and the closed-week gate, REQUIRES a reason, and writes a
 *  `commissioner_actions` row the whole league can read — but only when
 *  something actually changed (PROGRESS §3(b), Chris: "no receipt if nothing
 *  is done. only when something is done.").
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-lineup-service.ts`, which the stack suite drives directly.
 *
 *  Body: { team_id, week, slot_map, action_id, reason } — the FULL canonical
 *  map incl. IR keys, one UUID per submit (re-sending the same body replays
 *  it), and a reason that is REQUIRED here.
 *
 *  Authorization is the RPC's: 123 raises one no-leak 42501 for "no such
 *  league" and "not a commissioner" alike. This handler deliberately does not
 *  pre-check the role — that would duplicate the gate and could drift from it. */
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
  const result = await commishEditLineup(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
