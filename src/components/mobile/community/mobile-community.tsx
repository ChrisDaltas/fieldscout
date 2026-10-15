'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { CommunityDetail } from '@/components/mobile/community/community-detail'
import {
  ListMasonry,
  RankingRow,
  ShelfHeader,
  UpdatedRow,
} from '@/components/mobile/community/community-cards'
import {
  COMMUNITY_TABS,
  CREATE_LIST_HREF,
  RANK_POS_CHIPS,
  RANK_SCORING_CHIPS,
  RANK_TYPE_CHIPS,
  deriveTopics,
  emptyCopy,
  filterItems,
  normQuery,
  rankFilterOk,
  recentUpdates,
} from '@/components/mobile/community/community-ops'
import { useCommunityStore } from '@/components/mobile/community/community-store'
import { CreateSheet } from '@/components/mobile/community/create-sheet'
import { activeWeekOf } from '@/components/mobile/rankings/rankings-ops'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { HeaderIconButton, LogoLockup, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useFollowingIds } from '@/hooks/use-follows'
import {
  COMMUNITY_POOL_SIZE,
  useCommunityPlayerMatches,
  useMobileCommunityFeed,
} from '@/hooks/use-mobile-community-feed'
import { featureFlags } from '@/lib/feature-flags'
import { cn } from '@/lib/utils'

/**
 * FieldScout Mobile — Community (handoff m-community; account tab
 * "Community", `/app/explore`). Header (logo · Search · Create), the inline
 * search, the five tabs, topic pills, "Updated by people you follow", then
 * either the For you shelves or the grouped results — all scrolling
 * together (nothing is sticky). A list or ranking opens its detail over the
 * feed at `?list=<id>`, so Back returns to the feed exactly as it was.
 *
 * `currentWeek` is the app's NFL week (0 = offseason) — the Start or sit
 * shelf is titled with the week it's about.
 */
export function MobileCommunity({ currentWeek }: { currentWeek: number }) {
  return (
    <Suspense fallback={null}>
      <CommunityScreen currentWeek={currentWeek} />
    </Suspense>
  )
}

