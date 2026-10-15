'use client'

import { useMemo } from 'react'

import { ADD_DROP_TYPES } from '@/components/leagues/activity-page-ops'
import { useCancelClaim } from '@/hooks/use-cancel-claim'
import { useLeagueActivityPages } from '@/hooks/use-league-activity'
import { useWaiverClaims } from '@/hooks/use-waiver-claims'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { monthDay, type MoveRow } from './team-ops'

/**
 * Moves on the Team screens. The team view's "Recent moves" rows (handoff
 * §2.3 8) read the activity feed filtered to the team's adds / drops /
 * claims (`GET …/activity?type=…&team_id=…`); its See all and the Team
 * tab's Moves tile go to the league's Transactions screen (m-league §2.5).
 *
 * `PendingClaims` keeps the desktop team page's pending waiver claims
 * (your own only — bids are blind, E13) with Cancel on your Team tab: the
 * handoff has no claims, and the Transactions screen lists only moves that
 * went through.
 */

export function MoveRowView({ row, leagueId }: { row: MoveRow; leagueId: string }) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  return (
    <div className="flex items-center gap-[10px] border-b border-m-b2 py-[10px]" data-move-row={row.kind}>
      <span
        className={cn(
          'flex h-[22px] flex-none items-center rounded-pill px-2 text-[11px] font-semibold',
          row.kind === 'Added' ? 'bg-m-gg text-m-tg' : 'bg-m-gr text-m-tr',
        )}
      >
        {row.kind}
      </span>
      {row.playerId ? (
        <button type="button" onClick={() => openPlayer(row.playerId!, leagueId)} className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">
          {row.name}
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{row.name}</span>
      )}
      <span className="flex-none text-[11px] font-medium text-m-t3">{monthDay(row.at)}</span>
    </div>
  )
}

/** One team's adds / drops / claims, newest first (pages of 20). */
export function useTeamMoves(leagueId: string, teamId: string) {
  const pages = useLeagueActivityPages(leagueId, { type: ADD_DROP_TYPES, teamId, limit: 20 })
  const items = useMemo(() => (pages.data?.pages ?? []).flatMap((p) => p.items), [pages.data])
  return { ...pages, items }
}

/** Your pending waiver claims, with Cancel — shown only while you have one
 *  (or the read failed: never a silent empty). */
export function PendingClaims({ leagueId, claimsLive, className }: { leagueId: string; claimsLive: boolean; className?: string }) {
  const claims = useWaiverClaims(claimsLive ? leagueId : undefined, { status: 'pending' })
  const cancel = useCancelClaim(leagueId)
  const pending = (claims.data?.claims ?? []).filter((c) => c.status === 'pending')
  const faab = claims.data?.waiver_type === 'faab'

  if (!claimsLive) return null
  if (claims.isError) {
    return (
      <div role="alert" className={cn('flex flex-col items-start gap-2', className)}>
        <p className="text-[13px] font-medium text-m-tr">Couldn’t load your pending waiver claims. {claims.error instanceof Error ? claims.error.message : ''}</p>
        <button type="button" onClick={() => void claims.refetch()} className="h-8 rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1">
          Retry
        </button>
      </div>
    )
  }
  if (pending.length === 0) return null
  return (
    <section className={className} data-pending-claims>
      <h2 className="pb-1 text-[17px] font-semibold tracking-[-0.01em]">Pending claims</h2>
      {pending.map((c) => (
        <div key={c.id} className="flex items-center gap-[10px] border-b border-m-b2 py-[10px]" data-pending-claim={c.id}>
          <span className="flex h-[22px] flex-none items-center rounded-pill bg-m-go px-2 text-[11px] font-semibold text-m-to">Claim</span>
          <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-[13px] font-semibold">{c.add.full_name ?? c.add.player_id}</span>
            <span className="truncate text-[11px] font-medium text-m-t3">
              {[faab ? `$${c.faab_bid} bid` : null, c.drop ? `drops ${c.drop.full_name ?? c.drop.player_id}` : null].filter(Boolean).join(' · ') || 'Waiting for the waiver run'}
            </span>
          </span>
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() =>
              cancel
                .cancelAsync(c.id)
                .then(() => toast({ title: 'Claim cancelled' }))
                .catch((e: Error) => toast({ title: 'The claim wasn’t cancelled', description: e.message, variant: 'destructive' }))
            }
            aria-label={`Cancel the claim for ${c.add.full_name ?? 'this player'}`}
            className="h-8 flex-none rounded-pill bg-m-b2 px-3 text-[13px] font-semibold text-m-t1 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ))}
    </section>
  )
}
