import { NextResponse } from 'next/server'
import { z } from 'zod'

import { createServerClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

// The Favorites list — a per-user default "quick save" list (is_favorites),
// the fast way to save players without building a list by hand. GET returns
// the favorited player ids (for the players-table pin state); POST toggles a
// player in/out, auto-creating the list on first use.

async function findFavoritesList(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('lists')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('is_favorites', true)
    .is('deleted_at', null)
    .maybeSingle()
  return data?.id ?? null
}

async function getOrCreateFavoritesList(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<string> {
  const existing = await findFavoritesList(supabase, ownerId)
  if (existing) return existing

  const { data, error } = await supabase
    .from('lists')
    .insert({
      owner_id: ownerId,
      title: 'Favorites',
      slug: 'favorites',
      is_favorites: true,
      // A personal quick-save stash: private, and exempt from the free-tier
      // private-list cap (migration 028).
      is_private: true,
      // A save bucket, not a ranking: newest saves sit on top, no tier UI.
      ranking_mode: 'unranked',
      hide_order: true,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data.id
}

export async function GET() {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const listId = await findFavoritesList(supabase, user.id)
  if (!listId) {
    return NextResponse.json({ listId: null, playerIds: [] })
  }

  const { data, error } = await supabase
    .from('list_players')
    .select('player_id')
    .eq('list_id', listId)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    listId,
    playerIds: (data ?? []).map((r) => r.player_id as string),
  })
}

// Player ids are Sleeper text ids (e.g. "5859"), not UUIDs.
const toggleSchema = z.object({ player_id: z.string().min(1).max(64) })

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = toggleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const playerId = parsed.data.player_id

  let listId: string
  try {
    listId = await getOrCreateFavoritesList(supabase, user.id)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not open favorites' },
      { status: 500 },
    )
  }

  const { data: existing } = await supabase
    .from('list_players')
    .select('id')
    .eq('list_id', listId)
    .eq('player_id', playerId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('list_players')
      .delete()
      .eq('id', existing.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ favorited: false, listId })
  }

  // Append at the end (position = current max + 1). player_count is kept by a
  // DB trigger, so we don't touch it here.
  const { data: last } = await supabase
    .from('list_players')
    .select('position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const position = (last?.position ?? 0) + 1

  const { error } = await supabase.from('list_players').insert({
    list_id: listId,
    player_id: playerId,
    position,
    overall_rank: position,
  })
  if (error) {
    // Unique (list_id, player_id) violation → already favorited; treat as on.
    if (error.code === '23505') {
      return NextResponse.json({ favorited: true, listId })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ favorited: true, listId })
}
