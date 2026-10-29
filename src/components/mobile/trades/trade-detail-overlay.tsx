'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'

import { lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import {
  acceptGate,
  COMMISH_CONFIRM_COPY,
  COMMISH_CONFIRM_TITLE,
  COMMISH_OP_LABELS,
  commishConfirmLines,
  commishOutcomeCopy,
  dropsNeeded,
  dropsNeededCopy,
  dropsPromptCopy,
  lockedAssetTitle,
  NEVER_WHO_VOTED_COPY,
  rosterWords,
  tallyWords,
  tradeActions,
  tradeSides,
  tradeStatusView,
} from '@/components/leagues/trades-ops'
import { leagueSize } from '@/components/mobile/home/home-ops'
import { initials, leagueAvClass } from '@/components/mobile/shell/use-league-card'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAuth } from '@/hooks/use-auth'
import { useCommishTrade } from '@/hooks/use-commish-trade'
import { useLeagueScoringFamily } from '@/hooks/use-draft-pool'
import type { LeagueDetail } from '@/hooks/use-league'
import { useLeagues } from '@/hooks/use-leagues'
import { usePlayersByIds } from '@/hooks/use-players-by-ids'
import { useRostersLive } from '@/hooks/use-rosters'
import { useTradeAction } from '@/hooks/use-trade-action'
import { useTradeDeadline } from '@/hooks/use-trade-deadline'
import { useTradePreview } from '@/hooks/use-trade-preview'
import { useTradesLive } from '@/hooks/use-trades'
import { toast } from '@/hooks/use-toast'
import { rawErrorText, userFacingMessage } from '@/lib/leagues/api/client-fetch'
import type { CommishTradeOp, TradeView } from '@/lib/leagues/api/trades-service'
import { UsernameLink } from '@/components/shared/username-link'
import { cn } from '@/lib/utils'
import { useOverrideMode } from '@/stores/commish-override-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { posCode, sinceText, teamOrder } from '@/components/mobile/league/team/team-ops'
import { shortPlayerName } from '@/utils/format-name'

import { MOverlay, MOverlayScroll, MSwitch } from './m-overlay'
import { CloseButton, FaabDisc, StatusPill } from './trade-ui'
import { assetsOf, finishedFooter, managerOf, sidePill, type TradeAsset } from './trades-mobile-ops'

/**
 * "Trade offer" — one trade, mobile (handoff League › Team §2.4, D1–D3), on
 * the app's trades read and verbs. Who may press what is `tradeActions`;
 * Accept is gated by the league's answer (`acceptGate` over 162's preview) —
 * when the roster would overflow, the drops are picked HERE as part of
 * accepting; every refusal is the server's own sentence. The app's richer
 * states are kept in the handoff's look: review / league-vote tally, a
 * deferred trade, the commissioner's review and override tools (force
 * confirmed with before → after), FAAB legs and drops.
 *
 * Not built (no backend): a per-offer expiry ("expires in 2 days"), draft
 * picks as assets, and the "Message @mgr" chip (direct messages have no
 * backend — the app can't open a conversation with a manager).
 */
