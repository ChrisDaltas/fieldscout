/**
 * /api/lists/[id]/links — attached links (migration 080, Chris's 2026-08-11
 * ruling: *"a way to link back to resources used and a way for creators to
 * attached videos to their lists"*).
 *
 * Thin wrappers only: everything decidable lives in
 * `src/lib/lists/links-service.ts` so the stack suite can drive it with real
 * signed-in clients. 080's RLS is the enforcement backstop — this file
 * authenticates and delegates, nothing else (the LV.1.2 `drafted` precedent).
 *
 *   GET    → { list_id, links: [...] }   readable by anyone who can read the list
 *   POST   → { list_id, link, links }    attach one — OWNER ONLY
 *   PATCH  → { list_id, links }          reorder, body `{ link_ids: [...] }` — OWNER ONLY
 *
 * Removal is `./[linkId]/route.ts`.
 *
 * GET is deliberately open to signed-out callers: 080's SELECT policy defers
 * to `lists`'s own RLS, so an anonymous reader sees a public list's links and
 * nothing else — which is what the server-rendered share view (D7) needs.
 */
import { NextResponse } from 'next/server'

import { addLink, listLinks, reorderLinks } from '@/lib/lists/links-service'
import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()

  const result = await listLinks(supabase, id)
  return NextResponse.json(result.body, { status: result.status })
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await addLink(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const result = await reorderLinks(supabase, id, user.id, body)
  return NextResponse.json(result.body, { status: result.status })
}
