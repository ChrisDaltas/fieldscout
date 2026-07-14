'use client'

import Link from 'next/link'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { toast } from '@/hooks/use-toast'

/**
 * "Your leagues" — one card per league membership (package screen 01): head
 * row with square crest + team/league names + place badge, 4-stat strip with
 * hairline dividers, matchup footer with mono score + win-prob chip + Open.
 *
 * TODO(live-draft): the league backend doesn't exist. Everything below
 * renders clearly-marked mock data so the hub layout is real; swap
 * MOCK_LEAGUES for the live memberships hook when leagues land, and point
 * the entity links / Open button at the league workspace routes.
 */

interface MockLeague {
  id: string
  name: string
  team: string
  teamInitials: string
  record: string
  rank: number
  pf: number
  pa: number
  playoff: number
  proj: number
  opp: string
  oppInitials: string
  oppProj: number
  winProb: number
}

// TODO(live-draft): mock memberships — replace with real league data.
const MOCK_LEAGUES: MockLeague[] = [
  {
    id: 'log',
    name: 'League of Ordinary Gentlemen',
    team: 'Gridiron Gurus',
    teamInitials: 'GG',
    record: '8–2',
    rank: 1,
    pf: 1284,
    pa: 1102,
    playoff: 96,
    proj: 132.4,
    opp: 'The Audibles',
    oppInitials: 'TA',
    oppProj: 118.9,
    winProb: 71,
  },
  {
    id: 'din',
    name: 'Dynasty Degenerates',
    team: 'Check Downs',
    teamInitials: 'CD',
    record: '6–4',
    rank: 3,
    pf: 1156,
    pa: 1140,
    playoff: 64,
    proj: 121.0,
    opp: 'Air Raid',
    oppInitials: 'AR',
    oppProj: 127.6,
    winProb: 44,
  },
  {
    id: 'wrk',
    name: 'The Work League',
    team: 'Cubicle Kings',
    teamInitials: 'CK',
    record: '9–1',
    rank: 1,
    pf: 1330,
    pa: 1044,
    playoff: 99,
    proj: 140.1,
    opp: 'Lambeau Leapers',
    oppInitials: 'LL',
    oppProj: 109.8,
    winProb: 78,
  },
]

function ordinal(n: number): string {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

/** Team/league name link into the league workspace. */
function EntityLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={`truncate text-left hover:underline hover:decoration-2 hover:underline-offset-2 focus-visible:underline focus:outline-none ${className ?? ''}`}
    >
      {children}
    </Link>
  )
}

function LeagueCard({ league }: { league: MockLeague }) {
  const winning = league.proj >= league.oppProj
  const href = `/app/leagues/${league.id}`
  const stats: Array<[label: string, value: string]> = [
    ['Record', league.record],
    ['Points for', league.pf.toLocaleString()],
    ['Points against', league.pa.toLocaleString()],
    ['Playoff odds', `${league.playoff}%`],
  ]

  return (
    <Card className="overflow-hidden">
      {/* Head row */}
      <div className="flex items-center gap-2.5 border-b border-ink px-[13px] py-2.5">
        <Avatar className="h-8 w-8">
          <AvatarFallback>{league.teamInitials}</AvatarFallback>
        </Avatar>
        <div className="mr-auto flex min-w-0 flex-col">
          <EntityLink
            href={href}
            className="text-[12px] font-extrabold leading-tight"
          >
            {league.team}
          </EntityLink>
          <EntityLink
            href={href}
            className="text-[10px] font-semibold leading-tight text-n-3"
          >
            {league.name}
          </EntityLink>
        </div>
        <Badge variant={league.rank === 1 ? 'green' : 'stroke'}>
          {ordinal(league.rank)} place
        </Badge>
      </div>

      {/* 4-stat strip */}
      <div className="grid grid-cols-4 border-b border-ink">
        {stats.map(([label, value], i) => (
          <div
            key={label}
            className={`min-w-0 px-2.5 py-2 ${i > 0 ? 'border-l border-n-4' : ''}`}
          >
            <div className="truncate text-[10px] font-medium tracking-[0.01em] text-n-3">
              {label}
            </div>
            <div className="fs-num mt-0.5 truncate text-[14px] font-extrabold">
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Matchup footer */}
      <div className="flex items-center gap-2.5 px-[13px] py-2.5">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="text-[10px] font-medium tracking-[0.01em] text-n-3">
              This week vs
            </span>
            <Avatar className="h-4 w-4">
              <AvatarFallback className="text-[7px]">
                {league.oppInitials}
              </AvatarFallback>
            </Avatar>
            <EntityLink href={href} className="text-[10px] font-extrabold">
              {league.opp}
            </EntityLink>
          </div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="fs-num text-[18px] font-extrabold">
              {league.proj.toFixed(1)}
            </span>
            <span className="text-[10px] font-bold text-n-3">vs</span>
            <span className="fs-num text-[13px] font-extrabold text-n-3">
              {league.oppProj.toFixed(1)}
            </span>
          </div>
        </div>
        <Badge variant={winning ? 'green' : 'yellow'}>
          {winning ? 'Win' : 'Toss-up'} prob{' '}
          <span className="fs-num">{league.winProb}%</span>
        </Badge>
        <Button variant="stroke" size="sm" asChild>
          <Link href={href}>
            Open
            <Icon name="arrow-next" />
          </Link>
        </Button>
      </div>
    </Card>
  )
}

export function YourLeagues() {
  return (
    <section>
      <div className="mb-2.5 flex items-center">
        <h2 className="mr-auto text-h5">Your leagues</h2>
        <Button
          variant="stroke"
          size="sm"
          onClick={() =>
            // TODO(live-draft): joining a league needs the league backend.
            toast({
              title: 'Join a league',
              description:
                'Ask your commissioner for an invite code to join a league.',
            })
          }
        >
          <Icon name="plus" />
          Join league
        </Button>
      </div>
      <div className="flex flex-col gap-[13px]">
        {MOCK_LEAGUES.map((league) => (
          <LeagueCard key={league.id} league={league} />
        ))}
      </div>
    </section>
  )
}
