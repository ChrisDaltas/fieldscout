import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import {
  PublicBigBoard,
  PublicWeekStrip,
  type PublicBigBoardPlayer,
} from '@/components/big-board/public-big-board'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ username: string; week: string }>
}

const SEASON = Number(process.env.NEXT_PUBLIC_NFL_SEASON ?? 2026)

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

async function loadWeeklyBigBoard(username: string, week: number) {
  // Profile lookup uses the regular anon client — profiles are publicly
  // readable.
  const supabase = await createServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  // big_board_weekly is owner-only by spec; the admin client lets the public
  // page resolve which list backs Week N for this user. The list itself is
  // publicly readable, so no admin escalation is needed once we have the id.
  const admin = createAdminClient()
  const { data: weekly } = await admin
    .from('big_board_weekly')
    .select('list_id')
    .eq('user_id', profile.id)
    .eq('season', SEASON)
    .eq('week_number', week)
    .maybeSingle()

  if (!weekly) {
    return { profile, list: null, players: [] as PublicBigBoardPlayer[] }
  }

  const [listRes, rowsRes] = await Promise.all([
    supabase
      .from('lists')
      .select('id, title, updated_at, player_count')
      .eq('id', weekly.list_id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('list_players')
      .select(
        `player_id, position,
         player:players(id, full_name, position, team, headshot_url, projected_pts_ppr)`,
      )
      .eq('list_id', weekly.list_id)
      .order('position', { ascending: true }),
  ])

  const players = ((rowsRes.data ?? []) as unknown as ListPlayerRow[]).map(
    (row) => {
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
    },
  )

  return { profile, list: listRes.data ?? null, players }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username, week } = await params
  const weekNum = Number(week)
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 18) {
    return { title: 'Big Board not found' }
  }
  const data = await loadWeeklyBigBoard(username, weekNum)
  if (!data) return { title: 'Big Board not found' }
  const handle = data.profile.display_name ?? `@${data.profile.username}`
  const title = `${handle}'s Week ${weekNum} Big Board · FieldScout`
  const description = `${handle}'s Week ${weekNum} player rankings on FieldScout.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function PublicWeeklyBigBoardPage({ params }: PageProps) {
  const { username, week } = await params
  const weekNum = Number(week)
  if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 18) notFound()

  const data = await loadWeeklyBigBoard(username, weekNum)
  if (!data) notFound()

  const handle = data.profile.display_name ?? `@${data.profile.username}`
  const subtitle = data.list
    ? `${data.players.length} players · updated ${new Date(
        data.list.updated_at,
      ).toLocaleDateString()}`
    : 'This week is not yet started.'

  return (
    <GuestShell>
      <div className="mx-auto max-w-7xl">
        <PublicBigBoard
          title={`${handle}'s Week ${weekNum} Big Board`}
          subtitle={subtitle}
          players={data.players}
          emptyMessage="This user hasn't set their Week's Big Board yet."
          weekNav={
            <PublicWeekStrip
              username={data.profile.username}
              currentSelected={weekNum}
            />
          }
        />
      </div>
    </GuestShell>
  )
}