export function TradeDetailOverlay({
  leagueId,
  detail,
  tradeId,
  onClose,
  onCounter,
}: {
  leagueId: string
  detail: LeagueDetail
  tradeId: string
  onClose: () => void
  /** Counter → the builder, prefilled from this offer (the host closes
   *  this detail and opens the builder). */
  onCounter: (trade: TradeView) => void
}) {
  const trades = useTradesLive(leagueId)
  const trade = trades.data?.trades.find((t) => t.id === tradeId) ?? null
  const { data: leagues } = useLeagues({ enabled: true })
  const leagueIndex = Math.max(0, (leagues ?? []).findIndex((l) => l.id === leagueId))
  const leagueRow = leagues?.find((l) => l.id === leagueId)
  // The handoff's league tag is the league's size and scoring ("12-team
  // standard", m-team §2.4) — the same words as the Switch league sheet.
  const { family } = useLeagueScoringFamily(leagueId)
  const format = leagueSize(leagueRow?.team_count ?? detail.teams.length, family)

  return (
    <MOverlay label="Trade offer" onClose={onClose}>
      <div className="flex h-[52px] flex-none items-center justify-between px-3">
        <CloseButton onClick={onClose} />
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-m-t3">
          {/* The tile's letters come with its fill (`leagueAvClass` — dark on gold, ruling #38). */}
          <span className={cn('flex size-5 items-center justify-center rounded text-[9px] font-semibold', leagueAvClass(leagueIndex))}>
            {initials(detail.league.name)}
          </span>
          {format}
        </span>
      </div>
      {trade ? (
        <DetailBody key={trade.id} leagueId={leagueId} detail={detail} trade={trade} evaluatedAt={trades.data?.evaluated_at ?? null} lockBehavior={trades.data?.settings.trade_lock_behavior ?? detail.settings.trade_lock_behavior} review={trades.data?.settings.trade_review ?? detail.settings.trade_review} onClose={onClose} onCounter={onCounter} />
      ) : trades.isPending ? (
        <MOverlayScroll className="flex flex-col gap-5 px-4 pt-1">
          <div className="h-8 w-40 rounded-[10px] bg-m-b1" />
          <div className="h-36 rounded-[14px] bg-m-b1" />
          <div className="h-36 rounded-[14px] bg-m-b1" />
        </MOverlayScroll>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
          <p className="text-[14px] font-medium text-m-t3">{trades.isError ? 'Couldn’t load this league’s trades.' : 'This trade isn’t in this league anymore.'}</p>
          {trades.isError && (
            <button type="button" onClick={() => void trades.refetch()} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
              Retry
            </button>
          )}
        </div>
      )}
    </MOverlay>
  )
}

