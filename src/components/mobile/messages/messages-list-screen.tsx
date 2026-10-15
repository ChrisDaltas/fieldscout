'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { BackPill, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { MSegmented } from '@/components/mobile/ui/m-segmented'
import { TradeBuilderOverlay } from '@/components/mobile/trades/trade-builder-overlay'
import { TradeDetailOverlay } from '@/components/mobile/trades/trade-detail-overlay'
import { useAuth } from '@/hooks/use-auth'
import { useLeagues } from '@/hooks/use-leagues'
import { useMobileMessagesDms, type MDmConversation } from '@/hooks/use-mobile-messages-dms'
import { featureFlags } from '@/lib/feature-flags'
import type { TradeView } from '@/lib/leagues/api/trades-service'

import { ConversationRow, ConversationRowSkeleton, LeagueBoardRow } from './conversation-row'
import { MessagesAvatar } from './messages-avatar'
import { EMPTY_PILL, MessagesEmpty } from './messages-empty'
import { matchesName, matchesTrade, newestFirst, pendingCount, previewLine, threadHref } from './messages-ops'
import { useMessagesStore, type MessagesFilter } from './messages-store'
import { LeagueOfferCard, LeagueTradesSource, type LeagueTradesSnapshot } from './messages-trades'

export const MESSAGES_EMPTY_TITLE = 'No messages yet'
export const TRADES_EMPTY_TITLE = 'No trade offers'
export const TRADES_EMPTY_BODY = 'Trade offers you send or get in your leagues will show up here.'
export const BOARDS_ERROR = 'Couldn’t load your leagues’ message boards.'
export const LEAGUES_TRADES_ERROR = 'Couldn’t load your leagues’ trades.'

/** The All tab's empty body — says only what this build can show. */
export function messagesEmptyBody(boards: boolean, dms: boolean): string {
  if (boards && dms) return 'Your leagues’ message boards and direct messages will show up here.'
  if (boards) return 'Your leagues’ message boards will show up here.'
  return 'Direct messages with your league-mates will show up here.'
}

