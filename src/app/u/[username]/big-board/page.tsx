import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import {
  PublicBigBoard,
  type PublicBigBoardPlayer,
} from '@/components/big-board/public-big-board'
import { createServerClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ username: string }>
}

interface PlayerJoin {
  id: string
  full_name: string
  position: string
  team: string | null
  headshot_url: string | null
  projected_pts_ppr: number | null
}

interface ListPlayerRow {
  player_id: string
  position: number
  player: PlayerJoin | PlayerJoin[] | null
}

async function loadSeasonBigBoard(username: string) {
  const supabase = await createServerClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  const { data: list } = await supabase
    .from('lists')
    .select('id, title, updated_at, player_count')
    .eq('owner_id', profile.id)
    .eq('is_big_board', true)
    .is('deleted_at', null)
    .maybeSingle()
  if (!list) return { profile, list: null, players: [] as PublicBigBoardPlayer[] }

  const { data: rows } = await supabase
    .from('list_players')
    .select(
      `player_id, position,
       player:players(id, full_name, position, team, headshot_url, projected_pts_ppr)`,
    )
    .eq('list_id', list.id)
    .order('position', { ascending: true })

  const players = ((rows ?? []) as unknown as ListPlayerRow[]).map((row) => {
    const p = Array.isArray(row.player) ? row.player[0] : row.player
    return {
      player_id: row.player_id,
      position: row.position,
      full_name: p?.full_name ?? '',
      position_code: p?.position ?? '',
      team: p?.team ?? null,
      headshot_url: p?.headshot_url ?? null,
      projected_pts: p?.projected_pts_ppr ?? null,
    }
  })

  return { profile, list, players }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params
  const data = await loadSeasonBigBoard(username)
  if (!data) return { title: 'Big Board not found' }
  const handle = data.profile.display_name ?? `@${data.profile.username}`
  const title = `${handle}'s Big Board · FieldScout`
  const description = `${handle}'s season-long player rankings on FieldScout.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function PublicSeasonBigBoardPage({ params }: PageProps) {
  const { username } = await params
  const data = await loadSeasonBigBoard(username)
  if (!data) notFound()

  const handle = data.profile.display_name ?? `@${data.profile.username}`
  const subtitle = data.list
    ? `${data.players.length} players · updated ${new Date(
        data.list.updated_at,
      ).toLocaleDateString()}`
    : 'No big board yet.'

  return (
    <GuestShell>
      <div className="mx-auto max-w-7xl">
        <PublicBigBoard
          title={`${handle}'s big board`}
          subtitle={subtitle}
          players={data.players}
          emptyMessage="This user hasn't built their big board yet."
        />
      </div>
    </GuestShell>
  )
}
