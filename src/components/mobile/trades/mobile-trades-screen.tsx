'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { formatInstantWithDate } from '@/components/leagues/lineup-editor-ops'
import {
  DEADLINE_PASSED_TITLE,
  deadlinePassedCopy,
  NO_TEAM_TRADE_COPY,
  NOT_IN_SEASON_TRADE_COPY,
  reviewModeCopy,
  splitTrades,
  TRADES_HISTORY_EMPTY_COPY,
  TRADES_PENDING_EMPTY_COPY,
  TRADES_UNAVAILABLE_TITLE,
  isTradesUnavailable,
  tradeDeadlineLine,
  tradeDoorStep,
} from '@/components/leagues/trades-ops'
import { problemCopy } from '@/components/leagues/team-page'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileOverrideStrip } from '@/components/mobile/league/override-strip'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MobileScreen, RoundNavButton } from '@/components/mobile/ui/mobile-header'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { useAuth } from '@/hooks/use-auth'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { tradeDeadlinePassed, useTradeDeadline } from '@/hooks/use-trade-deadline'
import { useTradesLive } from '@/hooks/use-trades'
import type { TradeView } from '@/lib/leagues/api/trades-service'

import { TeamAvatar } from '@/components/mobile/league/team/team-avatar'
import { sinceText, teamOrder } from '@/components/mobile/league/team/team-ops'

import { StatusPill } from './trade-ui'
import { TradeBuilderOverlay } from './trade-builder-overlay'
import { TradeDetailOverlay } from './trade-detail-overlay'
import { assetsOf, rowPill } from './trades-mobile-ops'

/**
 * The league's Trades page on mobile (`…/leagues/[id]/trades`). The handoff
 * keeps trades in Messages › Trades; the app keeps them in the league, so
 * this page extends the handoff's language: a 52px top bar, the deadline
 * line, "Propose a trade", Pending / History, and a row per trade that opens
 * the Trade offer screen (§2.4). The builder (§2.5–2.6) and the detail are
 * full-screen overlays over it. `?with=&player=` (the doors from a team page,
 * a player) opens the builder; `?trade=` opens one trade — closing either
 * goes back to where the door was.
 *
 * Back goes back to where you came from (Chris #27, `useGoBack`) — or,
 * opened fresh from a link, to the League tab. Closing a door's builder or
 * trade opened fresh from a link leaves you on this Trades list instead.
 */
export function MobileTradesScreen({
  leagueId,
  initialWith,
  initialPlayer,
  initialTrade,
}: {
  leagueId: string
  initialWith: string | null
  initialPlayer: string | null
  initialTrade: string | null
}) {
  const league = useLeague(leagueId)
  const { user, isLoading: authLoading } = useAuth()
  const goBack = useGoBack()
  const back = () => goBack(`/app/leagues/${leagueId}`)
  const doorClose = () => goBack(`/app/leagues/${leagueId}/trades`)
  const header = (
    <>
      <div className="flex h-[52px] items-center px-3">
        <RoundNavButton kind="back" onClick={back} />
        <h1 className="min-w-0 flex-1 truncate text-center text-[16px] font-semibold">Trades</h1>
        <span className="size-9 flex-none" aria-hidden />
      </div>
      <MobileOverrideStrip leagueId={leagueId} className="mb-1.5" />
    </>
  )
  if (league.isPending || (!user && authLoading)) {
    return (
      <MobileScreen header={header}>
        <div className="flex flex-col gap-3 px-4 pt-2" aria-busy="true">
          <div className="h-4 w-3/4 rounded-[6px] bg-m-b1" />
          <div className="h-11 rounded-pill bg-m-b1" />
          <div className="h-9 rounded-[10px] bg-m-b1" />
          <div className="h-[68px] rounded-[14px] bg-m-b1" />
          <div className="h-[68px] rounded-[14px] bg-m-b1" />
        </div>
      </MobileScreen>
    )
  }
  if (league.isError || !league.data) {
    return (
      <MobileScreen header={header}>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" role="alert">
          <p className="text-[15px] font-semibold">Couldn’t load this league.</p>
          <p className="text-[13px] font-medium text-m-t3">{problemCopy(league.error)}</p>
          <button type="button" onClick={() => void league.refetch()} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
            Retry
          </button>
        </div>
      </MobileScreen>
    )
  }
  return (
    <MobileScreen header={header}>
      <TradesBody leagueId={leagueId} detail={league.data} initialWith={initialWith} initialPlayer={initialPlayer} initialTrade={initialTrade} onDoorClose={doorClose} />
    </MobileScreen>
  )
}

