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
import {
  usePlayerStats,
  type PlayerStatsResponse,
} from '@/hooks/use-player-stats'
import { useToast } from '@/hooks/use-toast'

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
      <Card className="shadow-hard-4">
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

// TODO(live-draft): leagues aren't live yet — these rows are mocked
// placeholders matching the kit layout (crest, league name, ownership,
// Trade stub, expand). Replace with real per-league availability once
// leagues ship. Never ship these names as data.
const MOCK_LEAGUES: Array<{ id: string; name: string; team: string }> = [
  { id: 'work', name: 'The Work League', team: 'The Deliverables' },
  { id: 'dynasty', name: 'Dynasty degens', team: 'Future Picks' },
  { id: 'gridiron', name: 'Gridiron gurus', team: 'Waiver wire wizards' },
]

function YourLeaguesColumn({ data }: { data: PlayerStatsResponse }) {
  const { toast } = useToast()

  // TODO(live-draft): stub handlers until league mutations exist.
  const stub = () =>
    toast({
      title: 'Leagues are coming soon',
      description: 'League actions unlock once leagues go live.',
    })

  return (
    <div className="w-full shrink-0 lg:w-[264px]">
      <p className="fs-overline mb-1 text-n-3">Your leagues</p>
      <div>
        {MOCK_LEAGUES.map((league, i) => (
          <div
            key={league.id}
            className={
              i === 0
                ? 'flex items-center gap-2.5 py-2'
                : 'flex items-center gap-2.5 border-t border-n-4 py-2'
            }
          >
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-[8px]">
                {league.name
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-extrabold leading-tight">
                {league.name}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-semibold leading-tight text-n-3">
                On {league.team}
              </span>
            </span>
            <Button variant="stroke" size="sm" onClick={stub}>
              Trade
            </Button>
            <button
              type="button"
              aria-label={`Open ${data.player.full_name} in ${league.name}`}
              title="Open in this league"
              onClick={stub}
              className="shrink-0 rounded-sm p-1 text-ink transition-colors hover:bg-n-4 hover:text-accent"
            >
              <ExpandIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <PlayerDetailActions player={data.player} onFullPage />
      </div>
    </div>
  )
}

/**
 * Filled 16×16 expand glyph (two opposite corner arrows) — the icon set has
 * no expand mark, so it's drawn in the same filled style (kit ExpandIcon).
 */
function ExpandIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="block shrink-0"
    >
      <path
        fill="currentColor"
        d="M9.3 2H14v4.7l-1.7-1.7-2.9 2.9-1.3-1.3 2.9-2.9L9.3 2zM6.7 14H2V9.3l1.7 1.7 2.9-2.9 1.3 1.3-2.9 2.9L6.7 14z"
      />
    </svg>
  )
}
