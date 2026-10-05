'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { leagueCardContext } from '@/components/players/player-card-context'
import { TextWithPlayers } from '@/components/players/player-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useCancelClaim } from '@/hooks/use-cancel-claim'
import { useEditClaim } from '@/hooks/use-edit-claim'
import { useLeagueActivityFeed } from '@/hooks/use-league-activity'
import { useWaiverClaims } from '@/hooks/use-waiver-claims'
import type { ActivityItem } from '@/lib/leagues/api/activity-service'
import type { WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'

import { feedLines } from './activity-feed-ops'
import { ADD_DROP_TYPES, activityHref } from './activity-page-ops'
import { formatInstantWithDate } from './lineup-editor-ops'
import { STALE_LEAGUE_COPY, StaleDataBanner } from './status-banners'
import {
  PENDING_CLAIM_LABEL,
  SEE_ALL_ADDS_LABEL,
  TRANSACTIONS_EMPTY_COPY,
  TRANSACTIONS_ERROR_TITLE,
  TRANSACTIONS_MOVES_LIMIT,
  TRANSACTIONS_TITLE,
  mergeTransactions,
} from './team-transactions-ops'
import { faabLeftCopy, waiverOrderCopy } from './waiver-claims-ops'
import { ClaimPlayers, PendingClaimControls } from './waiver-claims-panel'

/**
 * My Team's Transactions panel (Chris 2026-10-04 — moved off the Players
 * page, then ruled: "Transactions", ONE feed of the team's pending waiver
 * claims, adds and drops, newest at the top; a pending claim keeps its
 * status, bid and Cancel inline). Two existing reads, no new API: the
 * viewer's own claims (`GET …/waivers`, pending — bids are blind, E13) and
 * the activity feed filtered to this team's adds / drops / claims that went
 * through (`GET …/activity?type=…&team_id=…`).
 *
 * States (§16.5.4): skeleton · empty with the way to Players · error with
 * Retry (EITHER read failing is an error — never a half-empty feed) · stale
 * banner over last-good rows · a claim verb's refusal verbatim.
 */
export function TeamTransactionsPanel({
  leagueId,
  teamId,
  teamName,
  claimsLive,
  leagueTimeZone,
  nextRunLocal,
}: {
  leagueId: string
  teamId: string
  teamName: string
  /** Waiver claims apply in this league right now (the Players page's old gate). */
  claimsLive: boolean
  leagueTimeZone: string | null
  nextRunLocal: string | null
}) {
  const claims = useWaiverClaims(claimsLive ? leagueId : undefined, { status: 'pending' })
  const moves = useLeagueActivityFeed(leagueId, { type: ADD_DROP_TYPES, teamId, limit: TRANSACTIONS_MOVES_LIMIT })
  const edit = useEditClaim(leagueId)
  const cancel = useCancelClaim(leagueId)
  const [last, setLast] = useState<'edit' | 'cancel' | null>(null)
  const spoke = last === 'edit' ? edit : last === 'cancel' ? cancel : null
  const claimsError = claimsLive && claims.isError ? claims.error : null
  const problem = claimsError ?? (moves.isError ? moves.error : null)
  return (
    <TeamTransactionsPanelView
      leagueId={leagueId}
      teamId={teamId}
      teamName={teamName}
      claimsDoc={claimsLive ? (claims.data ?? null) : null}
      items={moves.data?.items}
      loading={(claimsLive && claims.isPending && !claims.data) || (moves.isPending && !moves.data)}
      hasData={(!claimsLive || claims.data !== undefined) && moves.data !== undefined}
      problem={problem == null ? null : problem instanceof Error ? problem.message : String(problem)}
      onRetry={() => {
        if (claimsLive) void claims.refetch()
        void moves.refetch()
      }}
      leagueTimeZone={leagueTimeZone}
      nextRunLocal={nextRunLocal}
      pending={edit.isPending || cancel.isPending}
      refusal={spoke?.error?.message ?? null}
      onEditBid={(claim, bid) => {
        setLast('edit')
        edit.edit(claim.id, { faab_bid: bid, drop_player_id: claim.drop?.player_id ?? null })
      }}
      onCancel={(claim) => {
        setLast('cancel')
        cancel.cancel(claim.id)
      }}
    />
  )
}

export function TeamTransactionsPanelView({
  leagueId,
  teamId,
  teamName,
  claimsDoc,
  items,
  loading,
  hasData,
  problem,
  onRetry,
  leagueTimeZone,
  nextRunLocal,
  pending,
  refusal,
  onEditBid,
  onCancel,
}: {
  leagueId: string
  teamId: string
  teamName: string
  claimsDoc: WaiverClaimsDocument | null
  items: readonly ActivityItem[] | undefined
  loading: boolean
  /** Every read this panel needs has answered at least once. */
  hasData: boolean
  problem: string | null
  onRetry: () => void
  leagueTimeZone: string | null
  nextRunLocal: string | null
  pending: boolean
  refusal: string | null
  onEditBid: (claim: WaiverClaimView, bid: number) => void
  onCancel: (claim: WaiverClaimView) => void
}) {
  const entries = useMemo(
    () => mergeTransactions(claimsDoc?.claims ?? [], feedLines(items ?? [], new Map([[teamId, teamName]]))),
    [claimsDoc, items, teamId, teamName],
  )
  const faab = claimsDoc?.waiver_type === 'faab'
  const seat = claimsDoc
    ? [faab ? faabLeftCopy(claimsDoc.faab_balance, claimsDoc.faab_budget) : null, waiverOrderCopy(claimsDoc, claimsDoc.waiver_priority, true)]
        .filter((p) => p !== null)
        .join(' · ')
    : ''
  const context = leagueCardContext(leagueId)
  return (
    <Card data-team-transactions>
      <CardHeader className="min-h-0 py-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[12px]">
          {TRANSACTIONS_TITLE}
          {seat && (
            <span className="ml-auto text-[11px] font-medium text-n-3" data-claims-budget>
              {seat}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-card-pad py-3">
        {loading ? (
          <div className="flex flex-col gap-1.5" data-skeleton="transactions">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-sm" />
            ))}
          </div>
        ) : problem !== null && !hasData ? (
          // Fail loud: a failed read is never an empty feed.
          <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-transactions-error>
            <p className="text-[12px] font-bold">{TRANSACTIONS_ERROR_TITLE}</p>
            <p className="text-[11px] font-medium text-n-3">{problem}</p>
            <Button variant="stroke" size="sm" onClick={onRetry}>
              <Icon name="reset" size={13} /> Retry
            </Button>
          </div>
        ) : (
          <>
            {problem !== null && <StaleDataBanner>{STALE_LEAGUE_COPY}</StaleDataBanner>}
            {refusal && (
              <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-claims-refusal>
                {refusal}
              </p>
            )}
            {entries.length === 0 ? (
              <p className="text-[12px] font-medium text-n-3" data-empty="transactions">
                {TRANSACTIONS_EMPTY_COPY}{' '}
                <Link href={`/app/leagues/${leagueId}/players`} className="font-bold text-ink underline" data-transactions-players-link>
                  Go to Players
                </Link>
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-n-4" data-transactions-items>
                {entries.map((entry) => {
                  const when = entry.at ? formatInstantWithDate(entry.at, leagueTimeZone) : null
                  return entry.kind === 'claim' ? (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-1.5" data-transaction="claim" data-claim={entry.claim.id}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge variant="stroke" className="shrink-0" data-claim-status="pending">
                          {PENDING_CLAIM_LABEL}
                        </Badge>
                        <ClaimPlayers leagueId={leagueId} claim={entry.claim} />
                        <PendingClaimControls claim={entry.claim} faab={faab} pending={pending} onEditBid={onEditBid} onCancel={onCancel} />
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-medium text-n-3">
                        {when && (
                          <span className="fs-num" title={when.title ?? undefined}>
                            {when.local}
                          </span>
                        )}
                        <span>{nextRunLocal ? `Goes through at the next waiver run, ${nextRunLocal}` : 'Goes through at the next waiver run'}</span>
                      </div>
                    </li>
                  ) : (
                    <li key={entry.id} className="flex flex-col gap-0.5 py-1.5" data-transaction="move">
                      <span className="min-w-0 truncate text-[12px] font-medium text-ink" data-feed-text>
                        {entry.line.players && entry.line.players.length > 0 ? (
                          <TextWithPlayers text={entry.line.text} players={entry.line.players} context={context} />
                        ) : (
                          entry.line.text
                        )}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] font-medium text-n-3">
                        {entry.line.week !== null && (
                          <span>
                            Week <span className="fs-num">{entry.line.week}</span>
                          </span>
                        )}
                        {when && (
                          <span className="fs-num" title={when.title ?? undefined}>
                            {when.local}
                          </span>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            <Link
              href={activityHref(leagueId, { tab: 'adds' })}
              className="self-start text-[11px] font-bold text-accent-strong underline underline-offset-2 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              data-see-all-adds
            >
              {SEE_ALL_ADDS_LABEL}
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  )
}
