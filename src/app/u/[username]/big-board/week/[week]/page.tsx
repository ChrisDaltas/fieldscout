import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { GuestShell } from '@/components/layout/guest-shell'
import {
  PublicBigBoard,
  PublicWeekStrip,
  type PublicBigBoardPlayer,
} from '@/components/big-board/public-big-board'
import { WEEKLY_BOARD_PATTERN } from '@/components/mobile/community/community-ops'
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

type ServerSupabase = Awaited<ReturnType<typeof createServerClient>>

async function resolveWeeklyListId(
  supabase: ServerSupabase,
  ownerId: string,
  week: number,
): Promise<{ list_id: string } | null> {
  const { data: own, error: ownError } = await supabase
    .from('big_board_weekly')
    .select('list_id')
    .eq('user_id', ownerId)
    .eq('season', SEASON)
    .eq('week_number', week)
    .maybeSingle()
  if (ownError) throw new Error(`weekly big board: ${ownError.message}`)
  if (own) return own

  // The pattern's week group pinned to this week (group 1 of the shared one).
  const thisWeek = WEEKLY_BOARD_PATTERN.replace('([0-9]+)', String(week))
  const { data: byslug, error: slugError } = await supabase
    .from('lists')
    .select('id')
    .eq('owner_id', ownerId)
    .is('deleted_at', null)
    .filter('slug', 'match', thisWeek)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (slugError) throw new Error(`weekly big board: ${slugError.message}`)
  return byslug ? { list_id: byslug.id } : null
}

async function loadWeeklyBigBoard(username: string, week: number) {
  // Profile lookup uses the regular anon client — profiles are publicly
  // readable.
  const supabase = await createServerClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .eq('username', username)
    .maybeSingle()
  if (!profile) return null

  // Which list backs Week N. `big_board_weekly` is owner-only, so the
  // visitor's own client reads it: the owner sees his exact row. Anyone else
  // finds the week by the board's permanent slug (`week-<n>-big-board-<ts>`,
  // WEEKLY_BOARD_PATTERN — what a viewer can read), through `lists` RLS, so a
  // private board stays invisible and nothing reveals that it exists. No
  // service role (M7 L.F2.8, F722).
  const weekly = await resolveWeeklyListId(supabase, profile.id, week)

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
  const handle = `@${data.profile.username}`
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

  const handle = `@${data.profile.username}`
  const subtitle = data.list
    ? `${data.players.length} players · updated ${new Date(
        data.list.updated_at,
      ).toLocaleDateString()}`
    : 'This week is not yet started.'

  return (
    <GuestShell>
      <div className="mx-auto max-w-7xl">
        <PublicBigBoard
          title={`${handle}'s week ${weekNum} big board`}
          subtitle={subtitle}
          players={data.players}
          emptyMessage="This user hasn't set this week's big board yet."
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
