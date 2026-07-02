import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { TeamRoster, type RosterPlayer } from '@/components/teams/team-roster'
import { getTeamColors, teamTintBackground } from '@/lib/nfl-team-colors'
import { getNflTeam } from '@/lib/nfl-teams'
import { createServerClient } from '@/lib/supabase/server'

interface NflTeamPageProps {
  params: Promise<{ team: string }>
}

export async function generateMetadata({ params }: NflTeamPageProps) {
  const { team } = await params
  const info = getNflTeam(team)
  return {
    title: info ? `${info.city} ${info.name} · FieldScout` : 'NFL Team · FieldScout',
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

  const roster = (players ?? []) as (RosterPlayer & { bye_week: number | null })[]
  const colors = getTeamColors(info.abbr)
  // The bye week lives on player rows, not a teams table — read it off any
  // roster member.
  const byeWeek = roster.find((p) => p.bye_week != null)?.bye_week ?? null

  return (
    <div className="space-y-6">
      <Link
        href="/app/nfl"
        className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All teams
      </Link>

      <header
        className="flex flex-wrap items-center gap-4 rounded-lg border border-bg-elevated-2 p-5 sm:gap-5 sm:p-6"
        style={{
          background: `linear-gradient(135deg, ${teamTintBackground(info.abbr, 0.35)}, transparent 70%)`,
        }}
      >
        <span
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white sm:h-20 sm:w-20"
          style={{
            backgroundColor: colors.primary,
            boxShadow: `0 0 0 3px ${colors.secondary}`,
          }}
        >
          {info.abbr}
        </span>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
            {info.city} {info.name}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
            <span>
              {info.conference} {info.division}
            </span>
            <span>·</span>
            <span>
              {roster.length} fantasy player{roster.length === 1 ? '' : 's'}
            </span>
            {byeWeek != null && (
              <>
                <span>·</span>
                <span>Bye Week {byeWeek}</span>
              </>
            )}
          </p>
        </div>
      </header>

      <TeamRoster players={roster} />
    </div>
  )
}
