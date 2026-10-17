'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { managersByTeam } from '@/components/leagues/league-home-season-ops'
import { MIcon } from '@/components/mobile/ui/m-icon'
import type { LeagueDetail } from '@/hooks/use-league'

import { FilterPill } from './league-bits'
import { clearedFilter, commishLogHref, filterCount, filterLabel } from './league-tab-ops'
import { useTxFilter } from './league-tab-store'
import { TxFeed } from './tx-feed'
import { TxFilterSheet } from './tx-filter-sheet'

/**
 * League › Activity (handoff m-league §2.4): the right-aligned Filter pill,
 * then the league's activity — the same rows as the Transactions screen
 * (the prototype draws only the pill; its open question recommends the
 * feed). The filters are shared with Transactions and kept after leaving.
 * The commissioner's log (every correction a commissioner made) is one tap
 * below the list.
 */
export function ActivitySegment({ leagueId, detail, myTeamId }: { leagueId: string; detail: LeagueDetail; myTeamId: string | null }) {
  const [filter, setFilter] = useTxFilter(leagueId)
  const [open, setOpen] = useState(false)
  const n = filterCount(filter, false)
  return (
    <div className="px-3 pb-6 pt-1" data-activity-segment>
      <div className="flex items-center justify-end px-1 pt-1.5">
        <FilterPill count={n} label={filterLabel(n)} onClick={() => setOpen(true)} />
      </div>
      <TxFeed leagueId={leagueId} detail={detail} myTeamId={myTeamId} filter={filter} myMoves={false} onClear={() => setFilter(clearedFilter(filter, false))} />
      <Link
        href={commishLogHref(leagueId)}
        className="mt-3 flex h-12 items-center gap-3 rounded-[14px] bg-m-b1 px-3 active:bg-m-b2h"
      >
        <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b2 text-m-t1">
          <MIcon name="gear" size={16} />
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold text-m-t1">Commissioner log</span>
        <MIcon name="chevronRight" size={12} stroke={2} className="text-m-t5" />
      </Link>
      <LeagueTxFilterSheet leagueId={leagueId} detail={detail} myTeamId={myTeamId} open={open} onOpenChange={setOpen} myMoves={false} />
    </div>
  )
}

/** The filter sheet over this league's teams and the shared filter. */
export function LeagueTxFilterSheet({
  leagueId,
  detail,
  myTeamId,
  open,
  onOpenChange,
  myMoves,
}: {
  leagueId: string
  detail: LeagueDetail
  myTeamId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  myMoves: boolean
}) {
  const [filter, setFilter] = useTxFilter(leagueId)
  const managers = useMemo(() => managersByTeam(detail.members), [detail.members])
  const teams = useMemo(() => detail.teams.filter((t) => t.status !== 'retired'), [detail.teams])
  const teamIds = useMemo(() => detail.teams.map((t) => t.id), [detail.teams])
  return (
    <TxFilterSheet
      open={open}
      onOpenChange={onOpenChange}
      filter={filter}
      onChange={setFilter}
      myMoves={myMoves}
      teams={teams}
      managerOf={(id) => managers.get(id) ?? null}
      teamIds={teamIds}
      myTeamId={myTeamId}
    />
  )
}
