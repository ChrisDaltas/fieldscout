import { NextResponse } from 'next/server'
import { z } from 'zod'

import { updateScoringRules } from '@/lib/leagues/api/scoring-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * PUT /api/leagues/[id]/scoring/rules — save this league's custom scoring
 * document (spec §7.3.3.1's editor-save path; §12.25 *"every rules edit goes
 * through SECURITY DEFINER RPCs"*; §15.1 via this task's erratum; SE.6).
 * Body: `rules` — the whole format-2 document, NORMALIZED by the client
 * (`normalizeScoringDoc`; the RPC refuses an un-normalized one rather than
 * rewriting it).
 *
 * PUT rather than PATCH on purpose: the wire body is the WHOLE document, and
 * the §7.3.3.1 normal form is a property of the whole (an override equal to
 * its base value is stripped) — a partial merge would make the derived
 * All-Positions switch state depend on what the client happened to send.
 *
 * Thin wrapper over `scoring_update_rules` (migration 105): commissioner check
 * (42501), the §7.3 window, the "this must be the league's own fork" predicate
 * and `scoring_rules_validate` all live in the RPC.
 */
export async function PUT(request: Request, { params }: RouteParams) {
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
  const result = await updateScoringRules(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
