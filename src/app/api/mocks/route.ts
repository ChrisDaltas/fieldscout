import { NextResponse } from 'next/server'

import {
  launchStandaloneMockDraft,
  listMyMockDrafts,
} from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

/**
 * POST /api/mocks — launch a STANDALONE practice draft (MP task MP.4; spec
 * v2.16 §8.8 "practice is the purpose, a league is optional context").
 *
 * Deliberately NOT the league route widened. `POST /api/leagues/[id]/
 * mock-drafts` answers "practice THIS league's draft" and its whole
 * authorization story is league membership; this answers "practice", and
 * has no league in it at all. Two questions, two endpoints — the same rule
 * MP.5 applies to the GET half it adds to this file.
 *
 * Thin wrapper, exactly like its league sibling: auth here, every rule in
 * `create_mock_draft` (095) — the §22.5 caps (3 active, 5/hour), the
 * §7.3.8/§7.3.2 range guard, the bot-seat minting, the §8.6.8 auction
 * solvency backstop. Its refusals come back as friendly 400s with the RPC's
 * own words.
 *
 * Launch dedupe is owned END-TO-END here (D110(11)/R149), the league
 * route's pattern verbatim: the RPC always receives a `p_action_id` — the
 * body's hook-minted UUID when the launcher UI sends one (D68(1)), else one
 * minted per submit below (crypto lives in the route, outside the
 * `src/lib/leagues/**` determinism guard). A replayed submit answers 200
 * `created:false` with the ORIGINAL mock — and this matters more here than
 * it does for a league mock, because a duplicate standalone launch would
 * also mint a second full set of bot `teams` rows.
 *
 * NO feature-flag read (tasks-MP §4 rule 13 / D231(4)): `NEXT_PUBLIC_` flags
 * are client-inlined, and gating a server-authoritative surface on one is a
 * client-side gate. The flag gates the SURFACES that call this (MP.5/MP.7).
 */
export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await launchStandaloneMockDraft(supabase, body ?? {}, {
    mintActionId: () => crypto.randomUUID(),
  })
  return NextResponse.json(result.body, { status: result.status })
}

/**
 * GET /api/mocks — EVERY practice draft this user launched, active and
 * complete, league-attached or standalone (MP task MP.5). The `/app/mocks`
 * practice home's read.
 *
 * The league route (`GET /api/leagues/[id]/mock-drafts`) is NOT widened to
 * mean "all": it answers "practice drafts for THIS league" and its shape is
 * the league id all the way down. Two questions, two endpoints.
 *
 * Launcher-scoped server-side in `listMyMockDrafts` on top of RLS — see its
 * docblock for why the explicit filter is not redundant on the
 * league-attached rows.
 *
 * NO feature-flag read (§4 rule 13 / D231(4)) — the surfaces are gated, not
 * this.
 */
export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await listMyMockDrafts(supabase, user.id)
  return NextResponse.json(result.body, { status: result.status })
}
