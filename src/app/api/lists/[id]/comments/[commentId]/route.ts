import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import { isDoorNotPushed } from '@/lib/supabase/postgrest-errors'

interface RouteParams {
  params: Promise<{ id: string; commentId: string }>
}

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

/** The door 213 adds, and the parameters this route sends it. */
const REMOVE_DOOR = { remove_list_comment: ['p_list_id', 'p_comment_id'] } as const

/**
 * Remove (soft-delete) a comment — its author, the list's owner, or a
 * platform operator (Community launch plan C2, migration 213).
 *
 * The database decides through `remove_list_comment`: it raises when the
 * comment is missing / already removed (P0002 → 404) or not the caller's to
 * remove (42501 → 403), so "nothing was removed" is never answered OK.
 *
 * DEPLOY BEFORE PUSH: while 213 is not on the database the door is missing
 * (PGRST202 naming it) and the route falls back to the pre-213 UPDATE — the
 * same author-or-owner check as before, and now a row count, so an UPDATE
 * that matched nothing is a loud 409 rather than `{ ok: true }`. (No
 * `.select().single()` on that UPDATE: once 213's read rule hides removed
 * comments, a RETURNING read of the removed row is refused.)
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, commentId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase.rpc('remove_list_comment', {
    p_list_id: id,
    p_comment_id: commentId,
  })
  if (!error) return NextResponse.json({ ok: true })

  if (isDoorNotPushed(error, REMOVE_DOOR)) {
    return removeBeforePush(supabase, user.id, id, commentId)
  }
  if (error.code === 'P0002') {
    return NextResponse.json({ error: error.message || 'Comment not found' }, { status: 404 })
  }
  if (error.code === '42501') {
    return NextResponse.json({ error: error.message || 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json({ error: error.message }, { status: 500 })
}

/** The pre-213 path (the door not pushed yet), with a loud no-op check. */
async function removeBeforePush(supabase: ServerClient, userId: string, listId: string, commentId: string) {
  const { data: comment, error: fetchError } = await supabase
    .from('list_comments')
    .select('id, list_id, author_id, deleted_at')
    .eq('id', commentId)
    .eq('list_id', listId)
    .maybeSingle()
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!comment || comment.deleted_at) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  // Allow author OR list owner to soft-delete
  let allowed = comment.author_id === userId
  if (!allowed) {
    const { data: list, error: listError } = await supabase
      .from('lists')
      .select('owner_id')
      .eq('id', listId)
      .maybeSingle()
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 })
    }
    allowed = list?.owner_id === userId
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: deleteError, count } = await supabase
    .from('list_comments')
    .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', commentId)
    .eq('list_id', listId)
    .is('deleted_at', null)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }
  if (count !== 1) {
    return NextResponse.json(
      { error: 'That comment wasn’t removed — it may already be gone. Refresh and try again.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ ok: true })
}
