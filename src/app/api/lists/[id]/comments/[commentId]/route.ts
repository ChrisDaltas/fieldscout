import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ id: string; commentId: string }>
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id, commentId } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: comment, error: fetchError } = await supabase
    .from('list_comments')
    .select('id, list_id, author_id, deleted_at')
    .eq('id', commentId)
    .eq('list_id', id)
    .maybeSingle()
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!comment || comment.deleted_at) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
  }

  // Allow author OR list owner to soft-delete
  let allowed = comment.author_id === user.id
  if (!allowed) {
    const { data: list } = await supabase
      .from('lists')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle()
    allowed = list?.owner_id === user.id
  }
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: deleteError } = await supabase
    .from('list_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
