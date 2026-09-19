import { NextResponse } from 'next/server'
import { z } from 'zod'

import { commishRenameTeam } from '@/lib/leagues/api/commish-team-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/** POST /api/leagues/[id]/commish/team — the audited rename of any franchise (spec §15.4's v2.16.39 erratum → `commish_rename_team`; §10.3; M6A L.E1.11, PROGRESS D351). NOT the manager's own `rename_own_team` — that is a manager action and not a `/commish/` door.
 *
 *  Thin per the D68/D71 layering: auth + param plumbing only. Validation, the
 *  RPC call, the SQLSTATE mapping and the F65(b) identity guard all live in
 *  `commish-team-service.ts`, which the stack suite drives directly.
 *
 *  Body: { team_id, name, action_id, reason? } — one UUID per submit (re-sending the same body replays it).
 *  `reason` is OPTIONAL (Q66, spec v2.16.41; end to end since migration 131)
 *  and blank normalises to absent.
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
  const result = await commishRenameTeam(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
