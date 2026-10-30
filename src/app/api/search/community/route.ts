import { NextResponse } from 'next/server'
import { z } from 'zod'

import { shownInCommunityQuery } from '@/components/mobile/community/community-ops'
import { createServerClient } from '@/lib/supabase/server'

const querySchema = z.object({
  q: z.string().trim().min(1).max(60),
  // 30: the phone search's single-scope page (People, Posts).
  limit: z.coerce.number().int().min(1).max(30).default(8),
  // What Community shows (plan C3): "lists" — lists with players, no
  // rankings; "all" — anything with players. Absent: every public list, as
  // search found before Community. The screen asking reads the switches and
  // sends this (`communitySearchHref`) — a route handler never reads a flag.
  show: z.enum(['lists', 'all']).optional(),
})

interface CommunityUserHit {
  type: 'user'
  id: string
  username: string
  avatar_url: string | null
  /** The phone search's "12k follows" line. */
  follower_count: number
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
    show: searchParams.get('show') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { q, limit, show } = parsed.data

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`

  // Public lists (title match). Exclude private and soft-deleted. With
  // `show`, only what Community shows (plan C3, readiness S9): a list with
  // players in it (never anyone's empty "My Big Board"), and for "lists" no
  // rankings — the feed's own rule, so search never finds what the feed
  // hides. A filter on what is shown, not on what may be read: every public
  // list is readable through RLS anyway. Joined to owner's username so the
  // UI can show "by @user".
  const publicLists = supabase
    .from('lists')
    .select(
      'id, title, slug, position_filter, player_count, owner:profiles!owner_id(username)',
    )
    .ilike('title', pattern)
    .eq('is_private', false)
    .is('deleted_at', null)
  const listsQuery = (show ? shownInCommunityQuery(publicLists, show === 'all') : publicLists)
    .order('like_count', { ascending: false })
    .limit(limit)

  // Users — handle match only. FieldScout stores no name for a person
  // (ruling 2026-08-05), so the handle is the only thing there is to match.
  const usersQuery = supabase
    .from('profiles')
    .select('id, username, avatar_url, follower_count')
    .ilike('username', pattern)
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
    avatar_url: row.avatar_url,
    follower_count: row.follower_count ?? 0,
  }))

  return NextResponse.json({ lists, users })
}
