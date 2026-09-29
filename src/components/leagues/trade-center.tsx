'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { PositionBadge } from '@/components/players/position-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useAuth } from '@/hooks/use-auth'
import { useCommishTrade } from '@/hooks/use-commish-trade'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import { useProposeTrade } from '@/hooks/use-propose-trade'
import { useRostersLive } from '@/hooks/use-rosters'
import { useTradeAction } from '@/hooks/use-trade-action'
import { useTradesLive } from '@/hooks/use-trades'
import type { CommishTradeOp, CommishTradeResult, TradeView, TradesDocument } from '@/lib/leagues/api/trades-service'
import type { LeagueRosters, RosterTeam } from '@/lib/leagues/api/rosters-service'
import { cn } from '@/lib/utils'
import { useCommishOverrideStore, useOverrideMode } from '@/stores/commish-override-store'

import { TeamNameLink } from './league-cells'
import { formatInstantWithDate, lockBadgeFor } from './lineup-editor-ops'
import { OverrideModeBar } from './override-mode-bar'
import { ReconnectingBanner, StatusBanner } from './status-banners'
import { ProblemCard, problemCopy } from './team-page'
import { DropPicker, TradeBuilderView, type TradeBuilderSend } from './trade-builder'
import {
  COMMISH_OP_LABELS,
  COMMISH_TRADE_MODE_COPY,
  NEVER_WHO_VOTED_COPY,
  NOT_IN_SEASON_TRADE_COPY,
  NO_TEAM_TRADE_COPY,
  TRADES_ERROR_TITLE,
  TRADES_HISTORY_EMPTY_COPY,
  TRADES_PENDING_EMPTY_COPY,
  TRADES_TITLE,
  TRADES_UNAVAILABLE_TITLE,
  commishConfirmCopy,
  commishConfirmLines,
  commishConfirmTitle,
  commishOutcomeCopy,
  counterSeed,
  dropsNeeded,
  dropsPromptCopy,
  isDeadlineRefusal,
  isTradesUnavailable,
  lockedAssetTitle,
  reviewModeCopy,
  splitTrades,
  tallyWords,
  tradeActions,
  tradeDeadlineCopy,
  tradeDoorStep,
  type TradeDoorOpen,
  tradeSides,
  tradeStatusView,
  type TradeTone,
  type TradeViewer,
  plainRefusal,
} from './trades-ops'

/**
 * `trade-center` — spec §16.1 `…/leagues/[id]/trades`, §16.2 ("pending /
 * history tabs; review state (commish or league vote w/ tally), veto /
 * approve, deadline chip (§13.3)"), §16.5.2's Trade lifecycle row — M5 task
 * L.D3.7 (PROGRESS D419; F438, F450, F451, F452).
 *
 * **Data.** `useLeague` gates membership first (D316(4)); `useTradesLive`
 * reads `GET …/trades` (D417 — every member reads every trade; the count of a
 * league vote, never who) and re-reads on the room's `trades` event, on
 * rejoin, and every 30 s while any vote is open (F450's hook half);
 * `useRostersLive` feeds the builder's two columns and the 🔒 on trade assets
 * (the tick's lock view, `lockBadgeFor` — the lineup editor's one reading).
 *
 * **Deploy before push (D417(5)).** On a database without the trade objects
 * the read answers 503 with a named sentence: the page shows that state —
 * never a crash, never an empty "no trades".
 *
 * **Who presses what** is `tradeActions` — buttons only; every move is the
 * server's, and a refusal renders VERBATIM on the card it came from. The
 * commissioner's review of a trade under commissioner review is his job, so
 * Approve / Veto show without override mode; force, reverse, and overriding
 * a league vote or a deferred trade live INSIDE override mode (F451 — the ONE
 * switch, PROGRESS §3 rule (h); no reason field, Q66 / F343). Force and
 * reverse confirm with before → after (§10.4).
 *
 * States (§16.5.4): skeleton · empty per tab · error with retry · the named
 * 503 · reconnecting banner. No clock: every countdown is the read's own.
 */

interface TradesPageProps {
  leagueId: string
  /** `?with=<team>` / `?player=<id>` — the doors from a player row and a team page. */
  initialWith?: string | null
  initialPlayer?: string | null
}

