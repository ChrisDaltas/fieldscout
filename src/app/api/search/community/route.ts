import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'

const querySchema = z.object({
  q: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(20).default(8),
})

interface CommunityUserHit {
  type: 'user'
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
}

interface CommunityListHit {
  type: 'list'
  id: string
  title: string
  slug: string
  owner_username: string | null
  position_filter: string | null
  player_count: number
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    q: searchParams.get('q') ?? '',
    limit: searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { q, limit } = parsed.data

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`

  // Public lists (title match). Exclude private and soft-deleted. Joined to
  // owner's username so the UI can show "by @user".
  const listsQuery = supabase
    .from('lists')
    .select(
      'id, title, slug, position_filter, player_count, owner:profiles!owner_id(username)',
    )
    .ilike('title', pattern)
    .eq('is_private', false)
    .is('deleted_at', null)
    .order('like_count', { ascending: false })
    .limit(limit)

  // Users (username or display_name match).
  const usersQuery = supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .or(`username.ilike.${pattern},display_name.ilike.${pattern}`)
    .order('cred_score', { ascending: false })
    .limit(limit)

  const [listsRes, usersRes] = await Promise.all([listsQuery, usersQuery])

  if (listsRes.error) {
    return NextResponse.json({ error: listsRes.error.message }, { status: 500 })
  }
  if (usersRes.error) {
    return NextResponse.json({ error: usersRes.error.message }, { status: 500 })
  }

  const lists: CommunityListHit[] = (listsRes.data ?? []).map((row) => {
    const r = row as unknown as {
      id: string
      title: string
      slug: string
      position_filter: string | null
      player_count: number
      owner: { username: string } | null
    }
    return {
      type: 'list',
      id: r.id,
      title: r.title,
      slug: r.slug,
      owner_username: r.owner?.username ?? null,
      position_filter: r.position_filter,
      player_count: r.player_count ?? 0,
    }
  })

  const users: CommunityUserHit[] = (usersRes.data ?? []).map((row) => ({
    type: 'user',
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
  }))

  return NextResponse.json({ lists, users })
}
