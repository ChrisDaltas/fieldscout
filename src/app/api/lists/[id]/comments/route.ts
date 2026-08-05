import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import {
  commentsQuerySchema,
  createCommentSchema,
} from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params
  const { searchParams } = new URL(request.url)

  const parsed = commentsQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { page, pageSize } = parsed.data

  const supabase = await createServerClient()

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await supabase
    .from('list_comments')
    .select(
      `id, list_id, author_id, body, parent_id, created_at, updated_at,
       author:profiles!list_comments_author_id_fkey(id, username, avatar_url, cred_score, is_pro)`,
      { count: 'exact' },
    )
    .eq('list_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    comments: data ?? [],
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
      hasMore: (from + (data?.length ?? 0)) < (count ?? 0),
    },
  })
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createCommentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Confirm list exists and comments are enabled
  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('id, comments_enabled')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (!list.comments_enabled) {
    return NextResponse.json(
      { error: 'Comments are disabled on this list.' },
      { status: 403 },
    )
  }

  // If replying, ensure parent belongs to this list
  if (parsed.data.parent_id) {
    const { data: parent } = await supabase
      .from('list_comments')
      .select('id, list_id')
      .eq('id', parsed.data.parent_id)
      .maybeSingle()
    if (!parent || parent.list_id !== id) {
      return NextResponse.json(
        { error: 'Parent comment not found on this list.' },
        { status: 400 },
      )
    }
  }

  const { data: created, error: insertError } = await supabase
    .from('list_comments')
    .insert({
      list_id: id,
      author_id: user.id,
      body: parsed.data.body,
      parent_id: parsed.data.parent_id ?? null,
    })
    .select(
      `id, list_id, author_id, body, parent_id, created_at, updated_at,
       author:profiles!list_comments_author_id_fkey(id, username, avatar_url, cred_score, is_pro)`,
    )
    .single()

  if (insertError || !created) {
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not post comment' },
      { status: 500 },
    )
  }

  return NextResponse.json(created, { status: 201 })
}
