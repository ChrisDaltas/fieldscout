'use client'

import { useEffect, useMemo, useState } from 'react'

import { claimsInRunOrder } from '@/components/leagues/waiver-claims-ops'
import { EDIT_CLAIM_LABEL } from '@/components/mobile/league/team/claim-edit-ops'
import { ClaimEditSheet, ClaimOrderDoor, ClaimOrderSheet } from '@/components/mobile/league/team/claim-sheets'
import { leagueTabHref } from '@/components/mobile/shell/mobile-nav'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MobileScreen, RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { useAuth } from '@/hooks/use-auth'
import { useCancelClaim } from '@/hooks/use-cancel-claim'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { usePlayersByIds, type PlayerIdentity } from '@/hooks/use-players-by-ids'
import { toast } from '@/hooks/use-toast'
import { useWaiverClaims } from '@/hooks/use-waiver-claims'
import type { WaiverClaimPlayer, WaiverClaimView, WaiverClaimsDocument } from '@/lib/leagues/api/waivers-service'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { LeagueTxFilterSheet } from './activity-segment'
import { CenteredNote, FilterPill, SkeletonBlocks } from './league-bits'
import { clearedFilter, filterCount, filterLabel, moveSub, shortName, type TxFilter } from './league-tab-ops'
import { useTxFilter } from './league-tab-store'
import { TxFeed, type TxClaimResults } from './tx-feed'

/**
 * The Transactions screen (handoff m-league §2.5): a 52px top bar (close ×,
 * centred title, spacer), the "Activity" heading with the Filter pill, then
 * the list. "League transactions" league-wide, "My moves" for your own team
 * (the Team tab's Moves tile — no Teams filter), or pre-filtered to one
 * team (a team view's "See all"). Every entry resets the type to All types;
 * the close × goes back to where you came from — the League tab's Activity,
 * your Team tab, a team view (gap list #41, Chris #27) — and only when
 * nothing in the app is behind (a link opened fresh) to your Team tab; the
 * filters are kept after leaving. No league header and no switcher; the
 * league tab bar stays.
 *
 * My moves also lists your PENDING waiver claims above the moves, in the
 * order the run tries them, each with Edit (bid and drop) and Cancel, and
 * a Claim order door with two or more (gap list §3 #13; the app's own team
 * moves panel does — kept; bids are blind, so this is your own team's read
 * only), and — among the moves, by when the
 * waiver run settled them — the claims you LOST or that DIDN'T GO THROUGH,
 * each with the stored reason in plain words (gap list §3 #12; the desktop
 * panel's Chris 2026-10-05 rule). One read of your claims serves both; it
 * runs alongside the feed's, whose rows wait for it (never a claim popping
 * in among moves already shown).
 */