function DetailBody({
  leagueId,
  detail,
  trade,
  evaluatedAt,
  lockBehavior,
  review,
  onClose,
  onCounter,
}: {
  leagueId: string
  detail: LeagueDetail
  trade: TradeView
  evaluatedAt: string | null
  lockBehavior: string
  review: string
  onClose: () => void
  onCounter: (trade: TradeView) => void
}) {
  const router = useRouter()
  const { user } = useAuth()
  const openPlayer = usePlayerModalStore((s) => s.openPlayerView)
  const rosters = useRostersLive(leagueId)
  const deadline = useTradeDeadline(leagueId)
  const act = useTradeAction(leagueId)
  const commish = useCommishTrade(leagueId)
  const overrideMode = useOverrideMode(leagueId)
  const [hide, setHide] = useState(false)
  const [acceptDrops, setAcceptDrops] = useState<string[]>([])
  const [confirmForce, setConfirmForce] = useState(false)
  const [last, setLast] = useState<'act' | 'commish' | null>(null)

  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'
  const viewer = { teamId: myTeamId, isCommissioner: isCommish, overrideMode: overrideMode && isCommish, inSeason }
  const rosterOf = (teamId: string) => rosters.data?.teams.find((t) => t.team_id === teamId) ?? null
  const actions = tradeActions(trade, viewer, { proposerHasManager: (rosterOf(trade.proposer.team_id)?.manager_user_id ?? null) !== null })
  const tz = detail.settings.draft.time_zone ?? null
  const fmt = (iso: string) => formatInstantWithDate(iso, tz).local
  const status = tradeStatusView(trade, fmt)
  const deadlineView = deadline.data?.state === 'known' ? deadline.data.view : null

  const lockedIds = new Set((rosters.data?.teams ?? []).flatMap((t) => t.roster.filter((p) => lockBadgeFor(p.game_lock, true).locked).map((p) => p.player_id)))
  const lockedNames = [
    ...trade.items.filter((i) => i.player && lockedIds.has(i.player.player_id)).map((i) => i.player!.full_name ?? i.player!.player_id),
    ...trade.drops.filter((d) => lockedIds.has(d.player.player_id)).map((d) => d.player.full_name ?? d.player.player_id),
  ]
  const answering = actions.accept && trade.status === 'proposed'
  const preview = useTradePreview(leagueId, answering && !deadlineView?.passed ? { kind: 'accept', tradeId: trade.id, drops: acceptDrops } : null)
  const gate = answering ? acceptGate({ preview, deadline: deadlineView, lockBehavior, review, lockedNames, proposerName: trade.proposer.name ?? 'the other team', fmt }) : null
  const checked = gate !== null && gate.state !== 'fallback' && gate.state !== 'failed'
  const recipientRoster = rosterOf(trade.recipient.team_id)
  const giving = new Set(trade.items.filter((i) => i.from_team_id === trade.recipient.team_id && i.player).map((i) => i.player!.player_id))
  const tally = trade.status === 'in_review' && trade.tally ? tallyWords(trade.tally) : null

  const pending = act.isPending || commish.isPending
  const refusal = last === 'act' && act.isError ? (rawErrorText(act.error) ?? 'That was refused.') : last === 'commish' && commish.isError ? (rawErrorText(commish.error) ?? 'That was refused.') : null
  // Before 162 (no preview): the server said the receiving roster overflows —
  // the picker opens with the count from its sentence (the desktop card's D419).
  const overflow = refusal ? dropsNeeded(refusal) : null
  const recipientOverflows = actions.accept && overflow !== null && overflow.teamName === trade.recipient.name
  const needsDrops = (checked && (gate.state === 'needs_drops' || (gate.mustDrop === 0 && acceptDrops.length > 0))) || recipientOverflows

  // My side first when I'm in the trade (the handoff's "me, then them").
  const mine = myTeamId === trade.recipient.team_id ? trade.recipient : trade.proposer
  const theirs = mine.team_id === trade.recipient.team_id ? trade.proposer : trade.recipient
  const meParty = myTeamId === trade.recipient.team_id || myTeamId === trade.proposer.team_id
  const iSent = myTeamId === trade.proposer.team_id
  const subtitle = `${meParty ? (iSent ? 'You sent ' : 'Sent to you ') : `${trade.proposer.name ?? 'A team'} sent `}${evaluatedAt ? sinceText(trade.created_at, evaluatedAt) : fmt(trade.created_at)}`
  const playerIds = trade.items.flatMap((i) => (i.player ? [i.player.player_id] : []))
  const identity = usePlayersByIds(playerIds)
  const sides = tradeSides(trade)
  const dropsOf = (teamId: string) => sides.find((s) => s.teamId === teamId)?.drops ?? []

  const respond = (op: 'accept' | 'reject' | 'cancel', drops?: string[]) => {
    setLast('act')
    commish.reset()
    const input = op === 'accept' ? { tradeId: trade.id, op, drops } : { tradeId: trade.id, op }
    act
      .submitAsync(input)
      .then(() => {
        const who = managerOf(detail, trade.proposer.team_id)
        toast({ title: op === 'accept' ? `Trade accepted with ${who ? `@${who}` : (trade.proposer.name ?? 'them')}` : op === 'reject' ? 'Trade declined' : 'Offer withdrawn' })
        onClose()
      })
      .catch(() => {})
  }
  const vote = (v: 'veto' | 'approve') => {
    setLast('act')
    commish.reset()
    act
      .submitAsync({ tradeId: trade.id, op: 'vote', vote: v })
      .then(() => toast({ title: v === 'veto' ? 'Veto vote counted' : 'Vote counted' }))
      .catch(() => {})
  }
  const commishOp = (op: CommishTradeOp) => {
    setLast('commish')
    act.reset()
    commish
      .submitAsync({ tradeId: trade.id, op })
      .then((result) => toast({ title: commishOutcomeCopy(result, (id) => trade.items.find((i) => i.player?.player_id === id)?.player?.full_name ?? null) }))
      .catch(() => {})
      .finally(() => setConfirmForce(false))
  }

  const sideBlock = (ref: TradeView['proposer'], n: 1 | 2) => {
    const handle = managerOf(detail, ref.team_id)
    const { receives, sends } = assetsOf(trade, ref.team_id)
    const drops = dropsOf(ref.team_id)
    return (
      <section className="flex flex-col gap-2" data-trade-side={ref.team_id}>
        <div className="flex items-center gap-2">
          <TeamAvatar teamId={ref.team_id} name={ref.name} teamIds={order} myTeamId={myTeamId} size={28} fontSize={11} label={hide ? String(n) : undefined} />
          <span className="flex min-w-0 flex-1 flex-col">
            {/* The @handle is a door to the manager's profile (usernames always
                link — Chris 2026-09-30); the team name opens the team view
                (the handoff's name tap). My own team's name is a no-op. */}
            {hide ? (
              <span className="truncate text-[14px] font-semibold">Team {n}</span>
            ) : handle ? (
              <UsernameLink username={handle} className="truncate text-[14px] font-semibold" />
            ) : (
              <span className="truncate text-[14px] font-semibold">{ref.name ?? 'A team'}</span>
            )}
            {!hide && (
              <button
                type="button"
                disabled={ref.team_id === myTeamId}
                onClick={() => router.push(`/app/leagues/${leagueId}/team/${ref.team_id}`)}
                className="truncate text-left text-[11px] font-medium text-m-t3 disabled:cursor-default"
              >
                {ref.name ?? ''}
              </button>
            )}
          </span>
          <StatusPill pill={sidePill(trade, ref.team_id)} />
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-[14px] bg-m-b1">
          <div className="flex min-w-0 flex-col gap-2 border-r border-m-b3s px-3 pb-3 pt-[10px]">
            <span className="text-[11px] font-semibold text-m-green">Receives</span>
            {receives.map((a) => (
              <Asset key={a.key} a={a} headshot={a.playerId ? (identity.playerById.get(a.playerId)?.headshot_url ?? null) : null} onOpen={a.playerId ? () => openPlayer(a.playerId!, leagueId) : undefined} locked={Boolean(trade.in_flight && a.playerId && lockedIds.has(a.playerId))} />
            ))}
            {receives.length === 0 && <span className="text-[12px] font-medium text-m-t3">Nothing</span>}
          </div>
          <div className="flex min-w-0 flex-col gap-2 px-3 pb-3 pt-[10px]">
            <span className="text-[11px] font-semibold text-m-red">Sends</span>
            {sends.map((a) => (
              <Asset key={a.key} a={a} headshot={a.playerId ? (identity.playerById.get(a.playerId)?.headshot_url ?? null) : null} onOpen={a.playerId ? () => openPlayer(a.playerId!, leagueId) : undefined} locked={Boolean(trade.in_flight && a.playerId && lockedIds.has(a.playerId))} />
            ))}
            {sends.length === 0 && <span className="text-[12px] font-medium text-m-t3">Nothing</span>}
          </div>
        </div>
        {drops.length > 0 && (
          <p className="text-[11px] font-medium text-m-t3">
            Drops {drops.map((d) => d.name).join(', ')} to make room
          </p>
        )}
      </section>
    )
  }

  const finished = finishedFooter(trade)
  const showDecline = actions.reject
  const showCounter = actions.counter && !(gate?.pastDeadline ?? false)
  const acceptShown = actions.accept && gate?.state !== 'blocked'
  const acceptEnabled =
    (gate === null || gate.state === 'fallback' || gate.state === 'failed' || gate.state === 'ready') && (!recipientOverflows || acceptDrops.length > 0)
  const answerButtons = [showDecline, showCounter, acceptShown].filter(Boolean).length

  return (
    <>
      <MOverlayScroll className="flex flex-col gap-5 px-4 pb-6 pt-1">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[26px] font-bold tracking-[-0.03em]">Trade offer</h1>
          <p className="text-[12px] font-medium text-m-t3">{subtitle}</p>
        </div>

        {sideBlock(mine, 1)}
        {sideBlock(theirs, 2)}

        {trade.note && <p className="rounded-[14px] bg-m-b1 px-3 py-2.5 text-[13px] font-medium italic text-m-t2">“{trade.note}”</p>}

        {status.detail && trade.status !== 'proposed' && <p className="text-[12px] font-medium text-m-t3" data-trade-detail>{status.detail}</p>}

        {tally && trade.tally && (
          <div className="flex flex-col gap-0.5 rounded-[14px] bg-m-b1 px-3 py-2.5" data-trade-tally>
            <p className="text-[13px] font-semibold">{tally.count}</p>
            <p className="text-[12px] font-medium text-m-t3">{tally.rule}</p>
            {tally.mine && <p className="text-[12px] font-medium">{tally.mine}</p>}
            <p className="text-[11px] font-medium text-m-t3">{NEVER_WHO_VOTED_COPY}</p>
          </div>
        )}

        {lockedNames.length > 0 && trade.in_flight && <p className="text-[12px] font-medium text-m-t3">{lockedAssetTitle(lockBehavior)}</p>}

        {gate && gate.reason && gate.state !== 'checking' && (
          <p className="rounded-[14px] bg-m-go px-3 py-2.5 text-[12px] font-medium text-m-to" role="status" data-accept-gate={gate.state}>
            {gate.reason}
          </p>
        )}

        {needsDrops && recipientRoster && (
          <section className="flex flex-col gap-2" data-accept-drops>
            <p className="text-[12px] font-semibold">
              {checked && gate.mustDrop > 0
                ? dropsNeededCopy(gate.mustDrop, rosterWords(trade.recipient.name, myTeamId === trade.recipient.team_id))
                : recipientOverflows
                  ? dropsPromptCopy(overflow!.more)
                  : 'Dropped only if the trade goes through.'}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {recipientRoster.roster
                .filter((p) => !giving.has(p.player_id))
                .map((p) => {
                  const on = acceptDrops.includes(p.player_id)
                  return (
                    <button
                      key={p.player_id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAcceptDrops((d) => (d.includes(p.player_id) ? d.filter((x) => x !== p.player_id) : [...d, p.player_id]))}
                      className={cn('flex min-w-0 flex-col gap-px rounded-[12px] px-[10px] py-2 text-left', on ? 'bg-m-gr ring-[1.5px] ring-inset ring-m-tr' : 'bg-m-b1')}
                    >
                      <span className={cn('text-[10px] font-semibold', posTextClass(p.position))}>
                        {posCode(p.position)} · {p.nfl_team ?? 'FA'}
                      </span>
                      <span className="truncate text-[14px] font-semibold">{shortPlayerName(p.full_name, p.position)}</span>
                    </button>
                  )
                })}
            </div>
          </section>
        )}

        {refusal && !recipientOverflows && (
          <p role="alert" className="rounded-[14px] bg-m-gr px-3 py-2.5 text-[13px] font-medium text-m-tr">
            {userFacingMessage(refusal)}
          </p>
        )}

        <button type="button" role="switch" aria-checked={hide} onClick={() => setHide((h) => !h)} className="flex items-center justify-end gap-[10px]">
          <span className="text-right text-[12px] font-medium text-m-t3">Hide usernames for screenshots</span>
          <MSwitch on={hide} />
        </button>

      </MOverlayScroll>

      {/* Footer: exactly one of answer (D1) / withdraw (D2) / finished (D3),
          plus the vote / commissioner rows while a trade is under review. */}
      <div className="flex-none border-t border-m-b3">
        {answerButtons > 0 && trade.status === 'proposed' ? (
          <div className="grid gap-2 px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-3" style={{ gridTemplateColumns: `repeat(${answerButtons}, minmax(0, 1fr))` }}>
            {showDecline && (
              <button type="button" disabled={pending} onClick={() => respond('reject')} className="h-12 rounded-pill bg-m-gr text-[15px] font-semibold text-m-tr disabled:opacity-50" data-trade-op="reject">
                Decline
              </button>
            )}
            {showCounter && (
              <button
                type="button"
                disabled={pending}
                onClick={() => onCounter(trade)}
                className="h-12 rounded-pill bg-m-b2 text-[15px] font-semibold text-m-t1 disabled:opacity-50"
                data-trade-op="counter"
              >
                Counter
              </button>
            )}
            {acceptShown && (
              <button
                type="button"
                disabled={pending || !acceptEnabled}
                onClick={() => respond('accept', acceptDrops)}
                className="h-12 rounded-pill bg-confirm text-[15px] font-semibold text-white disabled:bg-m-b3s disabled:text-m-t3"
                data-trade-op="accept"
              >
                {act.isPending ? 'Sending…' : 'Accept'}
              </button>
            )}
          </div>
        ) : actions.cancel && trade.status === 'proposed' ? (
          <div className="px-4 pb-[max(28px,env(safe-area-inset-bottom))] pt-3">
            <button type="button" disabled={pending} onClick={() => respond('cancel')} className="h-12 w-full rounded-pill bg-m-gr text-[15px] font-semibold text-m-tr disabled:opacity-50" data-trade-op="cancel">
              {act.isPending ? 'Sending…' : 'Withdraw offer'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 px-4 pb-[max(30px,env(safe-area-inset-bottom))] pt-[14px]">
            {finished && (
              <p className={cn('text-center text-[13px] font-semibold', finished.tone === 'positive' ? 'text-m-green' : finished.tone === 'negative' ? 'text-m-tr' : 'text-m-t3')}>
                {finished.text}
              </p>
            )}
            {!finished && trade.status === 'proposed' && <p className="text-center text-[13px] font-semibold text-m-t3">{status.detail}</p>}
            {actions.vote && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={pending || trade.tally?.my_vote === 'veto'} onClick={() => vote('veto')} className="h-11 rounded-pill bg-m-gr text-[14px] font-semibold text-m-tr disabled:opacity-50">
                  Vote to veto
                </button>
                <button type="button" disabled={pending || trade.tally?.my_vote === 'approve'} onClick={() => vote('approve')} className="h-11 rounded-pill bg-m-b2 text-[14px] font-semibold disabled:opacity-50">
                  Let it through
                </button>
              </div>
            )}
            {(actions.reviewApprove || actions.reviewVeto) && (
              <div className="grid grid-cols-2 gap-2">
                {actions.reviewVeto && (
                  <button type="button" disabled={pending} onClick={() => commishOp('veto')} className="h-11 rounded-pill bg-m-gr text-[14px] font-semibold text-m-tr disabled:opacity-50">
                    Veto
                  </button>
                )}
                {actions.reviewApprove && (
                  <button type="button" disabled={pending} onClick={() => commishOp('approve')} className="h-11 rounded-pill bg-confirm text-[14px] font-semibold text-white disabled:opacity-50">
                    Approve
                  </button>
                )}
              </div>
            )}
            {(actions.overrideApprove || actions.overrideVeto || actions.force) && (
              <div className="flex flex-wrap justify-center gap-2" data-trade-override>
                {actions.overrideApprove && (
                  <button type="button" disabled={pending} onClick={() => commishOp('approve')} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold disabled:opacity-50">
                    {COMMISH_OP_LABELS.approve}
                  </button>
                )}
                {actions.overrideVeto && (
                  <button type="button" disabled={pending} onClick={() => commishOp('veto')} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold disabled:opacity-50">
                    {COMMISH_OP_LABELS.veto}
                  </button>
                )}
                {actions.force && (
                  <button type="button" disabled={pending} onClick={() => setConfirmForce(true)} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold disabled:opacity-50">
                    {COMMISH_OP_LABELS.force}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <MobileSheet open={confirmForce} onOpenChange={(o) => !o && !commish.isPending && setConfirmForce(false)} title={COMMISH_CONFIRM_TITLE} subtitle={COMMISH_CONFIRM_COPY}>
        <div className="flex flex-col gap-3 px-5 pb-2">
          <ul className="flex flex-col gap-1 rounded-[14px] bg-m-b1 px-3 py-2.5 text-[13px] font-medium">
            {commishConfirmLines(trade).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-[12px] font-medium text-m-t3">Logged for the whole league, and both managers are told.</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={commish.isPending} onClick={() => setConfirmForce(false)} className="h-12 rounded-pill bg-m-b2 text-[15px] font-semibold disabled:opacity-50">
              Cancel
            </button>
            <button type="button" disabled={commish.isPending} onClick={() => commishOp('force')} className="h-12 rounded-pill bg-accent text-[15px] font-semibold text-white disabled:opacity-50">
              {commish.isPending ? 'Working…' : COMMISH_OP_LABELS.force}
            </button>
          </div>
        </div>
      </MobileSheet>
    </>
  )
}

function Asset({ a, headshot, onOpen, locked }: { a: TradeAsset; headshot: string | null; onOpen?: () => void; locked: boolean }) {
  const inner = (
    <>
      {a.playerId ? (
        <MHeadshot player={{ id: a.playerId, full_name: a.name, team: a.nflTeam, position: a.position, headshot_url: headshot }} size={36} />
      ) : (
        <FaabDisc size={36} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold">{a.playerId ? shortPlayerName(a.name, a.position) : a.name}</span>
        <span className={cn('whitespace-nowrap text-[10px] font-semibold', a.position ? posTextClass(a.position) : 'text-m-t3')}>
          {a.playerId ? `${posCode(a.position)} · ${a.nflTeam ?? 'FA'}${locked ? ' · Locked' : ''}` : 'FAAB'}
        </span>
      </span>
    </>
  )
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-2 text-left">
      {inner}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-2">{inner}</div>
  )
}
