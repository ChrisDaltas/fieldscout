'use client'

import { HomePlayerRow } from '@/components/home/home-player-row'
import { CollapsibleCard } from '@/components/layout/two-column-layout'
import { injuryNote } from '@/components/mobile/home/home-ops'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useLeagues } from '@/hooks/use-leagues'
import { useMobileHomeInjuries, type HomeInjury } from '@/hooks/use-mobile-home-injuries'
import { useOpenPlayer } from '@/hooks/use-open-player'
import { featureFlags } from '@/lib/feature-flags'

/**
 * Injury report (package screen 01, right column) — the desktop Home's view of
 * the SAME real data the phone's Home "Injury news" shows
 * (`useMobileHomeInjuries`, reused, not copied): the synced injury feed
 * (`players.status` + `injury_*`), the viewer's own injured players first
 * ("On your roster", from this season's league rosters), then the most
 * relevant injured players league-wide by projection. No sample rows (Chris,
 * 2026-10-15 — the old mock showed "Garrett Wilson · On your team" to
 * everyone).
 *
 * Same five rows as the phone: the hook's cache key doesn't carry the row
 * count, so both layouts must ask for the same number.
 *
 * Loading / error / empty in the desktop card language. A league list or
 * roster that fails to load is the card's error (with Try again) — never a
 * list that silently drops "On your roster".
 */

const ROWS = 5

/** v7 status pill per designation — the phone's colours (`injuryPillClass`)
 *  as the desktop badge's tints: Questionable caution, Doubtful/Out negative,
 *  IR/PUP ink. */
function injuryBadgeVariant(status: string): BadgeProps['variant'] {
  if (status === 'Questionable') return 'yellow'
  if (status === 'Doubtful' || status === 'Out') return 'pink'
  return 'black'
}

export function InjuryNewsCard() {
  const leagues = useLeagues({ enabled: featureFlags.leagues })
  const myLeagues = featureFlags.leagues ? (leagues.data ?? []) : []
  // The league list is what makes a row "yours" — if it never loaded, "On
  // your roster" can't be known, so that is the card's error too.
  const leaguesFailed = featureFlags.leagues && leagues.isError && !leagues.data
  const injuries = useMobileHomeInjuries(myLeagues, {
    rows: ROWS,
    ready: !featureFlags.leagues || (!leagues.isPending && !leaguesFailed),
  })
  const openPlayer = useOpenPlayer()

  const retry = () => {
    if (leaguesFailed) void leagues.refetch()
    else injuries.refetch()
  }

  return (
    <CollapsibleCard
      title="Injury report"
      headerRight={
        featureFlags.leagues ? (
          <span className="text-[10px] font-semibold text-n-6">Your players first</span>
        ) : undefined
      }
    >
      {leaguesFailed || injuries.isError ? (
        <div className="flex flex-col items-center gap-[9px] border-t border-n-4 px-[15px] py-6 text-center">
          <p className="text-[11px] font-medium text-negative-strong" role="alert">
            Couldn&apos;t load injury news.
          </p>
          <Button variant="stroke" size="sm" onClick={retry}>
            <Icon name="reset" size={11} /> Try again
          </Button>
        </div>
      ) : injuries.isPending ? (
        <div className="space-y-2 border-t border-n-4 px-[15px] py-[11px]" aria-busy="true" aria-label="Loading injury news">
          {Array.from({ length: ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-md bg-surface-control" />
          ))}
        </div>
      ) : injuries.items.length === 0 ? (
        <p className="border-t border-n-4 px-[15px] py-6 text-center text-[11px] font-medium text-n-6">
          No injury designations right now.
        </p>
      ) : (
        <div>
          {injuries.items.map((p) => (
            <InjuryRow key={p.id} p={p} onOpen={() => openPlayer(p.id)} />
          ))}
        </div>
      )}
    </CollapsibleCard>
  )
}

function InjuryRow({ p, onOpen }: { p: HomeInjury; onOpen: () => void }) {
  const mine = p.myTeams.length > 0
  return (
    <HomePlayerRow
      name={p.full_name}
      position={p.position}
      headshotUrl={p.headshot_url}
      team={p.team}
      onOpen={onOpen}
      meta={
        <>
          {p.team ?? 'FA'}
          {mine && (
            <>
              {' · '}
              <span className="font-semibold text-accent">{p.myTeams.join(', ')}</span>
            </>
          )}
        </>
      }
      nameBadge={
        mine ? (
          <Badge variant="stroke" className="h-4 shrink-0 px-1.5 text-[9px]">
            On your roster
          </Badge>
        ) : undefined
      }
      note={injuryNote(p) ?? undefined}
      right={<Badge variant={injuryBadgeVariant(p.status)}>{p.status}</Badge>}
    />
  )
}
