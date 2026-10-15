'use client'

import { useEffect, useMemo } from 'react'

import { formatInstantWithDate, lockBadgeFor } from '@/components/leagues/lineup-editor-ops'
import { acceptGate, dropsNeeded, isTradesUnavailable, tradeActions } from '@/components/leagues/trades-ops'
import { useLeague, type LeagueDetail } from '@/hooks/use-league'
import type { MyLeagueRow } from '@/hooks/use-leagues'
import { useRostersLive } from '@/hooks/use-rosters'
import { useTradeAction } from '@/hooks/use-trade-action'
import { useTradeDeadline } from '@/hooks/use-trade-deadline'
import { useTradePreview } from '@/hooks/use-trade-preview'
import { useTradesLive } from '@/hooks/use-trades'
import { toast } from '@/hooks/use-toast'
import { rawErrorText, userFacingMessage } from '@/lib/leagues/api/client-fetch'
import type { TradeView, TradesDocument } from '@/lib/leagues/api/trades-service'

import { leagueTradeOffers, type MTradeOffer } from './messages-ops'
import { TradeOfferCard, type OfferAnswers } from './trade-offer-card'

/**
 * Messages › Trades on the leagues' real trades (m-messages §2.1 F / S2;
 * gap analysis "cross-league trade-card inbox": fan out per league). Each
 * league you manage a team in is read through the same live hooks the
 * league's Trades page uses (`useTradesLive` — one refcounted `league:<id>`
 * room, the room the board rows already hold — and `useLeague` for the
 * managers' names), and reports its offers up to the list, which merges
 * them newest first.
 */
export interface LeagueTradesSnapshot {
  /** `off`: trades aren't switched on for this league (the route's named
   *  503) — it has no offers, which is not an error. */
  state: 'loading' | 'ready' | 'error' | 'off'
  doc: TradesDocument | null
  detail: LeagueDetail | null
  offers: MTradeOffer[]
  retry: () => void
}

export function LeagueTradesSource({
  league,
  onReport,
}: {
  league: Pick<MyLeagueRow, 'id'>
  onReport: (leagueId: string, snapshot: LeagueTradesSnapshot | null) => void
}) {
  const trades = useTradesLive(league.id)
  const detail = useLeague(league.id)
  const doc = trades.data ?? null
  const det = detail.data ?? null
  const state: LeagueTradesSnapshot['state'] =
    trades.isError && !doc && isTradesUnavailable(trades.error)
      ? 'off'
      : doc && det
        ? 'ready'
        : (trades.isError && !doc) || (detail.isError && !det)
          ? 'error'
          : 'loading'
  const offers = useMemo(() => (doc && det ? leagueTradeOffers(doc, det, league.id) : []), [doc, det, league.id])
  const refetchTrades = trades.refetch
  const refetchDetail = detail.refetch

  useEffect(() => {
    onReport(league.id, {
      state,
      doc,
      detail: det,
      offers,
      retry: () => {
        void refetchTrades()
        void refetchDetail()
      },
    })
  }, [league.id, state, doc, det, offers, onReport, refetchTrades, refetchDetail])
  useEffect(() => () => onReport(league.id, null), [league.id, onReport])
  return null
}

/**
 * A card on the Trades tab. An offer waiting on my answer carries Decline /
 * Counter / Accept on the league's own rules; every other card is the
 * design's S2b (no actions).
 */
export function LeagueOfferCard({
  offer,
  snapshot,
  onOpen,
  onCounter,
}: {
  offer: MTradeOffer
  snapshot: LeagueTradesSnapshot
  onOpen: () => void
  onCounter: (trade: TradeView) => void
}) {
  const trade = snapshot.doc?.trades.find((t) => t.id === offer.id) ?? null
  if (!offer.awaitingMe || !trade || !snapshot.doc || !snapshot.detail) return <TradeOfferCard offer={offer} onOpen={onOpen} />
  return (
    <AnsweringOfferCard
      offer={offer}
      trade={trade}
      doc={snapshot.doc}
      detail={snapshot.detail}
      onOpen={onOpen}
      onCounter={onCounter}
    />
  )
}

/** Why Accept opens the offer instead of accepting at once. */
export function needsDropsNote(n: number): string {
  return `Accepting means dropping ${n} player${n === 1 ? '' : 's'} — Accept opens the offer to pick ${n === 1 ? 'him' : 'them'}.`
}

