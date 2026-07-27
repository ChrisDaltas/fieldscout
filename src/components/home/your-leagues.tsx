'use client'

import Link from 'next/link'

import { JoinLeagueDialog, LeagueIndexCard } from '@/components/leagues/leagues-index'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeagues } from '@/hooks/use-leagues'

/**
 * "Your leagues" — the home hub's league widget (package screen 01). Wired to
 * the viewer's REAL memberships via `useLeagues` (the same query the leagues
 * index uses), rendered with the shared `LeagueIndexCard` so home and
 * `/app/leagues` stay in lock-step (compose, no fork). Empty until the user
 * creates or joins a league; in-season stats (record, points, playoff odds)
 * arrive with the in-season milestone.
 *
 * Skeleton / error / empty per the leagues-index states (§16.5.4).
 */
export function YourLeagues() {
  const { data: leagues, isPending, isError, refetch } = useLeagues()

  return (
    <section>
      <div className="mb-2.5 flex items-center">
        <h2 className="mr-auto text-h5">Your leagues</h2>
        <JoinLeagueDialog />
      </div>

      {isPending ? (
        <div className="flex flex-col gap-[13px]">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-[104px] rounded-sm" />
          ))}
        </div>
      ) : isError ? (
        <Card className="border-negative bg-negative-soft">
          <div className="flex flex-col items-start gap-2 p-4">
            <p className="text-[13px] font-bold" role="alert">
              Couldn&apos;t load your leagues.
            </p>
            <Button variant="stroke" size="sm" onClick={() => refetch()}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        </Card>
      ) : leagues && leagues.length > 0 ? (
        <div className="flex flex-col gap-[13px]">
          {leagues.map((league) => (
            <LeagueIndexCard key={league.id} league={league} />
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center gap-2 px-6 py-10 text-center">
          <Icon name="cup" size={18} className="text-n-3" />
          <p className="text-[13px] font-bold text-ink">No leagues yet</p>
          <p className="max-w-xs text-[12px] font-medium text-n-3">
            Create a league or join one with an invite code — both are free.
          </p>
          <Button variant="stroke" size="sm" asChild className="mt-1">
            <Link href="/app/leagues">
              Go to leagues
              <Icon name="arrow-next" size={13} />
            </Link>
          </Button>
        </Card>
      )}
    </section>
  )
}
