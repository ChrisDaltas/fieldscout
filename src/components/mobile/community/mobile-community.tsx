'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'

import { CommunityDetail } from '@/components/mobile/community/community-detail'
import {
  CardsSkeleton,
  EmptyBlock,
  LatestShelf,
  ListMasonry,
  MoreFooter,
  RankingRow,
  RowsSkeleton,
  ShelfHeader,
  UpdatedRow,
  pagedReadFailed,
  retryFailedReads,
} from '@/components/mobile/community/community-cards'
import {
  COMMUNITY_TABS,
  CREATE_LIST_HREF,
  LATEST_HREF,
  OLDER_NONE,
  RANK_POS_CHIPS,
  RANK_SCORING_CHIPS,
  closeCommunityDetail,
  communityView,
  deriveTopics,
  emptyCopy,
  normQuery,
  olderSpecs,
  rankTypeChips,
  topicAwaitingServer,
  withOlder,
  type CommunityTopic,
  type OlderRead,
  type OlderSpec,
} from '@/components/mobile/community/community-ops'
import { useCommunityStore } from '@/components/mobile/community/community-store'
import { TopScoutsShelf, TrendingTagsShelf } from '@/components/mobile/community/community-shelves'
import { CreateSheet } from '@/components/mobile/community/create-sheet'
import { activeWeekOf } from '@/components/mobile/rankings/rankings-ops'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { HeaderIconButton, LogoLockup, MobileScreen } from '@/components/mobile/ui/mobile-header'
import { useCommunityOlder } from '@/hooks/use-community-older'
import { useDebounced } from '@/hooks/use-debounced'
import { useFollowingIds } from '@/hooks/use-follows'
import {
  useCommunityInjuryMatches,
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
 * For you's order (Chris, 2026-10-15, gap list #35): a "Latest" section,
 * strictly newest-first, then everything else "popular + recent"
 * (`sortPopular` — lists getting likes lately rise, older posts fade). What
 * shows where is `communityView` (community-ops), kept pure and tested.
 * "Latest" is a horizontal shelf whose "See all" opens the Latest page
 * (`/app/explore/latest`, Chris 2026-10-16).
 *
 * Search and filters cover every public list (gap list §3 #30). The pool
 * holds the most recently updated 100; once it's full, a filtered view goes
 * on past it — the same filters, run on the server for the older lists
 * (`useCommunityOlder`), shown after the pool's matches and read a page at a
 * time: lists as the end comes near (or "Load more"), rankings above them
 * by "More rankings". The empty state waits until every list is searched.
 *
 * `currentWeek` is the app's NFL week (0 = offseason) — the Start or sit
 * shelf is titled with the week it's about, "Rankings this week" holds that
 * week's boards and the season rankings, and the season ranking's chip is
 * called "Rest of season" or "Pre-draft" by it (gap list §3 #27).
 */
export function MobileCommunity({ currentWeek }: { currentWeek: number }) {
  return (
    <Suspense fallback={null}>
      <CommunityScreen currentWeek={currentWeek} />
    </Suspense>
  )
}

const NO_IDS: ReadonlySet<string> = new Set()

function CommunityScreen({ currentWeek }: { currentWeek: number }) {
  const router = useRouter()
  const goBack = useGoBack()
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
  // Where the lists past the pool start — null while the pool holds them all.
  const olderFrom = feed.data?.olderFrom ?? null
  // The lists the server-side matchers ask about: the pool, plus the
  // recently liked lists For you weighs beside it.
  const poolIds = useMemo(
    () => [...new Set([...items, ...(feed.data?.popularExtra ?? [])].map((i) => i.id))],
    [items, feed.data],
  )
  const followingIds = following.data ?? NO_IDS

  const q = normQuery(query)
  const debouncedQ = useDebounced(q, 250)
  const playerTopic = topic?.kind === 'player' ? topic : null
  const injuriesTopic = topic?.kind === 'injuries'
  const topicMatches = useCommunityPlayerMatches(poolIds, { playerId: playerTopic?.id ?? null })
  const injuryMatches = useCommunityInjuryMatches(poolIds, injuriesTopic)
  const queryMatches = useCommunityPlayerMatches(poolIds, { query: debouncedQ })
  // The server half of a player topic / the Injuries topic / a player-name
  // search failed: say so and offer a retry — never a quietly partial (cover
  // players only) or empty ("Nothing matches") result.
  const matchError =
    playerTopic && topicMatches.isError
      ? { message: `Couldn’t load the lists with ${playerTopic.label}.`, retry: () => void topicMatches.refetch() }
      : injuriesTopic && injuryMatches.isError
        ? { message: 'Couldn’t load the lists with injured players.', retry: () => void injuryMatches.refetch() }
        : q && debouncedQ === q && queryMatches.isError
          ? { message: 'Couldn’t search player names.', retry: () => void queryMatches.refetch() }
          : null
  const topicPending = topicAwaitingServer(topic, {
    player: topicMatches.isLoading,
    injuries: injuryMatches.isLoading,
  })

  const topics = useMemo(() => deriveTopics(items, topic), [items, topic])
  // "Now" for the relative times and the For you order is when the feed was
  // read (the order holds still until the next read).
  const now = feed.dataUpdatedAt
  const view = communityView({
    pool: items,
    popularExtra: feed.data?.popularExtra ?? [],
    latestRows: feed.data?.latest ?? [],
    filter: {
      tab,
      topic,
      q,
      followingIds,
      topicListIds:
        topic?.kind === 'player' ? topicMatches.data : topic?.kind === 'injuries' ? injuryMatches.data : undefined,
      // Player-name matches join once the debounced query catches up.
      queryListIds: debouncedQ === q ? queryMatches.data : undefined,
    },
    rk,
    // Rankings follow their own switch (launch scope), not just the tab bar.
    ranksOn: featureFlags.weeklyRanks,
    // "Rankings this week": season rankings and this week's boards (#27).
    currentWeek,
    now,
  })
  const { shelves, latest, updates, shelfRanks, shelfLists, anyList } = view

  // Past the pool (gap list §3 #30): the same filters, on the server, for
  // the older lists. A search is sent once typing settles; until then it
  // shows as loading (never what was read for the last one).
  const specs = olderSpecs({ tab, topic, q, rk, ranksOn: featureFlags.weeklyRanks, followingIds })
  const olderRanks = useCommunityOlder(specs.rank, olderFrom, debouncedQ === q)
  const olderLists = useCommunityOlder(specs.list, olderFrom, debouncedQ === q)
  const rankRead = olderRead(specs.rank, olderFrom, olderRanks)
  const listRead = olderRead(specs.list, olderFrom, olderLists)
  const results = withOlder(view, { rank: rankRead, list: listRead }, { tab, rk })
  const { ranks, listBlocks } = results
  const ranksReading = rankRead !== OLDER_NONE
  const listsReading = listRead !== OLDER_NONE
  const mixed = tab === 'all' || tab === 'following'
  // Nothing shows and a read past the pool failed: one message for the
  // screen, with one Try again for every read that failed — not a "Couldn’t
  // load more" per read (two stacked, and "more" with nothing loaded).
  const failedReads = [ranksReading && olderRanks, listsReading && olderLists].filter(
    (r): r is typeof olderRanks => r !== false && pagedReadFailed(r),
  )
  const olderFailedBlank = results.loading && failedReads.length > 0
  const olderFailedCopy = q
    ? 'Couldn’t finish the search.'
    : `Couldn’t load the ${ranksReading && listsReading ? 'lists and rankings' : ranksReading ? 'rankings' : 'lists'}.`
  // What For you can show — the lists a Trending tag may filter to.
  const forYouShown = useMemo(
    () => [...items, ...(feed.data?.popularExtra ?? [])].filter((i) => featureFlags.weeklyRanks || i.kind !== 'rank'),
    [items, feed.data],
  )
  const topRef = useRef<HTMLDivElement>(null)
  const topicsRef = useRef<HTMLDivElement>(null)
  const revealTopic = useRef(false)
  // A Trending tag filters Community by that topic (the shelves only show
  // with none picked, so a tap always picks it). Once it's drawn, the screen
  // goes back to its top, where its lists start, with the picked pill in
  // view in the sideways topic row.
  const pickTag = (t: CommunityTopic) => {
    revealTopic.current = true
    toggleTopic(t)
  }
  useEffect(() => {
    if (!revealTopic.current) return
    revealTopic.current = false
    topRef.current?.scrollIntoView?.({ block: 'start' })
    topicsRef.current
      ?.querySelector<HTMLElement>('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [topic])

  // The detail is open from the feed only while `?list=` is set.
  useEffect(() => {
    if (!openId) setDetailFromFeed(false)
  }, [openId, setDetailFromFeed])

  // Back goes where you came from (Chris, gap list #27) — see
  // `closeCommunityDetail`.
  const closeDetail = () =>
    closeCommunityDetail(detailFromFeed, {
      popFeed: () => {
        setDetailFromFeed(false)
        window.history.back()
      },
      goBack,
    })

  const followingPending = tab === 'following' && following.isLoading
  // Rankings tab: the chips can exclude every ranking — say so (the
  // prototype went blank here; its empty test ran before the chips).
  const copy = emptyCopy(tab, topic, q, results.rankFilteredEmpty, { followsAnyone: followingIds.size > 0 })
  const onEmptyAction = () => {
    if (copy.kind === 'rank') resetRankFilters()
    else if (copy.kind === 'create') router.push(CREATE_LIST_HREF)
    else clearFilters()
  }

  return (
    <MobileScreen>
      <div ref={topRef} className="px-4 pb-6" inert={openId ? true : undefined}>
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
          <div
            ref={topicsRef}
            className="-mx-4 mt-[10px] flex scroll-px-4 gap-[6px] overflow-x-auto px-4 scrollbar-none"
            aria-label="Topics"
          >
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
                  {/* The handoff's trend pill: a 12px icon before "Injuries". */}
                  {t.kind === 'injuries' && <MIcon name="trend" size={12} stroke={2} />}
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
                {latest.length > 0 && (
                  <>
                    <ShelfHeader title="Latest" seeAllHref={LATEST_HREF} className="mb-[10px] mt-[22px]" />
                    <LatestShelf items={latest} now={now} />
                  </>
                )}
                {shelfRanks.length > 0 && (
                  <>
                    <ShelfHeader title="Rankings this week" onSeeAll={() => setTab('rank')} className="mb-[6px] mt-[22px]" />
                    <div className="flex flex-col">
                      {shelfRanks.map((item) => (
                        <RankingRow key={item.id} item={item} />
                      ))}
                    </div>
                  </>
                )}
                {/* Desktop's right-hand cards as For you shelves (gap list
                    §3 #26) — people, then topics, before the long Lists
                    shelf. */}
                <TopScoutsShelf />
                <TrendingTagsShelf shown={forYouShown} onPick={pickTag} />
                {shelfLists.length > 0 ? (
                  <>
                    <ShelfHeader title="Lists for you" onSeeAll={() => setTab('list')} className="mb-[10px] mt-[22px]" />
                    <ListMasonry items={shelfLists} />
                  </>
                ) : (
                  // Every list already shows under Latest: nothing more to
                  // shelve. No list anywhere: the empty card.
                  !anyList && (
                    <>
                      <ShelfHeader title="Lists for you" onSeeAll={() => setTab('list')} className="mb-[10px] mt-[22px]" />
                      <EmptyBlock
                        message={ranks.length > 0 ? 'No lists yet' : 'No lists or rankings yet'}
                        action="Create a list"
                        onAction={() => router.push(CREATE_LIST_HREF)}
                      />
                    </>
                  )
                )}
              </>
            ) : (
              <>
                {tab === 'rank' && (
                  <div className="mt-3 flex flex-col gap-[6px]">
                    <ChipRow
                      chips={rankTypeChips(currentWeek)}
                      value={rk.type}
                      onPick={(type) => setRank({ type })}
                      label="Ranking type"
                    />
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
                {/* Older rankings: on the Rankings tab they're the last
                    section, so they load as you scroll; above the lists,
                    by hand. Drawn with no ranking shown too while nothing
                    shows at all, or when the read failed — saying it was
                    the rankings, above the Lists heading. */}
                {ranksReading &&
                  !olderFailedBlank &&
                  (ranks.length > 0 || tab === 'rank' || results.loading || olderRanks.isError) && (
                    <MoreFooter
                      read={olderRanks}
                      auto={tab === 'rank'}
                      label="More rankings"
                      errorLabel={ranks.length > 0 ? 'Couldn’t load more rankings.' : 'Couldn’t load the rankings.'}
                      nothingShown={ranks.length === 0}
                      skeleton={<RowsSkeleton count={2} label="Loading more rankings" />}
                    />
                  )}
                {listBlocks.length > 0 && (
                  <>
                    {mixed && <h2 className="mb-[10px] mt-5 text-[15px] font-semibold">Lists</h2>}
                    {/* One masonry per page read, so a page arriving never
                        moves the cards above it (`withOlder`). A column's
                        last card loses its bottom margin at the block's
                        end, so the blocks are spaced by it instead. */}
                    <div className="mt-3 flex flex-col gap-[14px]">
                      {listBlocks.map((block) => (
                        <ListMasonry key={block[0]!.id} items={block} />
                      ))}
                    </div>
                  </>
                )}
                {listsReading && !olderFailedBlank && (
                  <MoreFooter
                    read={olderLists}
                    auto
                    errorLabel={listBlocks.length > 0 ? 'Couldn’t load more lists.' : 'Couldn’t load the lists.'}
                    nothingShown={results.loading}
                    skeleton={<CardsSkeleton label="Loading more lists" />}
                  />
                )}
                {results.empty && <EmptyBlock message={copy.message} action={copy.action} onAction={onEmptyAction} />}
                {olderFailedBlank && (
                  <EmptyBlock message={olderFailedCopy} action="Try again" onAction={() => retryFailedReads(failedReads)} />
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

function FeedSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading Community">
      <span className="mb-[10px] mt-[22px] block h-[22px] w-28 animate-pulse rounded-[14px] bg-m-b1" />
      {/* The Latest shelf: cards running off the right edge. */}
      <div className="-mx-4 flex gap-[10px] overflow-hidden px-4">
        {[0, 1, 2].map((i) => (
          <span key={i} className="flex w-[150px] flex-none flex-col gap-2">
            <span className="h-[150px] animate-pulse rounded-[14px] bg-m-b1" />
            <span className="h-3.5 w-4/5 animate-pulse rounded-[14px] bg-m-b1" />
            <span className="h-3 w-1/2 animate-pulse rounded-[14px] bg-m-b1" />
          </span>
        ))}
      </div>
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

/**
 * What a read past the pool has brought back, for `withOlder`: nothing to
 * read (the view needs none, the pool holds every public list, or Following
 * follows no one); nothing yet (reading, or the search still being typed);
 * else its pages, done once a page came back short.
 */
function olderRead(
  spec: OlderSpec | null,
  from: unknown,
  read: { data?: { pages: { items: OlderRead['pages'][number] }[] }; hasNextPage: boolean },
): OlderRead {
  if (!spec || !from || spec.following?.length === 0) return OLDER_NONE
  if (!read.data) return { pages: [], done: false }
  return { pages: read.data.pages.map((p) => p.items), done: !read.hasNextPage }
}
