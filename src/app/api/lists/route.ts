import { NextResponse } from 'next/server'

import {
  countPrivateLists,
  FREE_PRIVATE_LIST_LIMIT,
  FREE_TEAM_LIST_LIMIT,
  isPrivateListCapError,
  isTeamListCapError,
  PRIVATE_LIMIT_BODY,
  TEAM_LIMIT_BODY,
  generateUniqueSlug,
  replaceTagsForList,
  resolveTagIds,
} from '@/lib/lists/helpers'
import {
  COVER_COLOR_UNAVAILABLE_BODY,
  COVER_COLOR_UNAVAILABLE_STATUS,
  createListWithCoverSchema,
  isMissingCoverColorColumn,
} from '@/lib/lists/cover-color'
import {
  isTierOnlyUnavailable,
  TIER_ONLY_UNAVAILABLE_BODY,
  TIER_ONLY_UNAVAILABLE_STATUS,
} from '@/lib/lists/ranking-mode'
import { createServerClient } from '@/lib/supabase/server'
import {
  legacyFlagsToRankingMode,
  listsQuerySchema,
  rankingModeToLegacyFlags,
} from '@/types/schemas/lists'

/** How many players each list carries for its cover. See the GET body. */
const COVER_PLAYERS = 4

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const parsed = listsQuerySchema.safeParse({
    page: searchParams.get('page') ?? undefined,
    pageSize: searchParams.get('pageSize') ?? undefined,
    includeBigBoard: searchParams.get('includeBigBoard') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { page, pageSize, includeBigBoard } = parsed.data

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  // Pull the set of lists this user has favorited so we can include lists they
  // don't own but have starred, and so each row's `is_favorited` reflects the
  // current viewer (not the legacy boolean on the row).
  const { data: favRows, error: favError } = await supabase
    .from('list_favorites')
    .select('list_id')
    .eq('user_id', user.id)
  if (favError) {
    return NextResponse.json({ error: favError.message }, { status: 500 })
  }
  const favIds = new Set((favRows ?? []).map((r) => r.list_id as string))

  // Run two simpler queries instead of one `.or()` with a nested `in()` —
  // PostgREST's `or` parser doesn't handle commas inside `in(...)` cleanly.
  // The page/pageSize pagination is applied to the owned set; favorited
  // others' lists are appended after.
  const ownedSelect =
    '*, list_tags(tag:tags(id, name, slug, is_system_tag)), owner:profiles!owner_id(username, avatar_url)'
  let ownedQuery = supabase
    .from('lists')
    .select(ownedSelect, { count: 'exact' })
    .eq('owner_id', user.id)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .range(from, to)
  if (!includeBigBoard) ownedQuery = ownedQuery.eq('is_big_board', false)

  const favoritedOthersIds = Array.from(favIds)
  const favoritedOthersQuery =
    favoritedOthersIds.length > 0
      ? supabase
          .from('lists')
          .select(ownedSelect)
          .in('id', favoritedOthersIds)
          .neq('owner_id', user.id)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
      : null

  const [ownedRes, favRes] = await Promise.all([
    ownedQuery,
    favoritedOthersQuery ?? Promise.resolve({ data: [], error: null }),
  ])

  if (ownedRes.error) {
    return NextResponse.json({ error: ownedRes.error.message }, { status: 500 })
  }
  if (favRes.error) {
    return NextResponse.json({ error: favRes.error.message }, { status: 500 })
  }
  const data = [...(ownedRes.data ?? []), ...(favRes.data ?? [])]
  const count = ownedRes.count

  // Flatten the join: each list gets a `tags` array of tag objects, and
  // `is_favorited` is derived per-viewer from the junction (not the legacy
  // boolean on the row).
  type OwnerProfile = {
    username: string
    avatar_url: string | null
  }
  const lists = (data ?? []).map((row) => {
    const { list_tags, owner, ...rest } = row as Record<string, unknown> & {
      id: string
      owner_id?: string
      list_tags?: Array<{ tag: { id: string; name: string; slug: string; is_system_tag: boolean } | null }>
      owner?: OwnerProfile | OwnerProfile[] | null
    }
    const tags = (list_tags ?? [])
      .map((entry) => entry.tag)
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
    // PostgREST returns a to-one embed as an object, but normalize defensively.
    const ownerObj = Array.isArray(owner) ? (owner[0] ?? null) : (owner ?? null)
    return {
      ...rest,
      tags,
      is_favorited: favIds.has(rest.id),
      // Only surface the owner for lists the viewer doesn't own (others' pinned
      // lists), so the sidebar can show whose list it is — and, load-bearing,
      // because `lists-page-v2.tsx:146` splits the entire collection on
      // `Boolean(list.owner)`: this field is the *sole* key that classifies a
      // list as **Saved** rather than **Mine**, for the Saved tab and for the
      // Side by side picker's saved half. Drop it — or trim the
      // `owner:profiles!owner_id` embed it reads from out of `ownedSelect` —
      // and Saved is empty for every user, forever, with no error anywhere.
      owner: rest.owner_id === user.id ? null : ownerObj,
    } as Record<string, unknown> & { id: string }
  })

  // Attach the first few players per list so covers render without an N+1
  // fetch. Four, not three: the square rail/hero tile draws three headshots
  // beside its position label, but Lists v2's gallery band stacks the **top
  // four** (Chris, 2026-08-11). This is a cap on an existing query, not a new
  // route — every other consumer slices to three and is unaffected.
  const listIds = lists.map((l) => l.id)
  const firstPlayersByList = new Map<
    string,
    { id: string; full_name: string; team: string | null; headshot_url: string | null; position: string | null }[]
  >()
  if (listIds.length > 0) {
    const { data: lpRows, error: lpError } = await supabase
      .from('list_players')
      .select(
        'list_id, position, player:players(id, full_name, team, headshot_url, position)',
      )
      .in('list_id', listIds)
      .order('list_id', { ascending: true })
      .order('position', { ascending: true })

    if (!lpError && lpRows) {
      for (const row of lpRows) {
        const r = row as unknown as {
          list_id: string
          player: {
            id: string
            full_name: string
            team: string | null
            headshot_url: string | null
            position: string | null
          } | null
        }
        if (!r.player) continue
        const existing = firstPlayersByList.get(r.list_id) ?? []
        if (existing.length >= COVER_PLAYERS) continue
        existing.push(r.player)
        firstPlayersByList.set(r.list_id, existing)
      }
    }
  }

  const listsWithThumbs = lists.map((l) => ({
    ...l,
    first_players: firstPlayersByList.get(l.id) ?? [],
  }))

  return NextResponse.json({
    lists: listsWithThumbs,
    pagination: {
      page,
      pageSize,
      total: count ?? 0,
      hasMore: (from + lists.length) < (count ?? 0),
    },
  })
}

export async function POST(request: Request) {
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

  const parsed = createListWithCoverSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data

  // Team lists must arrive with their roster shape.
  if (input.is_team && !input.roster_settings) {
    return NextResponse.json(
      { error: 'Team lists require roster_settings.' },
      { status: 400 },
    )
  }

  // Free-tier private list cap (suspended while FREE_PRIVATE_LIST_LIMIT is null)
  if (input.is_private && FREE_PRIVATE_LIST_LIMIT !== null) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', user.id)
      .single()
    if (!profile?.is_pro) {
      const existing = await countPrivateLists(supabase, user.id)
      if (existing >= FREE_PRIVATE_LIST_LIMIT) {
        return NextResponse.json(PRIVATE_LIMIT_BODY, { status: 403 })
      }
    }
  }

  // Free-tier team cap (suspended while FREE_TEAM_LIST_LIMIT is null)
  if (input.is_team && FREE_TEAM_LIST_LIMIT !== null) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', user.id)
      .single()
    if (!profile?.is_pro) {
      const { count } = await supabase
        .from('lists')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', user.id)
        .eq('is_team', true)
        .is('deleted_at', null)
      if ((count ?? 0) >= FREE_TEAM_LIST_LIMIT) {
        return NextResponse.json(TEAM_LIMIT_BODY, { status: 403 })
      }
    }
  }

  const slug = await generateUniqueSlug(supabase, user.id, input.title)

  // ranking_mode is the source of truth. If the client sent it, derive the
  // legacy boolean pair from it. Otherwise fall back to whatever booleans the
  // legacy client sent (defaulting to a numbered/ranked list); since 191 all
  // four combinations name a mode (both = tiers without numbers).
  const rankingMode = input.ranking_mode
  const legacyFlags = rankingMode
    ? rankingModeToLegacyFlags(rankingMode)
    : {
        hide_order: input.hide_order ?? false,
        tiers_enabled: input.tiers_enabled ?? false,
      }
  const resolvedRankingMode = rankingMode ?? legacyFlagsToRankingMode(legacyFlags)

  const { data: created, error: insertError } = await supabase
    .from('lists')
    .insert({
      owner_id: user.id,
      title: input.title,
      description: input.description ?? null,
      slug,
      position_filter: input.position_filter ?? null,
      ranking_mode: resolvedRankingMode,
      hide_order: legacyFlags.hide_order,
      tiers_enabled: legacyFlags.tiers_enabled,
      is_private: input.is_private ?? false,
      is_team: input.is_team ?? false,
      // Only reference the column when actually storing a roster — keeps
      // non-team creation working before migration 015 is applied.
      ...(input.is_team ? { roster_settings: input.roster_settings } : {}),
      comments_enabled: input.comments_enabled ?? true,
      // Only named when a colour was chosen (migration 188): a create with no
      // colour — or an explicit null, which is the column's default anyway —
      // never references the column, so it works before 188 is pushed.
      ...(input.cover_color ? { cover_color: input.cover_color } : {}),
    })
    .select()
    .single()

  if (insertError || !created) {
    // Before migration 187 is pushed the database still caps private lists
    // and teams.
    if (isPrivateListCapError(insertError)) {
      return NextResponse.json(PRIVATE_LIMIT_BODY, { status: 403 })
    }
    if (isTeamListCapError(insertError)) {
      return NextResponse.json(TEAM_LIMIT_BODY, { status: 403 })
    }
    // A colour sent before migration 188 is pushed: a clear 409, not a 500.
    if (isMissingCoverColorColumn(insertError)) {
      return NextResponse.json(COVER_COLOR_UNAVAILABLE_BODY, { status: COVER_COLOR_UNAVAILABLE_STATUS })
    }
    // Tiers without numbers before migration 191 is pushed: the older CHECK
    // refuses `tier_only` — a clear 409, not a 500, and no list is made.
    if (resolvedRankingMode === 'tier_only' && isTierOnlyUnavailable(insertError)) {
      return NextResponse.json(TIER_ONLY_UNAVAILABLE_BODY, { status: TIER_ONLY_UNAVAILABLE_STATUS })
    }
    return NextResponse.json(
      { error: insertError?.message ?? 'Could not create list' },
      { status: 500 },
    )
  }

  if (input.tags && input.tags.length > 0) {
    try {
      const tagIds = await resolveTagIds(supabase, user.id, input.tags)
      await replaceTagsForList(supabase, created.id, tagIds)
    } catch (err) {
      // Tag failure shouldn't lose the list — log but return success.
      console.error('Tag attach failed', err)
    }
  }

  return NextResponse.json(created, { status: 201 })
}