export function TradesPage({ leagueId, initialWith = null, initialPlayer = null }: TradesPageProps) {
  const league = useLeague(leagueId)
  if (league.isPending) return <TradesSkeleton />
  if (league.isError || !league.data) {
    return <ProblemCard heading={TRADES_TITLE} title="Couldn’t load this league." detail={problemCopy(league.error)} onRetry={() => league.refetch()} leagueId={null} />
  }
  return <TradesContent leagueId={leagueId} detail={league.data} initialWith={initialWith} initialPlayer={initialPlayer} />
}

type Tab = 'pending' | 'history'

interface BuilderState {
  mode: 'propose' | 'counter'
  fromTeamId: string
  counterOf: TradeView | null
  initialTo: string | null
  initialGet: string[]
}

function TradesContent({ leagueId, detail, initialWith, initialPlayer }: { leagueId: string; detail: LeagueDetail; initialWith: string | null; initialPlayer: string | null }) {
  const { user } = useAuth()
  const trades = useTradesLive(leagueId)
  const rosters = useRostersLive(leagueId)
  const propose = useProposeTrade(leagueId)
  const act = useTradeAction(leagueId)
  const commish = useCommishTrade(leagueId)
  const overrideMode = useOverrideMode(leagueId)
  const enterOverride = useCommishOverrideStore((s) => s.enter)
  const exitOverride = useCommishOverrideStore((s) => s.exit)

  const myTeamId = detail.members.find((m) => m.user_id && m.user_id === user?.id)?.team_id ?? null
  const isCommish = detail.my_role === 'commissioner' || detail.my_role === 'co_commissioner'
  const inOverride = overrideMode && isCommish
  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'
  const leagueTimeZone = detail.settings.draft.time_zone ?? null
  const fmt = (iso: string) => formatInstantWithDate(iso, leagueTimeZone).local

  const [tab, setTab] = useState<Tab>('pending')
  // The `?with=` / `?player=` door (D419(6)). It needs the viewer's own team,
  // which needs the signed-in user — and `useAuth`'s session can resolve AFTER
  // the league read (a fresh page load races the two). Deciding only in the
  // initial state lost the door whenever the league won that race: the page
  // rendered the trade center with no builder (the M5 gate's red at
  // transactions.spec.ts:155, reproduced by delaying the session — PROGRESS
  // F480 / D423). So the door opens the FIRST time the team is known, once;
  // closing the builder never re-opens it.
  const door = { with: initialWith, player: initialPlayer }
  const asBuilder = (open: TradeDoorOpen): BuilderState => ({
    mode: 'propose',
    fromTeamId: open.fromTeamId,
    counterOf: null,
    initialTo: open.toTeamId,
    initialGet: open.getPlayerIds,
  })
  const [firstDoor] = useState(() => tradeDoorStep(false, myTeamId, door))
  const [builder, setBuilder] = useState<BuilderState | null>(() => (firstDoor.open ? asBuilder(firstDoor.open) : null))
  const doorDecided = useRef(firstDoor.decided)
  useEffect(() => {
    const step = tradeDoorStep(doorDecided.current, myTeamId, door)
    doorDecided.current = step.decided
    if (step.open) setBuilder(asBuilder(step.open))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the door reads the URL's params once, when the team first becomes known
  }, [myTeamId])
  const [builderKey, setBuilderKey] = useState(0)
  const [deadlineRefusal, setDeadlineRefusal] = useState<string | null>(null)
  const [lastCard, setLastCard] = useState<{ tradeId: string; kind: 'respond' | 'commish' } | null>(null)
  const [confirm, setConfirm] = useState<{ trade: TradeView; op: 'force' | 'reverse' } | null>(null)

  const noteRefusal = (message: string) => {
    if (isDeadlineRefusal(message)) setDeadlineRefusal(message)
  }

  const openBuilder = (state: BuilderState) => {
    propose.reset()
    act.reset()
    setBuilderKey((k) => k + 1)
    setBuilder(state)
  }

  const teams = rosters.data?.teams ?? []
  const fromChoices = inOverride ? teams.filter((t) => t.status !== 'retired').map((t) => ({ id: t.team_id, name: t.name })) : null
  const canPropose = inSeason && (myTeamId !== null || inOverride)
  const defaultFrom = myTeamId ?? fromChoices?.[0]?.id ?? null

  const counterSending = builder?.mode === 'counter'
  const builderMutation = counterSending ? act : propose
  // A counter-offer shares `useTradeAction` with the cards: its refusal is the
  // builder's only while no card has spoken since (`lastCard` null).
  const builderSpoke = builder?.mode !== 'counter' || lastCard === null
  const builderRefusal =
    builderSpoke && builderMutation.isError ? (builderMutation.error instanceof Error ? builderMutation.error.message : 'The offer was refused.') : null
  const sentTo = (() => {
    if (!builder) return null
    if (builder.mode === 'propose' && propose.data) return teams.find((t) => t.team_id === propose.data.trade.recipient_team_id)?.name ?? 'the other team'
    if (builder.mode === 'counter' && act.data && act.data.op === 'counter') return builder.counterOf?.proposer.name ?? 'the other team'
    return null
  })()

  const sendFromBuilder = (send: TradeBuilderSend) => {
    if (!builder) return
    const onError = (error: Error) => noteRefusal(error.message)
    if (builder.mode === 'counter' && builder.counterOf) {
      act.submitAsync({ tradeId: builder.counterOf.id, op: 'counter', legs: send.legs, drops: send.drops, note: send.note }).catch(onError)
      return
    }
    propose.submitAsync({ fromTeamId: send.fromTeamId, toTeamId: send.toTeamId, legs: send.legs, drops: send.drops, note: send.note }).catch(onError)
  }

  const header = (
    <PageHeader
      title={TRADES_TITLE}
      actions={
        <Button variant="stroke" size="sm" asChild>
          <Link href={`/app/leagues/${leagueId}`}>
            <Icon name="cup" size={13} />
            {detail.league.name}
          </Link>
        </Button>
      }
    />
  )

  const cardRefusal = (tradeId: string, kind: 'respond' | 'commish') => {
    if (lastCard?.tradeId !== tradeId || lastCard.kind !== kind) return null
    const m = kind === 'respond' ? act : commish
    return m.isError ? (m.error instanceof Error ? m.error.message : 'That was refused.') : null
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      {trades.connection === 'reconnecting' && <ReconnectingBanner>Reconnecting — syncing this league…</ReconnectingBanner>}

      {isCommish && (
        <OverrideModeBar on={inOverride} busy={commish.isPending} onToggle={(next) => (next ? enterOverride(leagueId) : exitOverride())}>
          {COMMISH_TRADE_MODE_COPY}
        </OverrideModeBar>
      )}

      <TradeCenterView
        doc={trades.data ?? null}
        loading={trades.isPending && !trades.data}
        error={trades.isError && !trades.data ? trades.error : null}
        onRetry={() => void trades.refetch()}
        deadlineWeek={trades.data?.settings.trade_deadline_week ?? detail.settings.trade_deadline_week}
        deadlineRefusal={deadlineRefusal}
        tab={tab}
        onTab={setTab}
        viewer={{ teamId: myTeamId, isCommissioner: isCommish, overrideMode: inOverride }}
        rosters={rosters.data ?? null}
        fmt={fmt}
        leagueId={leagueId}
        proposeDoor={
          !inSeason ? (
            <StatusBanner tone="neutral" className="text-n-3">
              {NOT_IN_SEASON_TRADE_COPY}
            </StatusBanner>
          ) : !canPropose ? (
            <StatusBanner tone="neutral" className="text-n-3">
              {NO_TEAM_TRADE_COPY}
            </StatusBanner>
          ) : builder && defaultFrom ? (
            <TradeBuilderView
              key={builderKey}
              mode={builder.mode}
              teams={teams}
              fromTeamId={builder.fromTeamId}
              fromChoices={builder.mode === 'propose' ? fromChoices : null}
              initial={
                builder.counterOf
                  ? counterSeed(builder.counterOf)
                  : { toTeamId: builder.initialTo ?? undefined, get: builder.initialGet }
              }
              allowFaab={(trades.data?.settings.allow_faab_in_trades ?? detail.settings.allow_faab_in_trades) && detail.settings.waiver_type === 'faab'}
              lockBehavior={trades.data?.settings.trade_lock_behavior ?? detail.settings.trade_lock_behavior}
              pending={builderMutation.isPending}
              refusal={builderRefusal}
              deadlineRefusal={deadlineRefusal}
              sentTo={sentTo}
              onFromTeam={(teamId) => openBuilder({ ...builder, fromTeamId: teamId, initialTo: null, initialGet: [] })}
              onSend={sendFromBuilder}
              onClose={() => {
                setBuilder(null)
                propose.reset()
                if (builder.mode === 'counter') act.reset()
              }}
            />
          ) : defaultFrom ? (
            <span>
              <Button
                variant="blue"
                size="sm"
                shadow
                onClick={() => openBuilder({ mode: 'propose', fromTeamId: defaultFrom, counterOf: null, initialTo: null, initialGet: [] })}
                data-propose-open
              >
                <Icon name="transfer" size={13} />
                Propose a trade
              </Button>
            </span>
          ) : null
        }
        onCounter={(trade) => {
          setLastCard(null)
          openBuilder({ mode: 'counter', fromTeamId: trade.recipient.team_id, counterOf: trade, initialTo: trade.proposer.team_id, initialGet: [] })
          if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onRespond={(trade, op, drops) => {
          setLastCard({ tradeId: trade.id, kind: 'respond' })
          commish.reset()
          const onError = (error: Error) => noteRefusal(error.message)
          if (op === 'accept') act.submitAsync({ tradeId: trade.id, op: 'accept', drops }).catch(onError)
          else act.submitAsync({ tradeId: trade.id, op }).catch(onError)
        }}
        onVote={(trade, vote) => {
          setLastCard({ tradeId: trade.id, kind: 'respond' })
          commish.reset()
          act.submitAsync({ tradeId: trade.id, op: 'vote', vote }).catch(() => {})
        }}
        onCommish={(trade, op) => {
          if (op === 'force' || op === 'reverse') {
            setConfirm({ trade, op })
            return
          }
          setLastCard({ tradeId: trade.id, kind: 'commish' })
          act.reset()
          commish.submitAsync({ tradeId: trade.id, op }).catch(() => {})
        }}
        pendingTradeId={act.isPending || commish.isPending ? (lastCard?.tradeId ?? null) : null}
        refusalFor={(tradeId) => cardRefusal(tradeId, 'respond') ?? cardRefusal(tradeId, 'commish')}
        commishResultFor={(tradeId) => (lastCard?.tradeId === tradeId && lastCard.kind === 'commish' && commish.data ? commish.data : null)}
      />

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && !commish.isPending && setConfirm(null)}>
        <DialogContent className="max-w-md">
          {confirm && (
            <DialogHeader>
              <DialogTitle>{commishConfirmTitle(confirm.op)}</DialogTitle>
              <DialogDescription>{commishConfirmCopy(confirm.op)}</DialogDescription>
            </DialogHeader>
          )}
          {confirm && (
            <CommishConfirm
              trade={confirm.trade}
              op={confirm.op}
              pending={commish.isPending}
              onConfirm={() => {
                setLastCard({ tradeId: confirm.trade.id, kind: 'commish' })
                act.reset()
                commish.submitAsync({ tradeId: confirm.trade.id, op: confirm.op }).catch(() => {}).finally(() => setConfirm(null))
              }}
              onCancel={() => setConfirm(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The view — props only, so every state renders without a network
// ---------------------------------------------------------------------------

export interface TradeCenterViewProps {
  leagueId: string
  doc: TradesDocument | null
  loading: boolean
  error: unknown
  onRetry: () => void
  deadlineWeek: number | null
  deadlineRefusal: string | null
  tab: Tab
  onTab: (tab: Tab) => void
  viewer: TradeViewer
  rosters: LeagueRosters | null
  fmt: (iso: string) => string
  /** The builder, its opener, or why there is none. */
  proposeDoor: React.ReactNode
  onCounter: (trade: TradeView) => void
  onRespond: (trade: TradeView, op: 'accept' | 'reject' | 'cancel', drops?: string[]) => void
  onVote: (trade: TradeView, vote: 'veto' | 'approve') => void
  onCommish: (trade: TradeView, op: CommishTradeOp) => void
  pendingTradeId: string | null
  refusalFor: (tradeId: string) => string | null
  commishResultFor: (tradeId: string) => CommishTradeResult | null
}

export function TradeCenterView(props: TradeCenterViewProps) {
  const { doc, loading, error, onRetry, deadlineWeek, deadlineRefusal, tab, onTab } = props
  const { pending, history } = useMemo(() => splitTrades(doc?.trades ?? []), [doc])

  if (error && isTradesUnavailable(error)) {
    return (
      <Card data-trades-unavailable>
        <CardContent className="flex flex-col items-start gap-2 p-4">
          <p className="text-[13px] font-bold">{TRADES_UNAVAILABLE_TITLE}</p>
          <p className="text-[12px] font-medium text-n-3">{error instanceof Error ? error.message : 'Trades aren’t available yet.'}</p>
        </CardContent>
      </Card>
    )
  }

  const lockedIds = new Set(
    (props.rosters?.teams ?? []).flatMap((t) => t.roster.filter((p) => lockBadgeFor(p.game_lock, true).locked).map((p) => p.player_id)),
  )
  const shown = tab === 'pending' ? pending : history

  return (
    <div className="flex flex-col gap-3" data-trade-center>
      <div className="flex flex-col gap-1.5">
        <StatusBanner tone={deadlineRefusal ? 'caution' : 'neutral'}>
          <span data-trade-deadline={deadlineWeek ?? 'none'}>{deadlineRefusal ? `🔒 ${deadlineRefusal}` : tradeDeadlineCopy(deadlineWeek)}</span>
        </StatusBanner>
        {doc && <p className="text-[11px] font-medium text-n-3" data-trade-review-mode={doc.settings.trade_review}>{reviewModeCopy(doc.settings)}</p>}
      </div>

      {props.proposeDoor}

      <Segment aria-label="Trades">
        <SegmentItem active={tab === 'pending'} onClick={() => onTab('pending')} count={doc ? pending.length : undefined} data-tab="pending">
          Pending
        </SegmentItem>
        <SegmentItem active={tab === 'history'} onClick={() => onTab('history')} data-tab="history">
          History
        </SegmentItem>
      </Segment>

      {loading ? (
        <div className="flex flex-col gap-2" data-skeleton="trades">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-sm" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-start gap-2 rounded-sm border border-negative bg-negative-soft px-3 py-2" role="alert" data-trades-error>
          <p className="text-[12px] font-bold">{TRADES_ERROR_TITLE}</p>
          <p className="text-[11px] font-medium text-n-3">{error instanceof Error ? error.message : 'The trades read failed.'}</p>
          <Button variant="stroke" size="sm" onClick={onRetry}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </div>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <Icon name="transfer" size={18} className="text-n-3" />
            <p className="max-w-md text-[13px] font-medium text-n-3" data-empty={tab}>
              {tab === 'pending' ? TRADES_PENDING_EMPTY_COPY : TRADES_HISTORY_EMPTY_COPY}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2" data-trades={tab}>
          {shown.map((trade) => (
            <li key={trade.id}>
              <TradeCard
                trade={trade}
                leagueId={props.leagueId}
                viewer={props.viewer}
                lockBehavior={doc?.settings.trade_lock_behavior ?? 'defer'}
                lockedIds={lockedIds}
                rosterOf={(teamId) => props.rosters?.teams.find((t) => t.team_id === teamId) ?? null}
                fmt={props.fmt}
                pending={props.pendingTradeId === trade.id}
                refusal={props.refusalFor(trade.id)}
                commishResult={props.commishResultFor(trade.id)}
                onCounter={props.onCounter}
                onRespond={props.onRespond}
                onVote={props.onVote}
                onCommish={props.onCommish}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One trade
// ---------------------------------------------------------------------------

const TONE_BADGE: Record<TradeTone, 'stroke-purple' | 'yellow' | 'stroke-green' | 'stroke-pink' | 'stroke'> = {
  accent: 'stroke-purple',
  caution: 'yellow',
  positive: 'stroke-green',
  negative: 'stroke-pink',
  neutral: 'stroke',
}

export interface TradeCardProps {
  trade: TradeView
  leagueId: string
  viewer: TradeViewer
  lockBehavior: string
  lockedIds: ReadonlySet<string>
  rosterOf: (teamId: string) => RosterTeam | null
  fmt: (iso: string) => string
  pending: boolean
  refusal: string | null
  commishResult: CommishTradeResult | null
  onCounter: (trade: TradeView) => void
  onRespond: (trade: TradeView, op: 'accept' | 'reject' | 'cancel', drops?: string[]) => void
  onVote: (trade: TradeView, vote: 'veto' | 'approve') => void
  onCommish: (trade: TradeView, op: CommishTradeOp) => void
}

export function TradeCard({
  trade,
  leagueId,
  viewer,
  lockBehavior,
  lockedIds,
  rosterOf,
  fmt,
  pending,
  refusal,
  commishResult,
  onCounter,
  onRespond,
  onVote,
  onCommish,
}: TradeCardProps) {
  const status = tradeStatusView(trade, fmt)
  const actions = tradeActions(trade, viewer)
  const sides = tradeSides(trade)
  const [acceptDrops, setAcceptDrops] = useState<string[] | null>(null)
  const overflow = refusal ? dropsNeeded(refusal) : null
  const recipientOverflows = overflow !== null && overflow.teamName === trade.recipient.name
  const pickingDrops = actions.accept && (acceptDrops !== null || recipientOverflows)
  const recipientRoster = rosterOf(trade.recipient.team_id)
  const giving = new Set(trade.items.filter((i) => i.from_team_id === trade.recipient.team_id && i.player).map((i) => i.player!.player_id))
  const tally = trade.status === 'in_review' && trade.tally ? tallyWords(trade.tally) : null
  const playerName = (id: string) => trade.items.find((i) => i.player?.player_id === id)?.player?.full_name ?? null

  return (
    <Card data-trade={trade.id} data-trade-status={trade.status}>
      <CardContent className="flex flex-col gap-2.5 px-card-pad py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={TONE_BADGE[status.tone]} data-trade-status-label>
            {status.label}
          </Badge>
          <span className="text-[12px] font-bold text-ink">
            <TeamNameLink name={trade.proposer.name ?? 'A team'} leagueId={leagueId} teamId={trade.proposer.team_id} />
            <span className="px-1 text-n-3">⇄</span>
            <TeamNameLink name={trade.recipient.name ?? 'A team'} leagueId={leagueId} teamId={trade.recipient.team_id} />
          </span>
          <span className="ml-auto text-[10px] font-medium text-n-3">Offered {fmt(trade.created_at)}</span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sides.map((side) => (
            <div key={side.teamId} className="flex min-w-0 flex-col gap-1 rounded-sm border border-n-4 px-2 py-1.5" data-trade-gives={side.teamId}>
              <p className="fs-overline text-[9px] text-n-3">{side.teamName} gives</p>
              {side.gives.length === 0 ? (
                <p className="text-[11px] font-medium text-n-3">Nothing</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {side.gives.map((g) => (
                    <li key={g.playerId ?? `faab-${g.faab}`} className="flex min-w-0 items-center gap-1.5 text-[12px]">
                      {g.position && <PositionBadge position={g.position} size="sm" />}
                      <span className="truncate font-bold text-ink">{g.name}</span>
                      {g.nflTeam && <span className="shrink-0 text-[10px] font-medium text-n-3">{g.nflTeam}</span>}
                      {trade.in_flight && g.playerId && lockedIds.has(g.playerId) && (
                        <Badge variant="black" title={lockedAssetTitle(lockBehavior)} data-lock>
                          🔒
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {side.drops.length > 0 && (
                <p className="text-[10px] font-medium text-n-3" data-trade-drops-of={side.teamId}>
                  Drops {side.drops.map((d) => d.name).join(', ')} to make room
                </p>
              )}
            </div>
          ))}
        </div>

        {trade.note && <p className="text-[11px] font-medium italic text-n-3">“{trade.note}”</p>}

        {status.detail && (
          <p className={cn('text-[11px] font-medium', status.tone === 'negative' ? 'text-ink' : 'text-n-3')} data-trade-detail>
            {status.detail}
          </p>
        )}

        {trade.deferred && (
          <span>
            <Badge variant="stroke" data-trade-deferred={trade.deferred.until ?? 'week-end'}>
              {trade.deferred.until ? `Goes through after the games · ${fmt(trade.deferred.until)}` : 'Goes through after this week’s last game'}
            </Badge>
          </span>
        )}

        {tally && trade.tally && (
          <div className="flex flex-col gap-0.5 rounded-sm border border-n-4 px-2 py-1.5" data-trade-tally={`${trade.tally.veto_votes}/${trade.tally.veto_number}`}>
            <p className="text-[12px] font-bold text-ink">{tally.count}</p>
            <p className="text-[11px] font-medium text-n-3" data-trade-tally-rule={trade.tally.capped ? 'capped' : 'setting'}>
              {tally.rule}
            </p>
            {tally.mine && <p className="text-[11px] font-medium text-ink">{tally.mine}</p>}
            <p className="text-[10px] font-medium text-n-3">{NEVER_WHO_VOTED_COPY}</p>
          </div>
        )}

        {refusal && !(recipientOverflows && pickingDrops) && (
          <p role="alert" className="rounded-sm border border-negative bg-negative-soft px-3 py-2 text-[12px] font-semibold text-ink" data-trade-card-refusal>
            {/* The server's sentence, its builder citations removed (R1244). */}
            {plainRefusal(refusal)}
          </p>
        )}

        {commishResult && (
          <StatusBanner tone="accent">
            <span data-commish-trade-outcome={commishResult.outcome}>{commishOutcomeCopy(commishResult, playerName)}</span>
          </StatusBanner>
        )}

        {pickingDrops && recipientRoster && (
          <div className="flex flex-col gap-1.5 rounded-sm border border-ink px-2 py-2" data-accept-drops>
            {recipientOverflows && refusal && <p className="text-[11px] font-medium text-ink">{plainRefusal(refusal)}</p>}
            <p className="text-[11px] font-bold text-ink">
              {recipientOverflows ? dropsPromptCopy(overflow!.more) : 'Players to drop so your roster fits — dropped only if the trade goes through.'}
            </p>
            <DropPicker
              roster={recipientRoster.roster.filter((p) => !giving.has(p.player_id))}
              picked={acceptDrops ?? []}
              lockBehavior={lockBehavior}
              onToggle={(id) => setAcceptDrops((d) => ((d ?? []).includes(id) ? (d ?? []).filter((x) => x !== id) : [...(d ?? []), id]))}
            />
            <span className="flex flex-wrap gap-2">
              <Button variant="blue" size="sm" disabled={pending || (acceptDrops ?? []).length === 0} onClick={() => onRespond(trade, 'accept', acceptDrops ?? [])} data-accept-with-drops>
                {pending ? 'Sending…' : 'Accept with these drops'}
              </Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => setAcceptDrops(null)}>
                Never mind
              </Button>
            </span>
          </div>
        )}

        <TradeButtons
          trade={trade}
          actions={actions}
          pending={pending}
          pickingDrops={pickingDrops}
          onAccept={() => onRespond(trade, 'accept')}
          onAcceptWithDrops={() => setAcceptDrops([])}
          onRespond={(op) => onRespond(trade, op)}
          onCounter={() => onCounter(trade)}
          onVote={(vote) => onVote(trade, vote)}
          onCommish={(op) => onCommish(trade, op)}
        />
      </CardContent>
    </Card>
  )
}

function TradeButtons({
  trade,
  actions,
  pending,
  pickingDrops,
  onAccept,
  onAcceptWithDrops,
  onRespond,
  onCounter,
  onVote,
  onCommish,
}: {
  trade: TradeView
  actions: ReturnType<typeof tradeActions>
  pending: boolean
  pickingDrops: boolean
  onAccept: () => void
  onAcceptWithDrops: () => void
  onRespond: (op: 'reject' | 'cancel') => void
  onCounter: () => void
  onVote: (vote: 'veto' | 'approve') => void
  onCommish: (op: CommishTradeOp) => void
}) {
  const manager = actions.accept || actions.reject || actions.counter || actions.cancel || actions.vote || actions.reviewApprove || actions.reviewVeto
  const override = actions.overrideApprove || actions.overrideVeto || actions.force || actions.reverse
  if (!manager && !override) return null
  const acting = actions.actingFor === 'recipient' ? ` for ${trade.recipient.name ?? 'the team'}` : ''
  return (
    <div className="flex flex-col gap-2">
      {manager && (
        <div className="flex flex-wrap items-center gap-2" data-trade-actions>
          {actions.accept && !pickingDrops && (
            <>
              <Button variant="blue" size="sm" disabled={pending} onClick={onAccept} data-trade-op="accept">
                {pending ? 'Sending…' : `Accept${acting}`}
              </Button>
              <Button variant="ghost" size="sm" disabled={pending} onClick={onAcceptWithDrops} data-trade-op="accept-drops">
                Accept with drops…
              </Button>
            </>
          )}
          {actions.counter && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={onCounter} data-trade-op="counter">
              Counter
            </Button>
          )}
          {actions.reject && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onRespond('reject')} data-trade-op="reject">
              Turn down
            </Button>
          )}
          {actions.cancel && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onRespond('cancel')} data-trade-op="cancel">
              Call off offer
            </Button>
          )}
          {actions.vote && (
            <>
              <Button variant="stroke" size="sm" disabled={pending || trade.tally?.my_vote === 'veto'} onClick={() => onVote('veto')} data-trade-op="vote-veto">
                Vote to veto
              </Button>
              <Button variant="stroke" size="sm" disabled={pending || trade.tally?.my_vote === 'approve'} onClick={() => onVote('approve')} data-trade-op="vote-approve">
                Let it through
              </Button>
            </>
          )}
          {actions.reviewApprove && (
            <Button variant="blue" size="sm" disabled={pending} onClick={() => onCommish('approve')} data-trade-op="approve">
              Approve
            </Button>
          )}
          {actions.reviewVeto && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onCommish('veto')} data-trade-op="veto">
              Veto
            </Button>
          )}
        </div>
      )}
      {override && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-ink bg-brand px-2 py-1.5" data-trade-override>
          <Badge variant="black" className="shrink-0">
            ✸ Override
          </Badge>
          {actions.overrideApprove && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onCommish('approve')} data-trade-op="approve">
              {COMMISH_OP_LABELS.approve}
            </Button>
          )}
          {actions.overrideVeto && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onCommish('veto')} data-trade-op="veto">
              {COMMISH_OP_LABELS.veto}
            </Button>
          )}
          {actions.force && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onCommish('force')} data-trade-op="force">
              {COMMISH_OP_LABELS.force}
            </Button>
          )}
          {actions.reverse && (
            <Button variant="stroke" size="sm" disabled={pending} onClick={() => onCommish('reverse')} data-trade-op="reverse">
              {COMMISH_OP_LABELS.reverse}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** §10.4's confirmation — before → after for force and reverse: the dialog's
 *  body (its title and description are the host's `DialogHeader`). Rendered
 *  inside a dialog (a true overlay: the primitive's resting shadow). */
export function CommishConfirm({
  trade,
  op,
  pending,
  onConfirm,
  onCancel,
}: {
  trade: TradeView
  op: 'force' | 'reverse'
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-3" data-commish-confirm={op}>
      <ul className="flex flex-col gap-1 rounded-sm border border-n-4 px-2 py-2 text-[12px] font-medium text-ink">
        {commishConfirmLines(trade, op).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="text-[11px] font-medium text-n-3">Logged for the whole league, and both managers are told.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="blue" size="sm" shadow disabled={pending} onClick={onConfirm} data-commish-confirm-go>
          {pending ? 'Working…' : COMMISH_OP_LABELS[op]}
        </Button>
        <Button variant="stroke" size="sm" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function TradesSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={TRADES_TITLE} />
      <Skeleton className="h-9 rounded-sm" />
      <Skeleton className="h-7 w-48 rounded-sm" />
      <Skeleton className="h-24 rounded-sm" />
      <Skeleton className="h-24 rounded-sm" />
    </div>
  )
}