type Builder = { mode: 'propose'; to: string | null; get: string[]; fromDoor: boolean } | { mode: 'counter'; trade: TradeView }

function TradesBody({
  leagueId,
  detail,
  initialWith,
  initialPlayer,
  initialTrade,
  onDoorClose,
}: {
  leagueId: string
  detail: LeagueDetail
  initialWith: string | null
  initialPlayer: string | null
  initialTrade: string | null
  onDoorClose: () => void
}) {
  const { user } = useAuth()
  const trades = useTradesLive(leagueId)
  const deadline = useTradeDeadline(leagueId)
  const pastDeadline = tradeDeadlinePassed(deadline.data)
  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'
  const tz = detail.settings.draft.time_zone ?? null
  const fmt = (iso: string) => formatInstantWithDate(iso, tz).local
  const order = useMemo(() => teamOrder(detail.teams), [detail.teams])
  const [tab, setTab] = useState<'pending' | 'history'>('pending')
  const [builder, setBuilder] = useState<Builder | null>(null)
  const [openTrade, setOpenTrade] = useState<{ id: string; fromDoor: boolean } | null>(initialTrade ? { id: initialTrade, fromDoor: true } : null)

  // The `?with=` / `?player=` door — decided the first time the viewer's team
  // is known, once (the desktop trade center's `tradeDoorStep`, F480).
  const decided = useRef(false)
  useEffect(() => {
    const step = tradeDoorStep(decided.current, myTeamId, { with: initialWith, player: initialPlayer })
    decided.current = step.decided
    if (step.open && inSeason) setBuilder({ mode: 'propose', to: step.open.toTeamId, get: step.open.getPlayerIds, fromDoor: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the door reads the URL once, when the team first becomes known
  }, [myTeamId])

  const { pending, history } = useMemo(() => splitTrades(trades.data?.trades ?? []), [trades.data])
  const shown = tab === 'pending' ? pending : history
  const deadlineView = deadline.data?.state === 'known' ? deadline.data.view : null
  const deadlineWeek = trades.data?.settings.trade_deadline_week ?? detail.settings.trade_deadline_week

  const unavailable = trades.isError && isTradesUnavailable(trades.error)

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-1" data-mobile-trades>
      <div className="flex flex-col gap-1">
        <p className="text-[12px] font-medium text-m-t3">{tradeDeadlineLine(deadlineWeek, deadlineView, fmt)}</p>
        {trades.data && <p className="text-[12px] font-medium text-m-t3">{reviewModeCopy(trades.data.settings)}</p>}
      </div>

      {!inSeason ? (
        <p className="rounded-[14px] bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t3">{NOT_IN_SEASON_TRADE_COPY}</p>
      ) : !myTeamId ? (
        <p className="rounded-[14px] bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t3">{NO_TEAM_TRADE_COPY}</p>
      ) : pastDeadline && deadlineView ? (
        <div className="flex flex-col gap-1 rounded-[14px] bg-m-go px-3 py-2.5" role="status">
          <p className="text-[13px] font-semibold text-m-to">{DEADLINE_PASSED_TITLE}</p>
          <p className="text-[12px] font-medium text-m-t2">{deadlinePassedCopy(deadlineView, fmt)}</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setBuilder({ mode: 'propose', to: null, get: [], fromDoor: false })}
          className="flex h-11 items-center justify-center gap-[7px] rounded-pill bg-accent text-[14px] font-semibold text-white active:bg-accent-strong"
          data-propose-open
        >
          <MIcon name="trade" size={15} stroke={1.8} />
          Propose a trade
        </button>
      )}

      <MSegmented
        label="Trades"
        value={tab}
        onChange={setTab}
        className="h-9 rounded-[10px]"
        itemClassName="h-8"
        options={[
          { value: 'pending', label: trades.data ? `Pending · ${pending.length}` : 'Pending' },
          { value: 'history', label: 'History' },
        ]}
      />

      {unavailable ? (
        <div className="flex flex-col items-center gap-1.5 py-8 text-center">
          <p className="text-[15px] font-semibold">{TRADES_UNAVAILABLE_TITLE}</p>
          <p className="text-[13px] font-medium text-m-t3">{trades.error instanceof Error ? trades.error.message : ''}</p>
        </div>
      ) : trades.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[68px] rounded-[14px] bg-m-b1" />
          ))}
        </div>
      ) : trades.isError && !trades.data ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
          <p className="text-[14px] font-medium text-m-t3">Couldn’t load this league’s trades.</p>
          <button type="button" onClick={() => void trades.refetch()} className="h-9 rounded-pill bg-m-b2 px-4 text-[13px] font-semibold">
            Retry
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] font-medium text-m-t3" data-empty={tab}>
          {tab === 'pending' ? TRADES_PENDING_EMPTY_COPY : TRADES_HISTORY_EMPTY_COPY}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-trades={tab}>
          {shown.map((t) => (
            <li key={t.id}>
              <TradeRow trade={t} myTeamId={myTeamId} order={order} now={trades.data?.evaluated_at ?? null} onOpen={() => setOpenTrade({ id: t.id, fromDoor: false })} />
            </li>
          ))}
        </ul>
      )}

      {openTrade && (
        <TradeDetailOverlay
          leagueId={leagueId}
          detail={detail}
          tradeId={openTrade.id}
          onClose={() => {
            const door = openTrade.fromDoor
            setOpenTrade(null)
            if (door && !builder) onDoorClose()
          }}
          onCounter={(trade) => {
            setOpenTrade(null)
            setBuilder({ mode: 'counter', trade })
          }}
        />
      )}
      {builder && (
        <TradeBuilderOverlay
          leagueId={leagueId}
          detail={detail}
          mode={builder.mode}
          initialTo={builder.mode === 'propose' ? builder.to : null}
          initialGet={builder.mode === 'propose' ? builder.get : []}
          counterOf={builder.mode === 'counter' ? builder.trade : null}
          onClose={() => {
            const door = builder.mode === 'propose' && builder.fromDoor
            setBuilder(null)
            if (door) onDoorClose()
          }}
        />
      )}
    </div>
  )
}

