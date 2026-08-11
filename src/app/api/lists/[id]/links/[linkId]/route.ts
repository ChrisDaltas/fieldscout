/**
 * /api/lists/[id]/links/[linkId] — detach one attached link (migration 080).
 *
 * Thin wrapper over `removeLink`; see `src/lib/lists/links-service.ts` for the
 * 404-vs-403 reasoning behind a delete that removed nothing.
 *
 *   DELETE → { list_id, link_id, removed: true, links }   OWNER ONLY
 */
import { NextResponse } from 'next/server'

import { removeLink } from '@/lib/lists/links-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; linkId: string }>
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, linkId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await removeLink(supabase, id, linkId, user.id)
  return NextResponse.json(result.body, { status: result.status })
}
