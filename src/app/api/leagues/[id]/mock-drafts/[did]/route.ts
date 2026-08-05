import { NextResponse } from 'next/server'
import { z } from 'zod'

import { deleteMockDraft } from '@/lib/leagues/api/draft-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; did: string }>
}

const idSchema = z.uuid()

/**
 * DELETE /api/leagues/[id]/mock-drafts/[did] — abandon/delete a mock
 * (§15.2/§8.8; covers abandon AND recap-delete). Thin wrapper over
 * `delete_mock_draft` (071): LAUNCHER-only — commissioners refused
 * (D110(1); nobody else erases a member's solo practice); child cleanup
 * (CASCADE + the explicit `draft:<mock_id>` chat sweep) is the RPC's.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, did } = await params
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

  const result = await deleteMockDraft(supabase, id, did)
  return NextResponse.json(result.body, { status: result.status })
}
