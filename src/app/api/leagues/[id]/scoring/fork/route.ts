import { NextResponse } from 'next/server'
import { z } from 'zod'

import { forkScoringTemplate } from '@/lib/leagues/api/scoring-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

const idSchema = z.uuid()

/**
 * POST /api/leagues/[id]/scoring/fork — fork a template into this league's own
 * custom scoring row (spec §7.3.3.1 entry point, *"picking a template as the
 * starting point **forks** it into a new `scoring_systems` row"*; §15.1 via
 * this task's erratum; SE.6). Body: `template_id`.
 *
 * Thin wrapper over `scoring_fork_template` (migration 105): the commissioner
 * check (42501), the §7.3 `setup`/`scheduled` window, the template predicate,
 * the format-2 document build, `scoring_rules_validate` and the same-
 * transaction `leagues.scoring_system_id` repoint all live in the RPC — with
 * migration 104's three write walls behind it. §12.25: *"Writes are
 * server-authoritative."*
 */
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
  const result = await forkScoringTemplate(supabase, id, body)
  return NextResponse.json(result.body, { status: result.status })
}