const NO_IDS: ReadonlySet<string> = new Set()

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function CommunityScreen({ currentWeek }: { currentWeek: number }) {
  const router = useRouter()
  const params = useSearchParams()
  const openId = params.get('list')

  const tab = useCommunityStore((s) => s.tab)
  const topic = useCommunityStore((s) => s.topic)
  const query = useCommunityStore((s) => s.query)
  const rk = useCommunityStore((s) => s.rk)
  const searchOpen = useCommunityStore((s) => s.searchOpen)
  const detailFromFeed = useCommunityStore((s) => s.detailFromFeed)
  const setTab = useCommunityStore((s) => s.setTab)
  const toggleTopic = useCommunityStore((s) => s.toggleTopic)
  const setRank = useCommunityStore((s) => s.setRank)
  const clearFilters = useCommunityStore((s) => s.clearFilters)
  const resetRankFilters = useCommunityStore((s) => s.resetRankFilters)
  const setDetailFromFeed = useCommunityStore((s) => s.setDetailFromFeed)

  const [createOpen, setCreateOpen] = useState(false)

  const feed = useMobileCommunityFeed()
  const following = useFollowingIds()
  const items = useMemo(() => feed.data?.items ?? [], [feed.data])
  const capped = feed.data?.capped ?? false
  const poolIds = useMemo(() => items.map((i) => i.id), [items])
  const followingIds = following.data ?? NO_IDS

  const q = normQuery(query)
  const debouncedQ = useDebounced(q, 250)
  const playerTopic = topic?.kind === 'player' ? topic : null
  const topicMatches = useCommunityPlayerMatches(poolIds, { playerId: playerTopic?.id ?? null })
  const queryMatches = useCommunityPlayerMatches(poolIds, { query: debouncedQ })
  // The server half of a player topic / player-name search failed: say so
  // and offer a retry — never a quietly partial (cover players only) or
  // empty ("Nothing matches") result.
  const matchError =
    playerTopic && topicMatches.isError
      ? { message: `Couldn’t load the lists with ${playerTopic.label}.`, retry: () => void topicMatches.refetch() }
      : q && debouncedQ === q && queryMatches.isError
        ? { message: 'Couldn’t search player names.', retry: () => void queryMatches.refetch() }
        : null
  // A player topic waits for its server answer rather than showing the
  // cover-players guess first.
  const topicPending = Boolean(playerTopic) && topicMatches.isLoading

  const topics = useMemo(() => deriveTopics(items, topic), [items, topic])
  const filtered = filterItems(items, {
    tab,
    topic,
    q,
    followingIds,
    topicListIds: topic?.kind === 'player' ? topicMatches.data : undefined,
    // Player-name matches join once the debounced query catches up.
    queryListIds: debouncedQ === q ? queryMatches.data : undefined,
  })
  // Rankings follow their own switch (launch scope), not just the tab bar.
  const ranksAll = featureFlags.weeklyRanks ? filtered.filter((i) => i.kind === 'rank') : []
  const ranks = tab === 'rank' ? ranksAll.filter((i) => rankFilterOk(i, rk)) : ranksAll
  const lists = filtered.filter((i) => i.kind === 'list')
  const shelves = tab === 'all' && !topic && !q
  const mixed = tab === 'all' || tab === 'following'
  // "Now" for the relative times is when the feed was read.
  const now = feed.dataUpdatedAt
  const updates =
    (tab === 'all' || tab === 'following' || tab === 'rank') && !topic && !q
      ? recentUpdates(items, followingIds, now)
      : []

  // The detail is open from the feed only while `?list=` is set.
  useEffect(() => {
    if (!openId) setDetailFromFeed(false)
  }, [openId, setDetailFromFeed])

  // The cards open the detail with `history.pushState` (no server round
  // trip); Back pops that entry. Reached any other way (a link, a reload),
  // there's no feed entry behind it, so Back swaps the URL for the feed's.
  const closeDetail = () => {
    if (detailFromFeed) {
      setDetailFromFeed(false)
      window.history.back()
    } else {
      window.history.replaceState(null, '', '/app/explore')
    }
  }

  const followingPending = tab === 'following' && following.isLoading
  // Rankings tab: the chips can exclude every ranking — say so (the
  // prototype went blank here; its empty test ran before the chips).
  const rankFilteredEmpty = tab === 'rank' && ranksAll.length > 0 && ranks.length === 0
  const empty = filtered.length === 0 || rankFilteredEmpty
  const copy = emptyCopy(tab, topic, q, rankFilteredEmpty, { followsAnyone: followingIds.size > 0, capped })
  const onEmptyAction = () => {
    if (copy.kind === 'rank') resetRankFilters()
    else if (copy.kind === 'create') router.push(CREATE_LIST_HREF)
    else clearFilters()
  }

  return (
    <MobileScreen>
      <div className="px-4 pb-6" inert={openId ? true : undefined}>
        {searchOpen ? <SearchRow /> : <HeaderRow onCreate={() => setCreateOpen(true)} />}

        <div className="-mx-4 mt-0.5 flex gap-[18px] overflow-x-auto border-b border-m-b3 px-4 scrollbar-none">
          {COMMUNITY_TABS.filter(tabSwitchedOn).map((t) => {
            const on = tab === t.value
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                aria-pressed={on}
                className={cn(
                  'relative flex h-[38px] flex-none items-center whitespace-nowrap text-[14px] font-semibold',
                  on ? 'text-m-t1' : 'text-m-t3',
                )}
              >
                {t.label}
                {on && <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-m-ink" />}
              </button>
            )
          })}
        </div>

        {topics.length > 0 && (
          <div className="-mx-4 mt-[10px] flex gap-[6px] overflow-x-auto px-4 scrollbar-none" aria-label="Topics">
            {topics.map((t) => {
              const on = topic?.kind === t.kind && topic.id === t.id
              return (
                <button
                  key={`${t.kind}:${t.id}`}
                  type="button"
                  onClick={() => toggleTopic(t)}
                  aria-pressed={on}
                  className={cn(
                    'flex h-8 flex-none items-center gap-[6px] whitespace-nowrap rounded-pill pr-3 text-[13px] font-semibold',
                    t.kind === 'player' ? 'pl-1' : 'pl-3',
                    on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
                  )}
                >
                  {t.kind === 'player' && <MHeadshot player={t.player} size={24} />}
                  {t.label}
                </button>
              )
            })}
          </div>
        )}

        {feed.isLoading || followingPending || topicPending ? (
          <FeedSkeleton />
        ) : feed.isError || (tab === 'following' && following.isError) ? (
          <EmptyBlock
            message="Couldn’t load Community. Check your connection and try again."
            action="Try again"
            onAction={() => {
              void feed.refetch()
              void following.refetch()
            }}
          />
        ) : matchError ? (
          <EmptyBlock message={matchError.message} action="Try again" onAction={matchError.retry} />
        ) : (
          <>
            {updates.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <h2 className="text-[13px] font-semibold text-m-t3">Updated by people you follow</h2>
                {updates.map((item) => (
                  <UpdatedRow key={item.id} item={item} now={now} />
                ))}
              </div>
            )}

            {shelves ? (
              <>
                {/* Shelf 1 renders while Start-or-sit is switched on (§2.7).
                    Start/sit questions have no backend yet, so it holds the
                    empty card. */}
                {featureFlags.startOrSit && (
                  <>
                    <ShelfHeader
                      title={`Start or sit · Week ${activeWeekOf(currentWeek)}`}
                      onSeeAll={() => setTab('poll')}
                      className="mb-[10px] mt-[22px]"
                    />
                    <p className="rounded-[18px] bg-m-b1 px-4 py-6 text-center text-[13px] font-medium text-m-t3">
                      No start or sit questions yet
                    </p>
                  </>
                )}
                {ranks.length > 0 && (
                  <>
                    <ShelfHeader title="Rankings this week" onSeeAll={() => setTab('rank')} className="mb-[6px] mt-[22px]" />
                    <div className="flex flex-col">
                      {ranks.map((item) => (
                        <RankingRow key={item.id} item={item} />
                      ))}
                    </div>
                  </>
                )}
                <ShelfHeader title="Lists for you" onSeeAll={() => setTab('list')} className="mb-[10px] mt-[22px]" />
                {lists.length > 0 ? (
                  <ListMasonry items={lists} />
                ) : (
                  <EmptyBlock
                    message={ranks.length > 0 ? 'No lists yet' : 'No lists or rankings yet'}
                    action="Create a list"
                    onAction={() => router.push(CREATE_LIST_HREF)}
                  />
                )}
              </>
            ) : (
              <>
                {tab === 'rank' && (
                  <div className="mt-3 flex flex-col gap-[6px]">
                    <ChipRow chips={RANK_TYPE_CHIPS} value={rk.type} onPick={(type) => setRank({ type })} label="Ranking type" />
                    <ChipRow chips={RANK_POS_CHIPS} value={rk.pos} onPick={(pos) => setRank({ pos })} label="Position" />
                    <ChipRow
                      chips={RANK_SCORING_CHIPS}
                      value={rk.scoring}
                      onPick={(scoring) => setRank({ scoring })}
                      label="Scoring"
                    />
                  </div>
                )}
                {ranks.length > 0 && (
                  <>
                    {mixed && <h2 className="mb-[10px] mt-5 text-[15px] font-semibold">Rankings</h2>}
                    <div className="mt-2 flex flex-col">
                      {ranks.map((item) => (
                        <RankingRow key={item.id} item={item} />
                      ))}
                    </div>
                  </>
                )}
                {lists.length > 0 && (
                  <>
                    {mixed && <h2 className="mb-[10px] mt-5 text-[15px] font-semibold">Lists</h2>}
                    <div className="mt-3">
                      <ListMasonry items={lists} />
                    </div>
                  </>
                )}
                {empty && <EmptyBlock message={copy.message} action={copy.action} onAction={onEmptyAction} />}
                {capped && (
                  // The pool is a cap, not the whole table: filtering it
                  // says what it searched.
                  <p className="mt-2 text-center text-[12px] font-medium text-m-t3">
                    Showing the {COMMUNITY_POOL_SIZE} most recently updated lists and rankings
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>

      <CreateSheet open={createOpen} onOpenChange={setCreateOpen} />
      {openId && <CommunityDetail listId={openId} onBack={closeDetail} />}
    </MobileScreen>
  )
}

/** Header, default (handoff §2.2): logo → Home · Search · Create (+). No
 *  bell or messages on Community. */
function HeaderRow({ onCreate }: { onCreate: () => void }) {
  const openSearch = useCommunityStore((s) => s.openSearch)
  return (
    <div className="flex h-12 items-center justify-between">
      <LogoLockup />
      <div className="flex items-center gap-1">
        <HeaderIconButton icon="search" label="Search Community" stroke={1.6} onClick={openSearch} />
        <button
          type="button"
          onClick={onCreate}
          aria-label="Create"
          title="Create"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-accent text-white active:bg-accent-strong"
        >
          <svg
            viewBox="0 0 16 16"
            width={15}
            height={15}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/** Header, search open (handoff §2.3): the field filters live; Cancel
 *  clears the query and keeps the tab and topic. */
function SearchRow() {
  const query = useCommunityStore((s) => s.query)
  const setQuery = useCommunityStore((s) => s.setQuery)
  const closeSearch = useCommunityStore((s) => s.closeSearch)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  return (
    <div className="flex h-12 items-center gap-[10px]">
      <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-m-b2 px-3">
        <MIcon name="search" size={15} stroke={1.8} className="text-m-t4" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Lists, rankings, people or players"
          aria-label="Search Community"
          enterKeyHint="search"
          autoComplete="off"
          className="min-w-0 flex-1 border-0 bg-transparent text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
        />
      </label>
      <button type="button" onClick={closeSearch} className="flex-none text-[15px] font-medium text-accent">
        Cancel
      </button>
    </div>
  )
}

function ChipRow<V extends string>({
  chips,
  value,
  onPick,
  label,
}: {
  chips: readonly { value: V; label: string }[]
  value: V
  onPick: (v: V) => void
  label: string
}) {
  return (
    <div className="-mx-4 flex gap-[6px] overflow-x-auto px-4 scrollbar-none" role="group" aria-label={label}>
      {chips.map((c) => {
        const on = value === c.value
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onPick(c.value)}
            aria-pressed={on}
            className={cn(
              'flex h-[30px] flex-none items-center whitespace-nowrap rounded-pill px-3 text-[12px] font-semibold',
              on ? 'bg-m-ink text-white' : 'bg-m-b2 text-m-t1',
            )}
          >
            {c.label}
          </button>
        )
      })}
    </div>
  )
}

/** Empty state (handoff §2.12): centred t3 message + a blue action. */
function EmptyBlock({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center gap-[10px] px-4 py-12 text-center">
      <p className="text-pretty text-[14px] font-medium leading-[1.4] text-m-t3">{message}</p>
      <button type="button" onClick={onAction} className="text-[14px] font-semibold text-accent">
        {action}
      </button>
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Community">
      <span className="mb-[6px] mt-[22px] block h-[22px] w-44 animate-pulse rounded-[14px] bg-m-b1" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <span className="h-[60px] w-[60px] flex-none animate-pulse rounded-[10px] bg-m-b1" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3.5 w-3/4 animate-pulse rounded-[14px] bg-m-b1" />
            <span className="h-3 w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          </span>
        </div>
      ))}
      <span className="mb-[10px] mt-[22px] block h-[22px] w-32 animate-pulse rounded-[14px] bg-m-b1" />
      <div className="grid grid-cols-2 gap-[10px]">
        <span className="h-[180px] animate-pulse rounded-[14px] bg-m-b1" />
        <span className="h-[150px] animate-pulse rounded-[14px] bg-m-b1" />
      </div>
    </div>
  )
}

/** Launch scope (CLAUDE.md): a switched-off surface is hidden, not shown
 *  empty — Start or sit and Rankings follow their own switches. */
function tabSwitchedOn(t: { value: string }): boolean {
  if (t.value === 'poll') return featureFlags.startOrSit
  if (t.value === 'rank') return featureFlags.weeklyRanks
  return true
}