export function TransactionsScreen({ leagueId, mine, team }: { leagueId: string; mine: boolean; team: string | null }) {
  const goBack = useGoBack()
  const league = useLeague(leagueId)
  const { user, isLoading: authLoading } = useAuth()
  const [stored, setFilter] = useTxFilter(leagueId)
  const [open, setOpen] = useState(false)

  // Entry resets (spec §3): the type to All; a "See all" names its team. The
  // first render already shows the entry's filter (no flash of the last one).
  const entryKey = `${leagueId}|${mine ? 'mine' : ''}|${team ?? ''}`
  const [enteredKey, setEnteredKey] = useState<string | null>(null)
  useEffect(() => {
    setFilter(team && !mine ? { type: 'All', teams: [team] } : { type: 'All' })
    setEnteredKey(entryKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per entry
  }, [entryKey])
  const filter: TxFilter = enteredKey === entryKey ? stored : { type: 'All', teams: team && !mine ? [team] : stored.teams }

  const data = league.data
  const myTeamId = data?.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const n = filterCount(filter, mine)

  // Your claims, settled ones too (`status=all`) — My moves only.
  const claimsOn = mine && myTeamId !== null
  const claims = useWaiverClaims(claimsOn ? leagueId : undefined, { status: 'all' })
  const claimsDoc = claimsOn ? (claims.data ?? null) : null
  const { refetch: refetchClaims } = claims
  const withClaims = showsClaims(filter)
  const claimResults = useMemo<TxClaimResults | null>(
    () =>
      claimsDoc && withClaims
        ? { claims: claimsDoc.claims, waiverType: claimsDoc.waiver_type, refresh: () => void refetchClaims() }
        : null,
    [claimsDoc, withClaims, refetchClaims],
  )

  const header = (
    <>
      <div className="flex h-[52px] items-center gap-2 px-3">
        <RoundNavButton kind="close" label="Close" onClick={() => goBack(leagueTabHref(leagueId, 'team', myTeamId))} />
        <h2 className="flex-1 text-center text-[16px] font-semibold text-m-t1">{mine ? 'My moves' : 'League transactions'}</h2>
        <span className="w-9 flex-none" />
      </div>
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-m-t1">Activity</span>
        <FilterPill count={n} label={filterLabel(n)} onClick={() => setOpen(true)} />
      </div>
    </>
  )

  return (
    <MobileScreen header={header}>
      <div className="px-3 pb-5" data-transactions-screen={mine ? 'mine' : 'league'}>
        {league.isPending || authLoading ? (
          <div className="pt-3">
            <SkeletonBlocks count={5} className="h-[72px]" />
          </div>
        ) : !data ? (
          <CenteredNote role="alert" message="Couldn’t load this league." action="Try again" onAction={() => void league.refetch()} />
        ) : (
          <>
            {claimsOn && withClaims && claims.isError && !claimsDoc && (
              // Fail loud: a failed read is never "no claims".
              <CenteredNote
                role="alert"
                className="py-4"
                message="Couldn’t load your waiver claims."
                action="Try again"
                onAction={() => void refetchClaims()}
              />
            )}
            {claimsDoc && withClaims && claimsLive(data) && <PendingClaims leagueId={leagueId} doc={claimsDoc} />}
            <TxFeed
              leagueId={leagueId}
              detail={data}
              myTeamId={myTeamId}
              filter={filter}
              myMoves={mine}
              onClear={() => setFilter(clearedFilter(filter, mine))}
              claimResults={claimResults}
              claimsPending={claimsOn && withClaims && claims.isPending}
            />
          </>
        )}
      </div>
      {data && <LeagueTxFilterSheet leagueId={leagueId} detail={data} myTeamId={myTeamId} open={open} onOpenChange={setOpen} myMoves={mine} />}
    </MobileScreen>
  )
}

/** Claims are waiver moves: shown under All types and Waivers. */
function showsClaims(filter: TxFilter): boolean {
  return filter.type === 'All' || filter.type === 'Waivers'
}

/** The league takes claims (the Team tab's own test). */
function claimsLive(detail: LeagueDetail): boolean {
  return detail.waivers_live !== false && detail.settings.waiver_type !== 'none_fcfs' && detail.waiver_window?.waivers !== false
}

/** Your pending claims in the order the waiver run tries them, each with
 *  Edit (its bid and drop) and Cancel, and — with two or more — the Claim
 *  order door (gap list §3 #13). Nothing at all when there are none. */
function PendingClaims({ leagueId, doc }: { leagueId: string; doc: WaiverClaimsDocument }) {
  const cancel = useCancelClaim(leagueId)
  const [editing, setEditing] = useState<string | null>(null)
  const [ordering, setOrdering] = useState(false)
  const pending = useMemo(() => claimsInRunOrder(doc.claims, doc.waiver_type), [doc])
  const ids = useMemo(() => pending.flatMap((c) => [c.add.player_id, ...(c.drop ? [c.drop.player_id] : [])]), [pending])
  const players = usePlayersByIds(ids)
  const faab = doc.waiver_type === 'faab'
  if (pending.length === 0) return null
  return (
    <section aria-label="Pending claims" className="pt-1" data-pending-claims>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <p className="text-[12px] font-semibold text-m-t3">Pending claims</p>
        {pending.length >= 2 && <ClaimOrderDoor onClick={() => setOrdering(true)} />}
      </div>
      {pending.map((c) => (
        <ClaimRow
          key={c.id}
          leagueId={leagueId}
          claim={c}
          faab={faab}
          playerById={players.playerById}
          cancelling={cancel.isPending && cancel.variables?.claim_id === c.id}
          onEdit={() => setEditing(c.id)}
          onCancel={() =>
            cancel
              .cancelAsync(c.id)
              .then(() => toast({ title: 'Claim cancelled' }))
              .catch((e: unknown) =>
                toast({ title: 'The claim wasn’t cancelled', description: e instanceof Error ? e.message : undefined, variant: 'destructive' }),
              )
          }
        />
      ))}
      <ClaimEditSheet leagueId={leagueId} doc={doc} claim={pending.find((c) => c.id === editing) ?? null} onClose={() => setEditing(null)} />
      <ClaimOrderSheet leagueId={leagueId} doc={doc} open={ordering && pending.length >= 2} onOpenChange={setOrdering} />
    </section>
  )
}

function ClaimRow({
  leagueId,
  claim,
  faab,
  playerById,
  cancelling,
  onEdit,
  onCancel,
}: {
  leagueId: string
  claim: WaiverClaimView
  faab: boolean
  playerById: ReadonlyMap<string, PlayerIdentity>
  cancelling: boolean
  onEdit: () => void
  onCancel: () => void
}) {
  const name = claim.add.full_name ?? playerById.get(claim.add.player_id)?.full_name ?? 'this player'
  return (
    <div className="flex flex-col gap-2 border-b border-m-b2 px-1 py-3" data-pending-claim={claim.id}>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-m-t3">
        <span className="flex h-[18px] flex-none items-center rounded-pill bg-m-go px-[7px] text-[10.5px] font-semibold text-m-gold">Waiver</span>
        <span className="whitespace-nowrap">Pending</span>
        <span className="flex-1" />
        {faab && <span className="flex-none text-[13px] font-semibold tabular-nums text-m-t1">${claim.faab_bid} bid</span>}
        <button
          type="button"
          onClick={onEdit}
          disabled={cancelling}
          aria-label={`Edit the claim for ${name}`}
          className="ml-1.5 flex h-[26px] flex-none items-center rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-50"
          data-claim-edit-door
        >
          {EDIT_CLAIM_LABEL}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          aria-label={`Cancel the claim for ${name}`}
          className="flex h-[26px] flex-none items-center rounded-pill bg-m-b2 px-3 text-[12px] font-semibold text-m-t1 active:bg-m-b2h disabled:opacity-50"
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
      <ClaimLine leagueId={leagueId} player={claim.add} identity={playerById.get(claim.add.player_id) ?? null} tone="add" />
      {claim.drop && <ClaimLine leagueId={leagueId} player={claim.drop} identity={playerById.get(claim.drop.player_id) ?? null} tone="drop" />}
    </div>
  )
}

function ClaimLine({
  leagueId,
  player,
  identity,
  tone,
}: {
  leagueId: string
  player: WaiverClaimPlayer
  identity: PlayerIdentity | null
  tone: 'add' | 'drop'
}) {
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const name = player.full_name ?? identity?.full_name ?? 'Unknown player'
  const verb = tone === 'add' ? 'Claim' : 'Drop'
  const color = tone === 'add' ? 'text-positive-strong' : 'text-negative-strong'
  return (
    <button type="button" onClick={() => openPlayer(player.player_id, leagueId)} className="flex w-full items-center gap-2.5 text-left" aria-label={`${name} — ${verb}`}>
      <span className="flex w-4 flex-none justify-center">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden="true" className={color}>
          <path d={tone === 'add' ? 'M8 3.5v9M3.5 8h9' : 'M3.5 8h9'} />
        </svg>
      </span>
      <MHeadshot player={{ id: player.player_id, full_name: name, team: player.nfl_team, position: player.position, headshot_url: identity?.headshot_url ?? null }} size={32} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold text-m-t1">{shortName(name, player.position)}</span>
        {moveSub(player.position, player.nfl_team) && (
          <span className="truncate text-[11px] font-medium text-m-t3">{moveSub(player.position, player.nfl_team)}</span>
        )}
      </span>
      <span className={`flex-none text-[11px] font-semibold ${color}`}>{verb}</span>
    </button>
  )
}
