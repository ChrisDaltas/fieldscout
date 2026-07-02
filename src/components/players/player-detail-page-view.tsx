'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BioPanel,
  GameLogPanel,
  OverviewPanel,
  StatsPanel,
} from '@/components/players/player-detail-panels'
import { PlayerDetailActions } from '@/components/players/player-detail-actions'
import { PlayerDetailHeader } from '@/components/players/player-detail-header'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePlayerStats } from '@/hooks/use-player-stats'

interface PlayerDetailPageViewProps {
  playerId: string
}

/**
 * Full-page sibling of the floating player window — the same header / key
 * actions / tabbed content stack, laid out as a page instead of a window.
 */
export function PlayerDetailPageView({ playerId }: PlayerDetailPageViewProps) {
  const { data, isLoading, error } = usePlayerStats(playerId)
  const router = useRouter()

  const backButton = (
    <button
      type="button"
      onClick={() => router.back()}
      className="flex items-center gap-1 self-start rounded-full text-sm font-medium text-text-secondary transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  )

  if (isLoading) {
    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <Skeleton className="h-9 w-64 rounded-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-3">
        {backButton}
        <Card className="border-bg-elevated-2 bg-bg-elevated">
          <CardContent className="p-6 text-sm text-destructive">
            {error?.message ?? 'Player not found.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {backButton}
      <div className="rounded-lg border border-bg-elevated-2 bg-bg-elevated">
        <PlayerDetailHeader player={data.player} size="expanded" />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bg-elevated-2 px-4 py-3 sm:px-6">
          <PlayerDetailActions player={data.player} onFullPage />
        </div>
      </div>

      <Tabs defaultValue="overview" className="pt-2">
        <TabsList className="bg-bg-elevated">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="log">Game Log</TabsTrigger>
          <TabsTrigger value="bio">Bio</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-2">
          <OverviewPanel data={data} expanded />
        </TabsContent>
        <TabsContent value="stats" className="pt-2">
          <StatsPanel data={data} />
        </TabsContent>
        <TabsContent value="log" className="pt-2">
          <GameLogPanel data={data} />
        </TabsContent>
        <TabsContent value="bio" className="pt-2">
          <BioPanel player={data.player} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