/** "Couldn’t load trades for A and B." */
export function tradesErrorTitle(names: readonly string[]): string {
  const list = names.length <= 1 ? (names[0] ?? 'a league') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Couldn’t load trades for ${list}.`
}

/**
 * FieldScout Mobile — Messages (m-messages §2.1, S1/S2). Back pill, the 28px
 * title, Search, the All / Trades segmented control, the people row (All
 * only), then conversation rows or trade-offer cards.
 *
 * Data, each part on its own release gate:
 *   - every league you're in contributes its real message board as a group
 *     conversation (the design's "Sunday Funday League" row) — `leagues`;
 *   - the Trades tab is every offer you sent or got in those leagues, read
 *     live per league and answered through the trade verbs — `leagues`;
 *   - direct messages come from the DM feed the desktop rail uses, empty
 *     until a DM backend exists — `messages`.
 */
export function MobileMessagesList() {
  const router = useRouter()
  const { user } = useAuth()
  const dms = useMobileMessagesDms()
  const leaguesOn = featureFlags.leagues
  const leagues = useLeagues({ enabled: leaguesOn })
  const myLeagues = leaguesOn ? (leagues.data ?? []) : []
  const leaguesLoading = leaguesOn && leagues.isPending
  const leaguesError = leaguesOn && leagues.isError && !leagues.data

  const filter = useMessagesStore((s) => s.filter)
  const setFilter = useMessagesStore((s) => s.setFilter)
  const query = useMessagesStore((s) => s.query)
  const setQuery = useMessagesStore((s) => s.setQuery)
  const markRead = useMessagesStore((s) => s.markRead)
  const setOpenedFromList = useMessagesStore((s) => s.setOpenedFromList)

  // Each tab keeps its own scroll position; a tab not visited yet opens at
  // the top (the prototype carried one offset across both — a defect).
  const rootRef = useRef<HTMLDivElement>(null)
  const tops = useRef<Record<MessagesFilter, number>>({ all: 0, trades: 0 })
  const scroller = () => rootRef.current?.closest('main') ?? null
  const switchTab = (next: MessagesFilter) => {
    if (next === filter) return
    const el = scroller()
    if (el) tops.current[filter] = el.scrollTop
    setFilter(next)
  }
  const firstRender = useRef(true)
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const el = scroller()
    if (el) el.scrollTop = tops.current[filter]
  }, [filter])

  const back = () => {
    if (window.history.length > 1) router.back()
    else router.replace('/app')
  }

  const open = (threadId: string) => {
    markRead(threadId)
    setOpenedFromList(threadId)
  }

  // ---- Trades: one live source per league you manage a team in. ----------
  const [snaps, setSnaps] = useState<Record<string, LeagueTradesSnapshot>>({})
  const report = useCallback((leagueId: string, snap: LeagueTradesSnapshot | null) => {
    setSnaps((s) => {
      if (snap) return { ...s, [leagueId]: snap }
      if (!(leagueId in s)) return s
      const next = { ...s }
      delete next[leagueId]
      return next
    })
  }, [])
  const tradeLeagues = myLeagues.filter((l) => l.my_team_id)
  const sources = tradeLeagues.map((l) => ({ league: l, snap: snaps[l.id] ?? null }))
  const allOffers = newestFirst(sources.flatMap(({ snap }) => (snap?.state === 'ready' ? snap.offers : [])))
  const pending = pendingCount(allOffers)
  const offers = allOffers.filter((o) => matchesTrade(o, query))
  const tradesLoading = leaguesLoading || sources.some(({ snap }) => !snap || snap.state === 'loading')
  const tradeErrors = sources.filter(({ snap }) => snap?.state === 'error')

  // S4 (the offer) and the counter builder, over the list.
  const [openOffer, setOpenOffer] = useState<{ leagueId: string; tradeId: string } | null>(null)
  const [counter, setCounter] = useState<{ leagueId: string; trade: TradeView } | null>(null)
  const offerDetail = openOffer ? (snaps[openOffer.leagueId]?.detail ?? null) : null
  const counterDetail = counter ? (snaps[counter.leagueId]?.detail ?? null) : null

  // ---- All: league boards, then direct messages. -------------------------
  const people = dms.conversations
  const boards = myLeagues.map((l, i) => ({ league: l, index: i })).filter(({ league }) => matchesName(league.name, query))
  const dmRows = dms.conversations.filter((c) => matchesName(c.name, query))

  const header = (
    <>
      <div className="flex h-[52px] items-center gap-2 px-3">
        <BackPill onClick={back} />
      </div>
      <div className="flex-none px-4 pb-2.5">
        <h1 className="pb-2.5 text-[28px] font-semibold leading-[34px] tracking-[-0.03em] text-m-t1">Messages</h1>
        <label className="flex h-[38px] items-center gap-2 rounded-[12px] bg-m-b2 px-3">
          <svg
            viewBox="0 0 16 16"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            aria-hidden
            className="flex-none text-m-t4"
          >
            <circle cx="7" cy="7" r="4.8" />
            <path d="M10.6 10.6L14 14" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            aria-label="Search messages"
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-medium text-m-t1 outline-none placeholder:text-fs-text-3"
          />
        </label>
        <MSegmented<MessagesFilter>
          label="Message filter"
          className="mt-2.5"
          itemClassName="h-8 gap-1.5 rounded-[8px] transition-none"
          value={filter}
          onChange={switchTab}
          options={[
            { value: 'all', label: 'All' },
            {
              value: 'trades',
              label: (
                <>
                  Trades
                  {pending > 0 && (
                    <span
                      className="flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-accent px-[5px] text-[10px] font-semibold tabular-nums text-white"
                      aria-label={`${pending} waiting on you`}
                    >
                      {pending}
                    </span>
                  )}
                </>
              ),
            },
          ]}
        />
      </div>
      {filter === 'all' && people.length > 0 && <PeopleRow people={people} onOpen={open} />}
    </>
  )

  let body: React.ReactNode
  if (filter === 'all') {
    const nothing = !leaguesLoading && !leaguesError && boards.length === 0 && dmRows.length === 0
    body = (
      <div data-conversations>
        {leaguesError && (
          <MessagesEmpty title={BOARDS_ERROR} role="alert" className="pt-6">
            <button type="button" className={EMPTY_PILL} onClick={() => void leagues.refetch()}>
              Retry
            </button>
          </MessagesEmpty>
        )}
        {leaguesLoading ? (
          <>
            <ConversationRowSkeleton />
            <ConversationRowSkeleton />
            <ConversationRowSkeleton />
          </>
        ) : (
          boards.map(({ league, index }) => (
            <LeagueBoardRow
              key={league.id}
              league={league}
              index={index}
              viewerId={user?.id ?? null}
              onOpen={(id) => setOpenedFromList(id)}
            />
          ))
        )}
        {dmRows.map((c) => (
          <DmRow key={c.id} conversation={c} onOpen={open} />
        ))}
        {nothing &&
          (query ? (
            <MessagesEmpty title={`No conversations match “${query}”`} />
          ) : (
            <MessagesEmpty title={MESSAGES_EMPTY_TITLE} body={messagesEmptyBody(leaguesOn, dms.enabled)} />
          ))}
      </div>
    )
  } else {
    body = (
      <div data-trade-offers>
        {leaguesError ? (
          <MessagesEmpty title={LEAGUES_TRADES_ERROR} role="alert" className="pt-6">
            <button type="button" className={EMPTY_PILL} onClick={() => void leagues.refetch()}>
              Retry
            </button>
          </MessagesEmpty>
        ) : tradeErrors.length > 0 ? (
          <MessagesEmpty title={tradesErrorTitle(tradeErrors.map(({ league }) => league.name))} role="alert" className="pt-6">
            <button type="button" className={EMPTY_PILL} onClick={() => tradeErrors.forEach(({ snap }) => snap?.retry())}>
              Retry
            </button>
          </MessagesEmpty>
        ) : null}
        {offers.length > 0 || tradesLoading ? (
          <div className="flex flex-col gap-2 px-4 pb-5 pt-1">
            {offers.map((o) => {
              const snap = snaps[o.leagueId]
              return snap ? (
                <LeagueOfferCard
                  key={o.id}
                  offer={o}
                  snapshot={snap}
                  onOpen={() => setOpenOffer({ leagueId: o.leagueId, tradeId: o.id })}
                  onCounter={(trade) => setCounter({ leagueId: o.leagueId, trade })}
                />
              ) : null
            })}
            {tradesLoading && (
              <>
                <OfferSkeleton />
                {offers.length === 0 && <OfferSkeleton />}
              </>
            )}
          </div>
        ) : allOffers.length > 0 ? (
          <MessagesEmpty title={`No trade offers match “${query}”`} />
        ) : !leaguesError && tradeErrors.length === 0 ? (
          <MessagesEmpty title={TRADES_EMPTY_TITLE} body={TRADES_EMPTY_BODY} />
        ) : null}
      </div>
    )
  }

  return (
    <MobileScreen header={header}>
      <div ref={rootRef} data-messages-list={filter}>
        {body}
      </div>
      {tradeLeagues.map((l) => (
        <LeagueTradesSource key={l.id} league={l} onReport={report} />
      ))}
      {openOffer && offerDetail && (
        <TradeDetailOverlay
          leagueId={openOffer.leagueId}
          detail={offerDetail}
          tradeId={openOffer.tradeId}
          onClose={() => setOpenOffer(null)}
          onCounter={(trade) => {
            const leagueId = openOffer.leagueId
            setOpenOffer(null)
            setCounter({ leagueId, trade })
          }}
        />
      )}
      {counter && counterDetail && (
        <TradeBuilderOverlay
          leagueId={counter.leagueId}
          detail={counterDetail}
          mode="counter"
          counterOf={counter.trade}
          onClose={() => setCounter(null)}
        />
      )}
    </MobileScreen>
  )
}

/** A loading trade card: the card's shapes on b1. */
function OfferSkeleton() {
  return <div className="h-[116px] rounded-[16px] bg-m-b1" aria-hidden data-skeleton="trade-offer" />
}

/** A direct-message conversation row (DM feed). */
function DmRow({ conversation: c, onOpen }: { conversation: MDmConversation; onOpen: (id: string) => void }) {
  return (
    <ConversationRow
      href={threadHref(c.id)}
      onOpen={() => onOpen(c.id)}
      name={c.name}
      unread={c.unread}
      preview={c.preview ? previewLine(c.preview, c.time) : ''}
      avatar={
        <MessagesAvatar
          text={c.initial}
          src={c.avatarUrl}
          sizeClass="size-[52px]"
          colorClass={c.colorClass}
          textClass="text-[16px]"
        />
      }
    />
  )
}

/**
 * The horizontal people row (§2.1 C, All tab): one 58px item per direct
 * conversation, 52px avatar and an 11px name. Not filtered by the search.
 */
function PeopleRow({ people, onOpen }: { people: readonly MDmConversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="scrollbar-none flex flex-none gap-3.5 overflow-x-auto px-4 pb-3 pt-1" data-people-row>
      {people.map((p) => (
        <Link
          key={p.id}
          href={threadHref(p.id)}
          onClick={() => onOpen(p.id)}
          className="flex w-[58px] flex-none flex-col items-center gap-[5px]"
        >
          <MessagesAvatar
            text={p.initial}
            src={p.avatarUrl}
            sizeClass="size-[52px]"
            colorClass={p.colorClass}
            textClass="text-[17px]"
          />
          <span className="max-w-[58px] truncate text-[11px] font-medium text-m-t2">{p.name}</span>
        </Link>
      ))}
    </div>
  )
}
