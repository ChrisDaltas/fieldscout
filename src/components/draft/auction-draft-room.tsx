'use client'

import Link from 'next/link'
import { useState } from 'react'

import {
  type AuctionBid,
  type AuctionDraftState,
  type AuctionNominatedPlayer,
  type AuctionNominee,
  type AuctionTeamBudget,
  type MockLeague,
} from '@/components/draft/mock-draft'
import {
  formatClock,
  useMockDraftClock,
} from '@/components/draft/use-mock-draft-clock'
import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { AIInsight } from '@/components/ui/ai-insight'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const TICKER_LENGTH = 4

function initialsFor(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
}

/** One team's budget card in the top strip. */
function TeamBudgetCard({
  team,
  leader,
}: {
  team: AuctionTeamBudget
  leader: boolean
}) {
  return (
    <div
      className={cn(
        'min-w-[104px] flex-1 rounded-sm border border-ink px-2.5 py-2',
        team.nominating
          ? 'bg-accent-soft shadow-hard-4'
          : leader
            ? 'bg-positive-soft'
            : 'bg-white',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[10px] font-bold">{team.name}</span>
        {team.nominating && (
          <Badge
            variant="accent"
            className="ml-auto h-4 shrink-0 px-1 text-[9px]"
          >
            Nom
          </Badge>
        )}
        {leader && (
          <Badge
            variant="green"
            className="ml-auto h-4 shrink-0 px-1 text-[9px]"
          >
            High
          </Badge>
        )}
      </div>
      <div className="fs-num mt-1.5 text-[16px] font-extrabold leading-none">
        ${team.budget}
      </div>
      <div className="fs-num mt-1 text-[9px] font-medium text-n-3">
        max ${team.maxBid} · {team.slots} slots
      </div>
    </div>
  )
}

interface AuctionDraftRoomProps {
  leagueId: string
  league: MockLeague
  initial: AuctionDraftState
}

/**
 * Auction draft room — all-team budget strip, live auction card (nominee,
 * current offer, bid controls, recent-bid ticker) with Scout AI advice,
 * sticky right column (your budget + nominate next).
 *
 * TODO(live-draft): bidding and nominating are a local simulation — bids
 * update local state and reset the local clock; nothing reaches a server.
 */
export function AuctionDraftRoom({
  leagueId,
  league,
  initial,
}: AuctionDraftRoomProps) {
  const [nominated, setNominated] = useState<AuctionNominatedPlayer>(
    initial.nominated,
  )
  const [nominatedBy, setNominatedBy] = useState(initial.nominatedBy)
  const [offer, setOffer] = useState(initial.currentOffer)
  const [offerBy, setOfferBy] = useState(initial.offerBy)
  const [bidHistory, setBidHistory] = useState<AuctionBid[]>(
    initial.bidHistory,
  )
  const [nominees, setNominees] = useState<AuctionNominee[]>(initial.nominees)
  const [manualBid, setManualBid] = useState('')
  const { seconds, reset } = useMockDraftClock(initial.bidClockSeconds)

  // TODO(live-draft): place the bid through the draft service; local-only sim.
  const placeBid = (amount: number, team: string) => {
    if (!Number.isFinite(amount) || amount <= offer) return
    setOffer(amount)
    setOfferBy(team)
    setBidHistory((cur) => [{ team, amount }, ...cur].slice(0, TICKER_LENGTH))
    reset()
  }

  const handleManualBid = () => {
    const amount = Number(manualBid)
    placeBid(Math.floor(amount), 'You')
    setManualBid('')
  }

  // TODO(live-draft): nominations go through the draft service; locally the
  // nominee moves to the block at a $1 opening bid from you.
  const handleNominate = (nominee: AuctionNominee) => {
    setNominated(nominee)
    setNominatedBy('You')
    setOffer(1)
    setOfferBy('You')
    setBidHistory([{ team: 'You', amount: 1 }])
    setNominees((cur) => cur.filter((n) => n.playerName !== nominee.playerName))
    reset()
  }

  const budget = initial.yourBudget

  return (
    <>
      <PageHeader
        title="Auction draft"
        actions={
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/leagues/${leagueId}`}>Exit room</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-5">
        {/* Budget strip — "You" first (fixture order) */}
        <div className="flex flex-wrap gap-2">
          {initial.teams.map((team) => (
            <TeamBudgetCard
              key={team.name}
              team={team}
              leader={team.name === offerBy}
            />
          ))}
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[1.5fr_1fr]">
          {/* Live auction */}
          <div className="flex min-w-0 flex-col gap-5">
            <div className="overflow-hidden rounded-sm border-2 border-ink bg-white shadow-hard-8">
              {/* Ink head band */}
              <div className="flex items-center gap-2.5 bg-ink px-3.5 py-2.5 text-white">
                <Badge variant="lime" className="shrink-0">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-pill bg-current" />
                  Live auction
                </Badge>
                <span className="truncate text-[12px] font-extrabold">
                  Nominated by {nominatedBy}
                </span>
                <span className="fs-num ml-auto shrink-0 text-[19px] font-extrabold text-accent">
                  {formatClock(seconds)}
                </span>
              </div>

              <div className="p-card-pad sm:p-[18px]">
                {/* Nominee */}
                <div className="mb-4 flex flex-wrap items-center gap-3.5">
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarFallback className="text-[15px]">
                      {initialsFor(nominated.playerName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-h5">
                      {nominated.playerName}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <PositionBadge
                        position={nominated.position}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="truncate text-[11px] font-semibold text-n-3">
                        {nominated.team} · Bye{' '}
                        <span className="fs-num">{nominated.bye}</span>
                        {nominated.projectedPts != null && (
                          <>
                            {' '}
                            · proj{' '}
                            <span className="fs-num">
                              {nominated.projectedPts}
                            </span>{' '}
                            pts
                          </>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="fs-overline text-n-3">Pre-draft value</div>
                    <div className="fs-num text-[22px] font-extrabold leading-tight">
                      ${nominated.value}
                    </div>
                  </div>
                </div>

                {/* Current offer */}
                <div className="flex flex-wrap items-center gap-4 rounded-sm border border-ink bg-accent-soft px-3.5 py-3">
                  <div>
                    <div className="fs-overline text-accent-strong">
                      Current offer
                    </div>
                    <div className="fs-num text-[27px] font-extrabold leading-none">
                      ${offer}
                    </div>
                    <div className="mt-1 text-[10px] font-semibold text-n-3">
                      by {offerBy}
                    </div>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-2.5">
                    <Input
                      value={manualBid}
                      onChange={(e) =>
                        setManualBid(e.target.value.replace(/[^0-9]/g, ''))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleManualBid()
                      }}
                      placeholder="Manual"
                      inputMode="numeric"
                      className="fs-num h-btn w-[88px] px-3 text-[13px]"
                      aria-label="Manual bid amount"
                    />
                    <Button variant="dark" onClick={handleManualBid}>
                      Bid
                    </Button>
                    <Button
                      variant="green"
                      shadow
                      onClick={() => placeBid(offer + 1, 'You')}
                    >
                      <Icon name="add-circle" size={14} />
                      Offer <span className="fs-num">${offer + 1}</span>
                    </Button>
                  </div>
                </div>

                {/* Recent bids ticker */}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {bidHistory.map((bid, i) => (
                    <span
                      key={`${bid.team}-${bid.amount}`}
                      className={cn(
                        'fs-num rounded-sm border border-n-4 px-1.5 py-0.5 text-[9px] font-bold',
                        i === 0 ? 'text-ink' : 'text-n-3',
                      )}
                    >
                      ${bid.amount} {bid.team}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <AIInsight
              heading={initial.aiSuggestion.heading}
              confidence="high"
            >
              {initial.aiSuggestion.body}
            </AIInsight>
          </div>

          {/* Budget + nominate panel */}
          <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-5">
            <Card>
              <CardHeader>
                <CardTitle>Your budget</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="fs-num text-[26px] font-extrabold leading-none">
                    ${budget.remaining}
                  </span>
                  <span className="text-[11px] font-semibold text-n-3">
                    of <span className="fs-num">${budget.total}</span> · max
                    bid <span className="fs-num">${budget.maxBid}</span>
                  </span>
                </div>
                <Progress
                  value={(budget.remaining / budget.total) * 100}
                  indicatorClassName="bg-positive"
                  className="mt-2.5"
                />
                <div className="mt-2.5 flex justify-between text-[10px] font-semibold text-n-3">
                  <span>
                    <span className="fs-num">{budget.slotsLeft}</span> slots
                    left
                  </span>
                  <span>
                    <span className="fs-num">${budget.avgPerSlot}</span> avg /
                    slot
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Nominate next</CardTitle>
                <Badge variant="stroke">Your turn soon</Badge>
              </CardHeader>
              {nominees.length === 0 ? (
                <p className="p-card-pad text-[11px] font-medium text-n-3">
                  Your shortlist is empty — everyone went to the block.
                </p>
              ) : (
                <div className="divide-y divide-n-4">
                  {nominees.map((nominee) => (
                    <div
                      key={nominee.playerName}
                      className="flex items-center gap-2.5 px-3.5 py-2"
                    >
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarFallback className="text-[10px]">
                          {initialsFor(nominee.playerName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-extrabold leading-tight">
                          {nominee.playerName}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <PositionBadge
                            position={nominee.position}
                            size="sm"
                            className="shrink-0"
                          />
                          <span className="truncate text-[9px] font-semibold text-n-3">
                            {nominee.team} · Bye{' '}
                            <span className="fs-num">{nominee.bye}</span>
                          </span>
                        </div>
                      </div>
                      <span className="fs-num shrink-0 text-[11px] font-extrabold text-n-3">
                        ${nominee.value}
                      </span>
                      <Button
                        variant="stroke"
                        size="sm"
                        className="shrink-0"
                        onClick={() => handleNominate(nominee)}
                      >
                        Nominate
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
