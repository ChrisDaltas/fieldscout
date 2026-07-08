import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAdminUser } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * PATCH /api/admin/posts/[id] — the review gate's actions. Every action
 * cascades to the post's backing list (which is created PRIVATE and only
 * goes public here):
 *   publish   → post live + backing list public
 *   unpublish → post back to draft + backing list private again
 *   takedown  → post soft-deleted + backing list soft-deleted
 *
 * Takedowns stay down: publish refuses (409) on a taken-down post —
 * restoration, if ever wanted, is a deliberate separate operation.
 */

const actionSchema = z.object({
  action: z.enum(['publish', 'unpublish', 'takedown']),
})

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const gate = await requireAdminUser()
  if (!gate.ok) return gate.response
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { action } = parsed.data

  const admin = createAdminClient()
  const { data: post, error: loadError } = await admin
    .from('persona_posts')
    .select('id, list_id, deleted_at')
    .eq('id', id)
    .maybeSingle()
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 })
  }
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 })
  }
  if (action === 'publish' && post.deleted_at) {
    return NextResponse.json(
      { error: 'This post was taken down; takedowns stay down.' },
      { status: 409 },
    )
  }

  // Cascade to the backing list FIRST — if the second write fails, the safe
  // side is "list hidden, post state unchanged", never "post gone, list live".
  if (post.list_id) {
    const listPatch =
      action === 'publish'
        ? { is_private: false }
        : action === 'unpublish'
          ? { is_private: true }
          : { deleted_at: new Date().toISOString() }
    const { error: listError } = await admin
      .from('lists')
      .update(listPatch)
      .eq('id', post.list_id)
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }
  }

  const postPatch =
    action === 'publish'
      ? { status: 'published', published_at: new Date().toISOString() }
      : action === 'unpublish'
        ? { status: 'draft' }
        : { deleted_at: new Date().toISOString() }

  const { data, error } = await admin
    .from('persona_posts')
    .update(postPatch)
    .eq('id', id)
    .select('id, status, published_at, deleted_at')
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