/** One trade in the list: both teams' avatars, who it's with, what moves,
 *  how long ago, and the viewer's status pill. */
function TradeRow({ trade, myTeamId, order, now, onOpen }: { trade: TradeView; myTeamId: string | null; order: readonly string[]; now: string | null; onOpen: () => void }) {
  const meIn = myTeamId === trade.proposer.team_id || myTeamId === trade.recipient.team_id
  const other = myTeamId === trade.proposer.team_id ? trade.recipient : trade.proposer
  const title = meIn
    ? myTeamId === trade.proposer.team_id
      ? `Offer to ${other.name ?? 'a team'}`
      : `Offer from ${other.name ?? 'a team'}`
    : `${trade.proposer.name ?? 'A team'} ⇄ ${trade.recipient.name ?? 'a team'}`
  const perspective = meIn ? myTeamId! : trade.proposer.team_id
  const { receives, sends } = assetsOf(trade, perspective)
  const names = (list: typeof receives) => (list.length === 0 ? 'nothing' : list.length === 1 ? list[0].name : `${list[0].name} +${list.length - 1}`)
  const sub = `${meIn ? 'Get' : `${trade.proposer.name ?? 'They'} get`} ${names(receives)} for ${names(sends)}`
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-[14px] bg-m-b1 p-3 text-left active:bg-m-b2" data-trade-row={trade.id}>
      <span className="flex flex-none items-center">
        <TeamAvatar teamId={trade.proposer.team_id} name={trade.proposer.name} teamIds={order} myTeamId={myTeamId} size={28} fontSize={11} />
        <TeamAvatar teamId={trade.recipient.team_id} name={trade.recipient.name} teamIds={order} myTeamId={myTeamId} size={28} fontSize={11} className="-ml-2 ring-2 ring-m-b1" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[14px] font-semibold">{title}</span>
        <span className="truncate text-[12px] font-medium text-m-t3">
          {sub}
          {now ? ` · ${sinceText(trade.created_at, now)}` : ''}
        </span>
      </span>
      <StatusPill pill={rowPill(trade, myTeamId)} />
    </button>
  )
}
