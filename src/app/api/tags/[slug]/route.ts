import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

interface RouteParams {
  params: Promise<{ slug: string }>
}

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['recent', 'popular']).default('recent'),
})

export async function GET(request: Request, { params }: RouteParams) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    sort: searchParams.get('sort') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { page, pageSize, sort } = parsed.data

  const supabase = await createServerClient()

  const { data: tag, error: tagError } = await supabase
    .from('tags')
    .select('id, name, slug, is_system_tag, use_count')
    .eq('slug', slug)
    .maybeSingle()
  if (tagError) {
    return NextResponse.json({ error: tagError.message }, { status: 500 })
  }
  if (!tag) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const orderColumn = sort === 'popular' ? 'like_count' : 'updated_at'

  const { data: rows, count, error: listError } = await supabase
    .from('list_tags')
    .select(
      `list:lists!inner(
        id, owner_id, title, slug, description, position_filter,
        like_count, view_count, player_count, is_private, deleted_at,
        created_at, updated_at,
        owner:profiles!lists_owner_id_fkey(id, username, avatar_url, cred_score, is_pro)
      )`,
      { count: 'exact' },
    )
    .eq('tag_id', tag.id)
    .eq('list.is_private', false)
    .is('list.deleted_at', null)
    .order(`list(${orderColumn})`, { ascending: false })
    .range(from, to)

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }

  const lists = (rows ?? [])
    .map((r) => r.list)
    .filter((l): l is NonNullable<typeof l> => Boolean(l))

  return NextResponse.json({
    tag,
    lists,
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
      hasMore: (from + lists.length) < (count ?? 0),
    },
  })
}
