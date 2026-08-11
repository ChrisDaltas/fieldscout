'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { PageHeader } from '@/components/layout/app-header'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import { PlayerDetailHeader } from '@/components/players/player-detail-header'
import {
  BioPanel,
  GameLogPanel,
  OverviewPanel,
  StatsPanel,
} from '@/components/players/player-detail-panels'
import { AIInsight } from '@/components/ui/ai-insight'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useLeagues } from '@/hooks/use-leagues'
import {
  usePlayerStats,
  type PlayerStatsResponse,
} from '@/hooks/use-player-stats'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

interface PlayerDetailPageViewProps {
  playerId: string
}

/**
 * Full player page — Field Scout reskin of the kit's PlayerPage: breadcrumb
 * header, hero identity card with the "Your leagues" column, Scout AI band,
 * then the boxed tab set.
 */
export function PlayerDetailPageView({ playerId }: PlayerDetailPageViewProps) {
  const { data, isLoading, error } = usePlayerStats(playerId)
  const router = useRouter()

  const pageHeader = (
    <PageHeader
      title={
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back"
            onClick={() => router.back()}
          >
            <Icon name="arrow-prev" size={14} />
          </Button>
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold"
          >
            <Link
              href="/app/research"
              className="shrink-0 text-n-3 transition-colors hover:text-ink"
            >
              Players
            </Link>
            <span className="text-n-3">/</span>
            <span className="truncate text-ink">
              {data?.player.full_name ?? '…'}
            </span>
          </nav>
        </div>
      }
    />
  )

  if (isLoading) {
    return (
      <div className="max-w-[944px] space-y-4">
        {pageHeader}
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="max-w-[944px] space-y-4">
        {pageHeader}
        <Card className="p-card-pad">
          <p className="text-h6">Player not found</p>
          <p className="mt-1 text-[13px] font-medium text-negative-strong">
            {error?.message ?? 'This player may have moved or been removed.'}
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-[944px] space-y-4">
      {pageHeader}

      {/* Hero — identity left, leagues + actions right */}
      <Card>
        <div className="flex flex-col gap-6 p-card-pad sm:p-5 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1">
            <PlayerDetailHeader player={data.player} size="expanded" />
          </div>
          <YourLeaguesColumn data={data} />
        </div>
      </Card>

      <ScoutInsight data={data} />

      {/* Tab set — boxed triggers on the card's head row */}
      <Card>
        <Tabs defaultValue="overview">
          <div className="border-b border-ink px-card-pad py-3">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="stats">Stats</TabsTrigger>
              <TabsTrigger value="log">Game log</TabsTrigger>
              <TabsTrigger value="bio">Bio</TabsTrigger>
            </TabsList>
          </div>
          <div className="p-card-pad sm:p-5">
            <TabsContent value="overview" className="mt-0">
              <OverviewPanel data={data} />
            </TabsContent>
            <TabsContent value="stats" className="mt-0">
              <StatsPanel data={data} />
            </TabsContent>
            <TabsContent value="log" className="mt-0">
              <GameLogPanel data={data} />
            </TabsContent>
            <TabsContent value="bio" className="mt-0">
              <BioPanel player={data.player} />
            </TabsContent>
          </div>
        </Tabs>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scout AI band
// ---------------------------------------------------------------------------

/**
 * Scout AI read. The kit's matchup call needs opponent/OPRK/SOS data we don't
 * sync yet, so this derives an honest line from the existing stats payload.
 * TODO(live-draft): swap in the matchup call (opponent, OPRK vs position,
 * SOS rest-of-season) once schedule data is available.
 */
function ScoutInsight({ data }: { data: PlayerStatsResponse }) {
  const { current, projection } = data.seasons
  const firstName = data.player.full_name.split(' ')[0]
  const ppg =
    current.gamesPlayed > 0 ? current.fantasy.ppr / current.gamesPlayed : 0

  const heading =
    current.gamesPlayed > 0
      ? `${firstName} is averaging ${ppg.toFixed(1)} PPR points per game`
      : `${firstName} has no games logged yet this season`

  return (
    <AIInsight heading={heading} confidence="medium">
      Projection sits at {projection.fantasy.ppr.toFixed(0)} PPR points for the
      season
      {data.player.bye_week != null
        ? `, with the week ${data.player.bye_week} bye to plan around`
        : ''}
      . Matchup reads arrive once schedule data is live.
    </AIInsight>
  )
}

// ---------------------------------------------------------------------------
// Your leagues column
// ---------------------------------------------------------------------------

/**
 * Per-league availability for this player, wired to the viewer's REAL
 * memberships (`useLeagues` — the same query home / sidebar / rail use). M1
 * has leagues but no rosters or drafts yet, so a player is a free agent in
 * every league the viewer is in; each row links to that league's home. When
 * the leagues release is gated off the block is hidden entirely (matching the
 * rest of the app) and only the list actions render. Real ownership /
 * on-a-team status arrives with rosters in M2.
 */
function YourLeaguesColumn({ data }: { data: PlayerStatsResponse }) {
  const { data: leagues, isPending, isError } = useLeagues({
    enabled: featureFlags.leagues,
  })

  return (
    <div className="w-full shrink-0 lg:w-[264px]">
      {featureFlags.leagues && (
        <div className="mb-3">
          <p className="fs-overline mb-1 text-n-3">Your leagues</p>
          {isPending ? (
            <div className="space-y-1.5">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : isError ? (
            <p className="py-2 text-[12px] font-semibold text-n-3">
              Couldn&apos;t load your leagues.
            </p>
          ) : leagues && leagues.length > 0 ? (
            <div>
              {leagues.map((league, i) => (
                <Link
                  key={league.id}
                  href={`/app/leagues/${league.id}`}
                  aria-label={`${data.player.full_name} in ${league.name}`}
                  className={cn(
                    'flex items-center gap-2.5 py-2 transition-colors hover:bg-n-4',
                    i > 0 && 'border-t border-n-4',
                  )}
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[8px]">
                      {crestInitials(league.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-extrabold leading-tight">
                      {league.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-semibold leading-tight text-brand-strong">
                      Free agent
                    </span>
                  </span>
                  <Icon name="arrow-next" size={13} className="shrink-0 text-n-3" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-2 text-[12px] font-medium text-n-3">
              Join or create a league to track availability.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <PlayerDetailActions player={data.player} onFullPage />
      </div>
    </div>
  )
}

/** Two-letter crest fallback from a league name (e.g. two words → first two initials). */
function crestInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
