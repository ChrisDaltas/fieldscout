import type { SupabaseClient } from '@supabase/supabase-js'

import { rankByVorp, type VorpPosition } from '@/lib/scoring/vorp'

/**
 * Insert the given player IDs as Big Board entries starting at position 1.
 * Caller should only invoke when the list is currently empty.
 */
export async function seedListPlayers(
  supabase: SupabaseClient,
  listId: string,
  playerIds: string[],
): Promise<number> {
  if (playerIds.length === 0) return 0
  const rows = playerIds.map((player_id, i) => ({
    list_id: listId,
    player_id,
    position: i + 1,
    overall_rank: i + 1,
  }))
  const { error } = await supabase.from('list_players').insert(rows)
  if (error) throw error
  return rows.length
}

/**
 * Pick the top-N fantasy players for the upcoming season ranked by VORP,
 * not raw projected points. This is the rank that actually reflects how
 * the players are valued: scarcity at RB/WR pushes them above many QBs
 * even when QB projections are higher in absolute terms.
 *
 * Falls back to last-season totals only for players Sleeper hasn't
 * projected yet — better than dropping them, and they'll naturally sort
 * below projected players because their VORP is computed against the
 * same positional replacement value.
 */
export async function pickTopPlayersByVorp(
  supabase: SupabaseClient,
  limit: number,
): Promise<string[]> {
  const all: Array<{
    id: string
    position: string
    projected_pts_ppr: number | null
  }> = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('players')
      .select('id, position, projected_pts_ppr')
      .not('team', 'is', null)
      .in('position', ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      all.push(row as typeof all[number])
    }
    if (data.length < pageSize) break
    offset += pageSize
  }

  const ranked = rankByVorp(
    all.map((p) => ({
      id: p.id,
      position: p.position as VorpPosition,
      projected_pts:
        typeof p.projected_pts_ppr === 'number' ? p.projected_pts_ppr : null,
    })),
  )
  return ranked.slice(0, limit).map((r) => r.id)
}

/**
 * Top up an existing Big Board to the desired size by appending VORP-ranked
 * players that aren't already on the list. Idempotent: if the board is
 * already at or above `targetSize`, does nothing. Used for the F2A
 * migration from the old 50-player default to the new 300-player default
 * — existing users get expanded without losing their hand-tuned order.
 */
export async function topUpBigBoardToSize(
  supabase: SupabaseClient,
  listId: string,
  targetSize: number,
): Promise<number> {
  const { data: existing } = await supabase
    .from('list_players')
    .select('player_id, position')
    .eq('list_id', listId)
    .order('position', { ascending: false })
    .limit(1)
  const currentMax = existing?.[0]?.position ?? 0
  if (currentMax >= targetSize) return 0

  const existingIds = new Set<string>()
  let offset = 0
  while (true) {
    const { data } = await supabase
      .from('list_players')
      .select('player_id')
      .eq('list_id', listId)
      .range(offset, offset + 999)
    if (!data || data.length === 0) break
    for (const r of data) existingIds.add(r.player_id as string)
    if (data.length < 1000) break
    offset += 1000
  }

  const ranked = await pickTopPlayersByVorp(supabase, targetSize * 2)
  const additions = ranked
    .filter((id) => !existingIds.has(id))
    .slice(0, targetSize - currentMax)

  if (additions.length === 0) return 0
  const rows = additions.map((player_id, i) => ({
    list_id: listId,
    player_id,
    position: currentMax + i + 1,
    overall_rank: currentMax + i + 1,
  }))
  const { error } = await supabase.from('list_players').insert(rows)
  if (error) throw error
  return rows.length
}
