import { NextResponse } from 'next/server'

import { deleteStandaloneMockDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ mockId: string }>
}

/**
 * DELETE /api/mocks/[mockId] — abandon a STANDALONE practice draft, or
 * delete its finished report (MP task MP.5; spec v2.16 §8.8 — one verb
 * covers both, exactly as the league sibling does).
 *
 * It exists because `/app/mocks` gives a standalone mock the same Delete
 * affordance a league mock has, and the shipped route for that is
 * `/api/leagues/[id]/mock-drafts/[did]` — a URL with no league to put in it.
 * Without this door a standalone mock could not be cleaned up at all, and
 * the §22.5 3-active cap would be a wall the user cannot get back through.
 *
 * Thin wrapper, like every sibling: `delete_mock_draft` (095) is
 * LAUNCHER-only and sweeps the bot `teams` rows the launch minted. The
 * service scopes the id to `league_id IS NULL` before the RPC, so a
 * league-attached mock answers the same no-leak 404 an unknown id does.
 *
 * NO feature-flag read (§4 rule 13 / D231(4)).
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { mockId } = await params

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await deleteStandaloneMockDraft(supabase, mockId)
  return NextResponse.json(result.body, { status: result.status })
}
