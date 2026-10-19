import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { ByLayout } from '@/components/mobile/by-layout'
import { MobileNflTeam } from '@/components/mobile/nfl/mobile-nfl'
import { TeamRoster, type RosterPlayer } from '@/components/teams/team-roster'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { getTeamColors } from '@/lib/nfl-team-colors'
import { getNflTeam, type NflTeamInfo } from '@/lib/nfl-teams'
import { createServerClient } from '@/lib/supabase/server'

interface NflTeamPageProps {
  params: Promise<{ team: string }>
}

export async function generateMetadata({ params }: NflTeamPageProps) {
  const { team } = await params
  const info = getNflTeam(team)
  return {
    title: info ? `${info.city} ${info.name} · FieldScout` : 'NFL team · FieldScout',
  }
}

export default async function NflTeamPage({ params }: NflTeamPageProps) {
  const { team } = await params
  const info = getNflTeam(team)
  if (!info) notFound()

  const supabase = await createServerClient()
  const { data: players, error } = await supabase
    .from('players')
    .select(
      'id, full_name, position, team, headshot_url, status, jersey_number, adp, bye_week',
    )
    .eq('team', info.abbr)
    .order('adp', { ascending: true, nullsFirst: false })

  if (error) {
    throw new Error(error.message)
  }

  const roster = (players ?? []) as RosterPlayer[]
  // The bye week lives on player rows, not a teams table — read it off any
  // roster member.
  const byeWeek = roster.find((p) => p.bye_week != null)?.bye_week ?? null

  // The phone draws its own screen on the same read (`MobileNflTeam`, gap
  // list §4 item 103); desktop is unchanged.
  return (
    <ByLayout
      desktop={<DesktopNflTeam info={info} roster={roster} byeWeek={byeWeek} />}
      mobile={<MobileNflTeam team={info} roster={roster} byeWeek={byeWeek} />}
    />
  )
}

function DesktopNflTeam({
  info,
  roster,
  byeWeek,
}: {
  info: NflTeamInfo
  roster: RosterPlayer[]
  byeWeek: number | null
}) {
  const colors = getTeamColors(info.abbr)
  return (
    <div className="space-y-[19px]">
      {/* The app's standard header (D486(12) audit): title + a ghost back
          action, the player page's pattern — not an in-page back link. */}
      <PageHeader
        title="NFL teams"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/app/nfl">
              <Icon name="arrow-prev" size={13} />
              All teams
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <span
            className="flex h-[51px] w-[51px] shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white"
            style={{ backgroundColor: colors.primary }}
          >
            {info.abbr}
          </span>
          <div className="min-w-0">
            <h1 className="text-[20px] font-bold tracking-[-0.03em] text-ink">
              {info.city} {info.name}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold text-n-6">
              <span>
                {info.conference} {info.division}
              </span>
              <span aria-hidden>·</span>
              <span>
                <span className="fs-num">{roster.length}</span> fantasy player
                {roster.length === 1 ? '' : 's'}
              </span>
              {byeWeek != null && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Bye week <span className="fs-num">{byeWeek}</span>
                  </span>
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      <TeamRoster players={roster} />
    </div>
  )
}
