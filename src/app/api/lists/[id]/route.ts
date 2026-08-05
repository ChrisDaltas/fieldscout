import { NextResponse } from 'next/server'

import {
  countPrivateLists,
  FREE_PRIVATE_LIST_LIMIT,
  replaceTagsForList,
  resolveTagIds,
} from '@/lib/lists/helpers'
import { aggregateFantasyStats } from '@/lib/stats/aggregate-fantasy'
import { createServerClient } from '@/lib/supabase/server'
import { rankingModeToLegacyFlags, updateListSchema } from '@/types/schemas/lists'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser()

  const { data: list, error: listError } = await supabase
    .from('lists')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 })
  }
  if (!list) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }

  // Per-viewer is_favorited from the junction; defaults to false for guests.
  let viewerFavorited = false
  if (viewer) {
    const { data: favRow } = await supabase
      .from('list_favorites')
      .select('user_id')
      .eq('user_id', viewer.id)
      .eq('list_id', id)
      .maybeSingle()
    viewerFavorited = Boolean(favRow)
  }

  const [{ data: players, error: playersError }, { data: tags, error: tagsError }] =
    await Promise.all([
      supabase
        .from('list_players')
        // `*` (rather than an explicit column list) so the response includes
        // `slot` once migration 015 lands without 500ing before it does.
        .select(
          `*, player:players(id, full_name, position, team, headshot_url, status, adp)`,
        )
        .eq('list_id', id)
        .order('position', { ascending: true }),
      supabase
        .from('list_tags')
        .select('tag:tags(id, name, slug, is_system_tag)')
        .eq('list_id', id),
    ])

  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 })
  }
  if (tagsError) {
    return NextResponse.json({ error: tagsError.message }, { status: 500 })
  }

  const flatTags = (tags ?? [])
    .map((row) => row.tag)
    .filter((t): t is NonNullable<typeof t> => Boolean(t))

  const playerRows = players ?? []
  const playerIds = playerRows
    .map((row) => row.player_id as string)
    .filter(Boolean)

  let statsByPlayer: Awaited<ReturnType<typeof aggregateFantasyStats>> = new Map()
  try {
    statsByPlayer = await aggregateFantasyStats(supabase, playerIds, 'ppr')
  } catch (err) {
    // Stats are nice-to-have for the list view — never block the list from
    // loading if the stats query fails.
    console.error('aggregateFantasyStats failed', err)
  }

  const enrichedPlayers = playerRows.map((row) => ({
    ...row,
    stats: statsByPlayer.get(row.player_id as string) ?? null,
  }))

  return NextResponse.json({
    ...list,
    // Server-authoritative ownership so the client never has to derive it from
    // a racy client-side auth session (which made the owner-only sidebar and
    // Delete action flicker/disappear while auth was still resolving).
    is_owner: Boolean(viewer && viewer.id === list.owner_id),
    is_favorited: viewerFavorited,
    players: enrichedPlayers,
    tags: flatTags,
  })
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updateListSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('lists')
    .select('id, owner_id, is_big_board, slug, title, is_private')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const input = parsed.data
  const isBigBoard = existing.is_big_board

  // Big Board: cannot rename, cannot make private, slug is permanent.
  if (isBigBoard) {
    if (input.title !== undefined && input.title !== existing.title) {
      return NextResponse.json(
        { error: 'The Big Board cannot be renamed.' },
        { status: 400 },
      )
    }
    if (input.is_private === true) {
      return NextResponse.json(
        { error: 'The Big Board is always public.' },
        { status: 400 },
      )
    }
    if (
      input.hide_order === true ||
      input.ranking_mode === 'unranked'
    ) {
      return NextResponse.json(
        { error: 'The Big Board is always ranked.' },
        { status: 400 },
      )
    }
  }

  // Free tier: enforce 1-private-list cap on transitions to is_private=true
  if (input.is_private === true && !existing.is_private) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_pro')
      .eq('id', user.id)
      .single()
    if (!profile?.is_pro) {
      const count = await countPrivateLists(supabase, user.id, id)
      if (count >= FREE_PRIVATE_LIST_LIMIT) {
        return NextResponse.json(
          {
            error:
              'Free accounts can have one private list. Upgrade to Pro for unlimited private lists.',
            code: 'PRIVATE_LIMIT_REACHED',
          },
          { status: 403 },
        )
      }
    }
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.title !== undefined && !isBigBoard) {
    updates.title = input.title
    // The slug is deliberately NOT regenerated. It is set once at creation and
    // is the list's permanent identity: /u/{username}/lists/{slug} is what
    // people paste into group chats. Regenerating it on rename silently 404'd
    // every link already shared — verified in production, 2026-08-05 — with no
    // redirect and no warning. The title is free to change above it.
  }
  if (input.description !== undefined) updates.description = input.description
  if (input.position_filter !== undefined) updates.position_filter = input.position_filter
  if (input.is_private !== undefined && !isBigBoard) updates.is_private = input.is_private

  // ranking_mode is the source of truth — if the client sent it, derive the
  // legacy boolean pair from it. Otherwise honor the individual legacy flags.
  if (input.ranking_mode !== undefined && !isBigBoard) {
    const flags = rankingModeToLegacyFlags(input.ranking_mode)
    updates.ranking_mode = input.ranking_mode
    updates.hide_order = flags.hide_order
    updates.tiers_enabled = flags.tiers_enabled
  } else {
    if (input.hide_order !== undefined && !isBigBoard) updates.hide_order = input.hide_order
    if (input.tiers_enabled !== undefined) updates.tiers_enabled = input.tiers_enabled
  }

  if (input.comments_enabled !== undefined) updates.comments_enabled = input.comments_enabled
  if (input.roster_settings !== undefined) updates.roster_settings = input.roster_settings

  // Folder moves — the target folder must exist and belong to the caller.
  if (input.folder_id !== undefined) {
    if (input.folder_id !== null) {
      const { data: folder } = await supabase
        .from('list_folders')
        .select('id, owner_id')
        .eq('id', input.folder_id)
        .maybeSingle()
      if (!folder || folder.owner_id !== user.id) {
        return NextResponse.json({ error: 'Folder not found' }, { status: 404 })
      }
    }
    updates.folder_id = input.folder_id
  }

  const { data: updated, error: updateError } = await supabase
    .from('lists')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  if (input.tags) {
    try {
      const tagIds = await resolveTagIds(supabase, user.id, input.tags)
      await replaceTagsForList(supabase, id, tagIds)
    } catch (err) {
      console.error('Tag replace failed', err)
    }
  }

  return NextResponse.json(updated)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('lists')
    .select('id, owner_id, is_big_board')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }
  if (!existing) {
    return NextResponse.json({ error: 'List not found' }, { status: 404 })
  }
  if (existing.owner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (existing.is_big_board) {
    return NextResponse.json(
      { error: 'The Big Board cannot be deleted.' },
      { status: 400 },
    )
  }

  const { error: deleteError } = await supabase
    .from('lists')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