/**
 * S2a on the app's verbs — the same rules as the offer screen and the
 * desktop trade card: who may answer is `tradeActions`; Accept goes through
 * the league's answer (`acceptGate` over 162's preview). When accepting
 * needs drops (E36) the drop picker lives on the offer, so Accept opens it;
 * when the league wouldn't take an accept now, Accept is gone and the card
 * says why. Counter opens the builder seeded from the offer (`counterSeed`).
 */
function AnsweringOfferCard({
  offer,
  trade,
  doc,
  detail,
  onOpen,
  onCounter,
}: {
  offer: MTradeOffer
  trade: TradeView
  doc: TradesDocument
  detail: LeagueDetail
  onOpen: () => void
  onCounter: (trade: TradeView) => void
}) {
  const leagueId = offer.leagueId
  const rosters = useRostersLive(leagueId)
  const deadline = useTradeDeadline(leagueId)
  const act = useTradeAction(leagueId)

  const inSeason = detail.league.status === 'in_season' || detail.league.status === 'playoffs'
  const rosterOf = (teamId: string) => rosters.data?.teams.find((t) => t.team_id === teamId) ?? null
  const actions = tradeActions(
    trade,
    { teamId: doc.viewer.team_id, isCommissioner: doc.viewer.is_commissioner, overrideMode: false, inSeason },
    { proposerHasManager: (rosterOf(trade.proposer.team_id)?.manager_user_id ?? null) !== null },
  )
  const tz = detail.settings.draft.time_zone ?? null
  const fmt = (iso: string) => formatInstantWithDate(iso, tz).local
  const deadlineView = deadline.data?.state === 'known' ? deadline.data.view : null
  const lockedIds = new Set(
    (rosters.data?.teams ?? []).flatMap((t) => t.roster.filter((p) => lockBadgeFor(p.game_lock, true).locked).map((p) => p.player_id)),
  )
  const lockedNames = [
    ...trade.items.filter((i) => i.player && lockedIds.has(i.player.player_id)).map((i) => i.player!.full_name ?? i.player!.player_id),
    ...trade.drops.filter((d) => lockedIds.has(d.player.player_id)).map((d) => d.player.full_name ?? d.player.player_id),
  ]
  const answering = actions.accept && trade.status === 'proposed'
  const preview = useTradePreview(leagueId, answering && !deadlineView?.passed ? { kind: 'accept', tradeId: trade.id, drops: [] } : null)
  const gate = answering
    ? acceptGate({
        preview,
        deadline: deadlineView,
        lockBehavior: doc.settings.trade_lock_behavior,
        review: doc.settings.trade_review,
        lockedNames,
        proposerName: trade.proposer.name ?? 'the other team',
        fmt,
      })
    : null

  // Not optimistic (trades reflect the broadcast): once answered, the card
  // waits for the re-read rather than offering the answers again.
  const busy = act.isPending || act.isSuccess
  const refused = (error: unknown) => {
    const raw = rawErrorText(error) ?? 'That was refused.'
    // Before 162 (send and see): the league says my roster would overflow —
    // the drops are picked on the offer.
    const overflow = dropsNeeded(raw)
    if (overflow && overflow.teamName === trade.recipient.name) onOpen()
    toast({ title: userFacingMessage(raw) })
  }
  const respond = (op: 'accept' | 'reject') => {
    act
      .submitAsync(op === 'accept' ? { tradeId: trade.id, op, drops: [] } : { tradeId: trade.id, op })
      .then(() => toast({ title: op === 'accept' ? `Trade accepted with ${offer.name}` : 'Trade declined' }))
      .catch(refused)
  }

  const answers: OfferAnswers = {
    decline: actions.reject ? { onClick: () => respond('reject'), disabled: busy } : null,
    counter: actions.counter && !(gate?.pastDeadline ?? false) ? { onClick: () => onCounter(trade), disabled: busy } : null,
    accept:
      actions.accept && gate?.state !== 'blocked'
        ? {
            onClick: () => (gate?.state === 'needs_drops' ? onOpen() : respond('accept')),
            disabled: busy || gate?.state === 'checking',
          }
        : null,
    note:
      gate?.state === 'needs_drops'
        ? needsDropsNote(gate.mustDrop)
        : gate?.reason && gate.state !== 'checking'
          ? gate.reason
          : null,
  }
  return <TradeOfferCard offer={offer} onOpen={onOpen} answers={answers} />
}
