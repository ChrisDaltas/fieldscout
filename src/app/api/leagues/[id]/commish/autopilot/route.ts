import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishSetAutopilot } from '@/lib/leagues/api/commish-autopilot-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/autopilot — the commissioner's per-team "Put on autopilot" switch (spec §7.2.1(c) / §10.1 Membership, v2.16.42 — Q63 RULED 2026-09-27 → `commish_set_autopilot`, migration 139; §10.3; M6A L.E1.22, PROGRESS D351's doctrine copied).
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-autopilot-service.ts`, which the stack suite drives directly.
 *
 *  Body: { team_id, on, action_id, reason? } — one UUID per submit (re-sending the same body replays it).
 *  `reason` is OPTIONAL (Q66) and blank normalises to absent.
 *
 *  Authorization is the RPC's: ONE no-leak 42501 for "no such league" and
 *  "not a commissioner" alike (co-commissioners are commissioners here).
 *  This handler deliberately does not pre-check the role — that would
 *  duplicate the gate and could drift from it. */
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
  const result = await commishSetAutopilot(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
