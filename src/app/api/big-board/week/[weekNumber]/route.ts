import { NextResponse } from 'next/server'

import { createServerClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

interface RouteParams {
  params: Promise<{ weekNumber: string }>
}

const SEASON = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

const PLAYER_SELECT =
  `id, player_id, position, tier, rank_in_tier, overall_rank, notes, added_at,
   player:players(id, full_name, position, team, headshot_url, status, adp, projected_pts_ppr)`

async function fetchPlayers(supabase: SupabaseClient, listId: string) {
  return supabase
    .from('list_players')
    .select(PLAYER_SELECT)
    .eq('list_id', listId)
    .order('position', { ascending: true })
}

/**
 * Resolve the source list to copy from when first creating a weekly board:
 *   week N → most recent prior weekly (N-1, N-2, …)
 *   week 1 (or no prior weekly) → season-long Big Board
 *
 * PRD F2A: "Each week's Big Board defaults to carrying over from the previous
 * week's Big Board, not from the season-long. Week 1 is the one exception."
 */
async function resolveCarryoverListId(
  supabase: SupabaseClient,
  userId: string,
  week: number,
): Promise<string | null> {
  if (week > 1) {
    const { data: priorWeekly } = await supabase
      .from('big_board_weekly')
      .select('list_id, week_number')
      .eq('user_id', userId)
      .eq('season', SEASON)
      .lt('week_number', week)
      .order('week_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (priorWeekly) return priorWeekly.list_id
  }
  const { data: season } = await supabase
    .from('lists')
    .select('id')
    .eq('owner_id', userId)
    .eq('is_big_board', true)
    .is('deleted_at', null)
    .maybeSingle()
  return season?.id ?? null
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { weekNumber } = await params
  const week = Number(weekNumber)
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 })
  }

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Existing weekly?
  const { data: existing, error: existingError } = await supabase
    .from('big_board_weekly')
    .select('id, list_id, week_number, season, created_at')
    .eq('user_id', user.id)
    .eq('season', SEASON)
    .eq('week_number', week)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 })
  }

  let listId: string
  let createdNow = false
  if (existing) {
    listId = existing.list_id
  } else {
    // Create a fresh list and seed from the carryover source.
    const sourceListId = await resolveCarryoverListId(supabase, user.id, week)
    const title = `Week ${week} Big Board`
    const slug = `week-${week}-big-board-${Date.now()}`
    const { data: createdList, error: listError } = await supabase
      .from('lists')
      .insert({
        owner_id: user.id,
        title,
        slug,
        is_big_board: false,
        is_private: false,
        comments_enabled: true,
      })
      .select('id')
      .single()
    if (listError || !createdList) {
      return NextResponse.json(
        { error: listError?.message ?? 'Could not create weekly list' },
        { status: 500 },
      )
    }
    listId = createdList.id

    if (sourceListId) {
      const { data: sourceRows, error: sourceError } = await supabase
        .from('list_players')
        .select('player_id, position, overall_rank')
        .eq('list_id', sourceListId)
        .order('position', { ascending: true })
      if (sourceError) {
        return NextResponse.json({ error: sourceError.message }, { status: 500 })
      }
      const seedRows = (sourceRows ?? []).map((row, i) => ({
        list_id: listId,
        player_id: row.player_id,
        position: i + 1,
        overall_rank: i + 1,
      }))
      if (seedRows.length > 0) {
        const { error: insError } = await supabase
          .from('list_players')
          .insert(seedRows)
        if (insError) {
          return NextResponse.json({ error: insError.message }, { status: 500 })
        }
      }
    }

    const { error: weeklyError } = await supabase
      .from('big_board_weekly')
      .insert({
        user_id: user.id,
        week_number: week,
        season: SEASON,
        list_id: listId,
      })
    if (weeklyError) {
      return NextResponse.json({ error: weeklyError.message }, { status: 500 })
    }
    createdNow = true
  }

  const [{ data: list, error: listFetchError }, playersRes] = await Promise.all([
    supabase.from('lists').select('*').eq('id', listId).single(),
    fetchPlayers(supabase, listId),
  ])
  if (listFetchError) {
    return NextResponse.json({ error: listFetchError.message }, { status: 500 })
  }
  if (playersRes.error) {
    return NextResponse.json({ error: playersRes.error.message }, { status: 500 })
  }

  return NextResponse.json({
    week,
    season: SEASON,
    list,
    players: playersRes.data ?? [],
    created: createdNow,
  })
}
