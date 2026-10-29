'use client'

import type { ReactNode } from 'react'

import { JoinOrCreate, LeagueCard } from '@/components/mobile/home/home-matchups'
import { CenterNote, InlineError, PillButton } from '@/components/mobile/lists/lists-parts'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, MPageBar } from '@/components/mobile/ui/mobile-header'
import { useLeagues } from '@/hooks/use-leagues'

import { LEAGUES_COPY, LEAGUES_PARENT } from './leagues-ops'
import { MobileArchivedLeagues } from './mobile-league-archive'

/**
 * Leagues on the phone (`/app/leagues`, gap list §4 item 104) — the same
 * page as desktop's: every league you're in, from the same read
 * (`useLeagues`, the app's one league order), and the free Join and Create
 * doors (business rule 5). Desktop is unchanged.
 *
 * The handoff draws no Leagues page, so it is built from the league pieces
 * it does draw, on Home:
 *  - the G-page bar (blue back, "Leagues"); Back goes to where you came
 *    from, else Home;
 *  - one Home league card per league (`LeagueCard`, the "leagues"
 *    variant): the league's photo or tile, its name, "8-team PPR · Week 5",
 *    the draft pill before and during the draft, the week's matchup in
 *    season, and the red dot when something there needs you. A card opens
 *    what its league is doing, as Home's does. This variant adds what
 *    desktop's cards say and Home's don't: "Playoffs" / "Complete", and
 *    "Commissioner" when you run the league;
 *  - Home's "Join or create a league" button under the cards, which asks
 *    which and opens the phone's join and create sheets — the same flows
 *    as desktop's two buttons.
 * Loading cards, "No leagues yet" (with desktop's words), and a failed read
 * says so with Try again — never an empty list it can't vouch for; a failed
 * refresh keeps the cards.
 */
export function MobileLeagues() {
  const goBack = useGoBack()
  const leagues = useLeagues()
  const list = leagues.data
  const retry = () => void leagues.refetch()

  let body: ReactNode
  if (!list) {
    body = leagues.isError ? (
      <CenterNote
        title={LEAGUES_COPY.loadFailed}
        body={leagues.error.message}
        action={<PillButton onClick={retry}>Try again</PillButton>}
      />
    ) : leagues.fetchStatus === 'paused' ? (
      <CenterNote
        title={LEAGUES_COPY.loadFailed}
        body={LEAGUES_COPY.offline}
        action={<PillButton onClick={retry}>Try again</PillButton>}
      />
    ) : (
      <LeaguesSkeleton />
    )
  } else {
    body = (
      <>
        {/* A refresh that failed under cards that still show. */}
        {leagues.isError && <InlineError className="mb-[10px]" message={LEAGUES_COPY.refreshFailed} onRetry={retry} />}
        {list.length === 0 ? (
          <CenterNote title={LEAGUES_COPY.emptyTitle} body={LEAGUES_COPY.emptyBody} className="pb-4" />
        ) : (
          <ul className="flex flex-col gap-[10px]" aria-label="Your leagues">
            {list.map((league, index) => (
              <li key={league.id} className="flex flex-col">
                <LeagueCard league={league} index={index} variant="leagues" />
              </li>
            ))}
          </ul>
        )}
      </>
    )
  }

  return (
    <MobileScreen header={<MPageBar title="Leagues" onBack={() => goBack(LEAGUES_PARENT)} />} className="leading-[normal]">
      <div className="px-4 pb-8 pt-3" data-leagues>
        {body}
        <JoinOrCreate />
        {/* F716 (212): leagues their commissioner archived — read-only, Restore for him. */}
        <MobileArchivedLeagues />
      </div>
    </MobileScreen>
  )
}

/** Loading cards in Home's rhythm: a season card and a pre-draft one. */
function LeaguesSkeleton() {
  return (
    <div className="flex flex-col gap-[10px]" aria-busy="true" aria-label="Loading your leagues" data-leagues-loading>
      <span className="block h-[141px] animate-pulse rounded-[18px] bg-m-b1" />
      <span className="block h-16 animate-pulse rounded-[18px] bg-m-b1" />
    </div>
  )
}
