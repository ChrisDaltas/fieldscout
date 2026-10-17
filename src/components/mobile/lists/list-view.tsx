'use client'

import * as React from 'react'

import { budgetShare } from '@/components/lists/v2/list-buckets'
import { playerCost } from '@/components/lists/v2/list-stats'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { UsernameLink } from '@/components/shared/username-link'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { useAuth } from '@/hooks/use-auth'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useList, useLists, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileListsCoverPassed } from '@/hooks/use-mobile-lists-cover-passed'
import { useMobileListsOwner } from '@/hooks/use-mobile-lists-owner'
import { rankPoolPositions, useMobileListsPosRanks } from '@/hooks/use-mobile-lists-pool'
import { useMobileListsLatestWeek, useMobileListsTimeframeStats } from '@/hooks/use-mobile-lists-timeframe-stats'
import { useMobileListsUsage } from '@/hooks/use-mobile-lists-usage'
import { toast } from '@/hooks/use-toast'
import { hasTiers, isNumbered } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useListDisplay, type ListOrg } from '@/stores/list-display-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { AiBuildStrip } from './ai-build-strip'
import { ListActionsSheet } from './list-actions-sheet'
import { draftedCount, groupOptions, groupSections, noteOf, notesCount, resolveGroup } from './list-tools'
import { ComparePickSheet, DraftedBox, GroupBySheet } from './list-tools-sheets'
import { playersLabel, shortName, tierChipClass, updatedLabel } from './lists-model'
import { useListsNav } from './lists-nav'
import {
  CenterNote,
  CoverCollage,
  CoverImage,
  InlineError,
  LIcon,
  PillButton,
  ScoringControl,
  TimeFrameControl,
  VideoCard,
  coverClass,
} from './lists-parts'
import { useListCheckOff, useListNotes, useListScoring, useListTimeFrame } from './lists-session-store'
import {
  cellTextClass,
  needsLastSeason,
  needsSource,
  resolveMobileStats,
  showsPoints,
  type MStat,
  type ValueCtx,
} from './lists-stats'
import { createSidewaysSync } from './sideways-sync'

/**
 * FieldScout Mobile — the List view (lr-lists §2.7, states L8–L8h): a 200px
 * cover with Back and Edit over it (both scroll away with it), the title, meta,
 * description and video, then "Players · n" and the table with its locked
 * 172px player column.
 *
 * App behaviour kept over the prototype's: a player row opens the player
 * profile (on an owned list with its "Remove from list" context), the
 * table's divider runs the full height and its rows run to the scroll end
 * (lr-lists gap 30), a 0-player list says so (L8g), and the cover carries a
 * "⋯" for the list features the design lacks (List options sheet).
 *
 * On a long list (Chris, 2026-10-15, gap list #25) the cover's controls don't
 * leave with it: once the cover scrolls off, a slim bar holds Back, the
 * title, ⋯ and Edit at the top, and the column names (Player · the stat
 * columns) stay pinned under it. The bar floats over the page rather than
 * taking a place in it, so nothing moves when it appears.
 *
 * Desktop's list tools live in the ⋯ sheet (gap list §3 #3): **Group by**
 * (Ranked / Tiers / Rounds / Avg cost / Budget %, desktop's buckets),
 * **Check off drafted** (a tick box on each row — the marks are the
 * account's, per list, as desktop's; drafted rows are dimmed and struck
 * through whether or not the boxes show), **Clear drafted**, **Show notes**
 * (each note under its player; a small mark beside the name otherwise) and
 * **Side by side**.
 */
export function ListView({ listId }: { listId: string }) {
  const nav = useListsNav()
  const { profile } = useAuth()
  const detail = useList(listId)
  const lists = useLists(1, 50)
  const aiBuild = useAiListBuild(listId)
  const pushHistory = useHistoryStore((state) => state.push)
  const draft = useDraftMode(listId)
  const display = useListDisplay(listId)
  const [optionsOpen, setOptionsOpen] = React.useState(false)
  const [groupOpen, setGroupOpen] = React.useState(false)
  const [compareOpen, setCompareOpen] = React.useState(false)
  const coverRef = React.useRef<HTMLDivElement>(null)
  const barRef = React.useRef<HTMLDivElement>(null)

  const list = detail.data
  const summary = lists.data?.lists.find((l) => l.id === listId)
  const owner = useMobileListsOwner(list?.owner_id, Boolean(list && !list.is_owner && !summary?.owner))
  const ownerUsername = list?.is_owner
    ? (profile?.username ?? null)
    : (summary?.owner?.username ?? owner.data ?? null)
  const canEdit = Boolean(list?.is_owner) && !aiBuild.building
  const loaded = Boolean(list) && !detail.isError
  const coverOff = useMobileListsCoverPassed(coverRef, barRef, loaded)
  const marked = draftedCount(list?.players ?? [], draft.drafted)
  const [checkOff, setCheckOff] = useListCheckOff(listId, marked > 0)
  const [notesShown, setNotesShown] = useListNotes(listId)

  // "Recently viewed" on Home — the desktop panel records the same entry.
  React.useEffect(() => {
    if (!list) return
    pushHistory({
      type: 'list',
      href: `/app/lists/${list.id}`,
      name: list.title,
      subtitle: playersLabel(list.player_count ?? list.players.length),
      imageUrl: list.thumbnail_url ?? undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list?.id, list?.title, list?.player_count, list?.thumbnail_url, pushHistory])

  const back = () => nav.closeList()

  if (detail.isError || !list) {
    return (
      <MobileScreen className="leading-[normal] tabular-nums">
        <div className="relative h-[200px] bg-m-b1">
          <CoverButton label="Back" onClick={back} className="left-3">
            <MIcon name="back" size={16} stroke={2} />
          </CoverButton>
        </div>
        {detail.isError ? (
          <CenterNote
            title="This list could not be loaded."
            body={detail.error.message}
            action={<PillButton onClick={() => void detail.refetch()}>Try again</PillButton>}
          />
        ) : (
          <div className="flex flex-col gap-2 px-4 pt-3.5" aria-busy="true" aria-label="Loading list">
            <div className="h-6 w-2/3 animate-pulse rounded-md bg-m-b1" />
            <div className="h-3 w-1/2 animate-pulse rounded-md bg-m-b1" />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="mt-2 h-11 animate-pulse rounded-[14px] bg-m-b1" />
            ))}
          </div>
        )}
      </MobileScreen>
    )
  }

  // Independent switches: a tier-only list has tier lines and no numbers.
  const tiersOn = hasTiers(list.ranking_mode)
  const ranked = isNumbered(list.ranking_mode)
  const count = list.players.length
  const videos = list.links.filter((link) => link.kind === 'video')
  const articles = list.links.filter((link) => link.kind === 'article')
  const options = groupOptions(list)
  const org = resolveGroup(display.org, list)
  const notes = notesCount(list.players)

  return (
    <MobileScreen className="leading-[normal] tabular-nums">
      <SlimBar
        barRef={barRef}
        shown={coverOff}
        title={list.title}
        onBack={back}
        onOptions={() => setOptionsOpen(true)}
        onEdit={canEdit ? () => nav.openEditor(list.id) : undefined}
      />
      <div ref={coverRef} className={cn('relative h-[200px] overflow-hidden', coverClass(list))}>
        {list.thumbnail_url ? (
          <CoverImage src={list.thumbnail_url} />
        ) : (
          <CoverCollage players={list.players.slice().sort((a, b) => a.position - b.position).map((e) => e.player)} size={60} />
        )}
        <CoverButton label="Back" onClick={back} className="left-3">
          <MIcon name="back" size={16} stroke={2} />
        </CoverButton>
        <div className="absolute right-3 top-2.5 flex gap-2">
          <button
            type="button"
            aria-label="List options"
            onClick={() => setOptionsOpen(true)}
            className="flex size-9 items-center justify-center rounded-full bg-black/35 text-white"
          >
            <LIcon name="dots" size={16} stroke={2.6} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => nav.openEditor(list.id)}
              className="flex h-9 items-center rounded-pill bg-black/35 px-3.5 text-[13px] font-semibold text-white"
            >
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pt-3.5">
        <h1 className="text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-m-t1 [text-wrap:pretty]">{list.title}</h1>
        <p className="text-[12px] font-medium text-m-t3">
          {ownerUsername ? (
            <>
              <UsernameLink username={ownerUsername} className="text-m-t3" /> ·{' '}
            </>
          ) : null}
          {playersLabel(count)} · {ranked ? 'Ranked' : tiersOn ? 'Tiers' : 'Unranked'}
          {list.is_owner && list.is_private ? ' · Private' : ''} · Updated {updatedLabel(list.updated_at)}
        </p>
        {list.description ? (
          <p className="text-[14px] font-medium leading-[1.45] text-m-t2 [text-wrap:pretty]">{list.description}</p>
        ) : null}
        {list.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {list.tags.map((tag) => (
              <span key={tag.id} className="flex h-6 items-center rounded-pill bg-m-b2 px-2.5 text-[12px] font-semibold text-m-t2">
                #{tag.name}
              </span>
            ))}
          </div>
        )}
        {videos.map((link) => (
          <VideoCard key={link.id} url={link.url} title={link.title} sub={link.source_label ?? 'Watch on YouTube'} />
        ))}
        {articles.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-xl bg-m-b1 p-2 active:bg-m-b2h"
          >
            <span className="flex size-9 flex-none items-center justify-center rounded-md bg-m-b2 text-m-t2">
              <LIcon name="share" size={15} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              {/* 189 holds an article to a title; guarded anyway so an untitled
                  row could never leave an empty line. */}
              {link.title ? <span className="truncate text-[13px] font-semibold text-m-t1">{link.title}</span> : null}
              <span className="truncate text-[11px] font-medium text-m-t3">{link.source_label ?? hostOf(link.url)}</span>
            </span>
          </a>
        ))}
        {aiBuild.job && <AiBuildStrip job={aiBuild.job} onRetry={aiBuild.retry} onDismiss={aiBuild.dismiss} />}
      </div>

      <PlayersTable
        list={list}
        org={org}
        ranked={ranked}
        canEdit={canEdit}
        drafted={draft.drafted}
        marked={marked}
        checkOff={checkOff}
        onTick={(playerId) => draft.toggleDrafted(playerId)}
        notesShown={notesShown && notes > 0}
        onAddPlayers={() => nav.openEditor(list.id, true)}
      />

      <ListActionsSheet
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        list={list}
        ownerUsername={ownerUsername}
        canEdit={canEdit}
        viewer={{ username: profile?.username ?? null, avatarUrl: profile?.avatar_url ?? null }}
        onEditDetails={() => nav.openDetails(list.id)}
        onDeleted={() => nav.closeList()}
        tools={{
          group: options.length > 1 ? (options.find((option) => option.id === org)?.label ?? null) : null,
          onGroupBy: () => setGroupOpen(true),
          checkOff,
          onCheckOff: setCheckOff,
          marked,
          onClearDrafted: () => {
            // Guarded in the hook: it refuses (and says why) over marks it
            // never read, so only a clear that ran is announced. The boxes
            // stay as they are — a cleared board is usually about to be
            // ticked again.
            if (draft.clearDrafted()) {
              setCheckOff(checkOff)
              toast({ title: 'Drafted marks cleared' })
            }
          },
          notes,
          notesShown,
          onNotes: setNotesShown,
          onCompare: () => setCompareOpen(true),
        }}
      />
      <GroupBySheet open={groupOpen} onOpenChange={setGroupOpen} listId={list.id} options={options} value={org} />
      <ComparePickSheet
        open={compareOpen}
        onOpenChange={setCompareOpen}
        initial={[list.id]}
        anchor={list}
        onShow={(ids) => nav.openCompare(ids)}
      />
    </MobileScreen>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 36px round control over the cover, `rgba(0,0,0,.35)`. */
function CoverButton({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn('absolute top-2.5 flex size-9 items-center justify-center rounded-full bg-black/35 text-white', className)}
    >
      {children}
    </button>
  )
}

// =============================================================================
// The slim bar (gap list #25)
// =============================================================================

/** Where the pinned column names stick: just under the slim bar (the safe
 *  area plus its 48px row, hairline included). */
const PINNED_UNDER_BAR = 'top-[calc(env(safe-area-inset-top)+48px)]'

/**
 * Back · the title · ⋯ · Edit, once the cover has scrolled off (#25). The
 * design has no such bar, so it extends the editor's header: a 48px b0 row
 * with a hairline under it, 36px round Back and ⋯, a 32px Edit pill.
 *
 * It hangs from a zero-height sticky anchor at the top of the screen, so it
 * covers the page without taking room in it: nothing below moves when it
 * fades in. Hidden, it is `inert` — out of the tab order and the screen
 * reader's view — while staying laid out, so its edge can be measured.
 */
function SlimBar({
  barRef,
  shown,
  title,
  onBack,
  onOptions,
  onEdit,
}: {
  barRef: React.RefObject<HTMLDivElement | null>
  shown: boolean
  title: string
  onBack: () => void
  onOptions: () => void
  /** Absent when the viewer can't edit (as the cover's Edit). */
  onEdit?: () => void
}) {
  return (
    <div className="sticky top-0 z-20 h-0" data-list-slim-bar>
      <div
        ref={barRef}
        inert={shown ? undefined : true}
        className={cn(
          'absolute inset-x-0 top-0 bg-m-b0 pt-[env(safe-area-inset-top)] transition-[opacity,visibility] duration-150 ease-out',
          shown ? 'visible opacity-100' : 'invisible opacity-0',
        )}
      >
        <div className="flex h-12 items-center gap-1 border-b border-m-b2 pl-2 pr-3">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
          >
            <MIcon name="back" size={16} stroke={2} />
          </button>
          <span className="min-w-0 flex-1 truncate pl-0.5 text-[16px] font-semibold text-m-t1">{title}</span>
          <button
            type="button"
            aria-label="List options"
            onClick={onOptions}
            className="flex size-9 flex-none items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
          >
            <LIcon name="dots" size={16} stroke={2.6} />
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="ml-1 flex h-8 flex-none items-center whitespace-nowrap rounded-pill bg-m-b2 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
            >
              Edit
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// "Players · n" + the table (lr-lists §2.7 items 3–4)
// =============================================================================

function PlayersTable({
  list,
  org,
  ranked,
  canEdit,
  drafted,
  marked,
  checkOff,
  onTick,
  notesShown,
  onAddPlayers,
}: {
  list: ListWithDetails
  /** The grouping drawn (Group by, `resolveGroup`). */
  org: ListOrg
  ranked: boolean
  canEdit: boolean
  /** This viewer's drafted marks on the list (`useDraftMode`). */
  drafted: ReadonlySet<string>
  /** How many of the list's players are marked. */
  marked: number
  /** Rows show their tick boxes (Check off drafted). */
  checkOff: boolean
  onTick: (playerId: string) => void
  notesShown: boolean
  onAddPlayers: () => void
}) {
  const display = useListDisplay(list.id)
  const stats = React.useMemo(() => resolveMobileStats(display.cols), [display.cols])
  const [tf, setTf] = useListTimeFrame(list.id)
  // The scoring every points column follows, this session (gap list #19).
  const [scoring, setScoring] = useListScoring(list.id)
  const openPlayerView = usePlayerModalStore((state) => state.openPlayerView)
  const hasStats = stats.length > 0
  const ids = list.players.map((entry) => entry.player_id)

  // Each column source is its own read, made only when a chosen column needs
  // it (in this scoring: outside PPR the payload's points columns read the
  // weekly rows too).
  const latest = useMobileListsLatestWeek(hasStats)
  const frames = useMobileListsTimeframeStats(
    ids,
    latest.data,
    needsSource(stats, 'frames', scoring),
    needsLastSeason(stats, scoring),
  )
  const usage = useMobileListsUsage(ids, needsSource(stats, 'usage'))
  const pool = useMobileListsPosRanks(
    rankPoolPositions(
      list.position_filter,
      list.players.map((entry) => entry.player.position),
    ),
    needsSource(stats, 'ranks'),
    scoring,
  )
  const ranks = pool.data ?? null

  // A failed read is said out loud — its cells stay blank, never "–" (CLAUDE.md).
  const failed = [latest, frames, usage, pool].filter((query) => query.isError)
  const latestWeek = latest.data ?? null
  const sections = React.useMemo(
    () => groupSections(list.players, org, display.budget),
    [list.players, org, display.budget],
  )
  // The tick box takes its own 46px, so the locked column grows to keep the
  // name's room (172 → 200).
  const lead = hasStats ? (checkOff ? 'w-[200px]' : 'w-[172px]') : 'w-full'
  const priced = org === 'cost' || org === 'budget'
  const ready = { frames: frames.isSuccess, usage: usage.isSuccess, ranks: pool.isSuccess }

  const open = (entry: ListPlayerWithPlayer) =>
    openPlayerView(entry.player_id, null, list.is_owner ? { listId: list.id, listTitle: list.title } : null)

  // The pinned column names and the table scroll sideways together (#25).
  // Whichever one moves on its own, by a swipe or a fling still coasting,
  // drags the other. The copy's own scroll event is recognised and not
  // written back, so a fling never stutters (sideways-sync.ts).
  const headRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [sideways] = React.useState(() =>
    createSidewaysSync((side) => (side === 'head' ? headRef.current : bodyRef.current)),
  )
  // A change of columns can move the table's scroll without a swipe.
  React.useEffect(() => {
    sideways.copy('body')
  }, [sideways, stats])

  let n = 0

  return (
    <>
      {/* The controls wrap under the title when a phone is too narrow for
          the scoring pill and the time frame beside it. */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5 px-4 pb-2 pt-[18px]">
        <span className="mr-auto whitespace-nowrap text-[16px] font-semibold text-m-t1">
          Players · {list.players.length}
          {marked > 0 && (
            <span className="text-[13px] font-medium text-m-t3"> · {list.players.length - marked} left</span>
          )}
        </span>
        {hasStats && (
          <span className="flex flex-none items-center gap-2">
            {showsPoints(stats) && <ScoringControl value={scoring} onChange={setScoring} />}
            <TimeFrameControl value={tf} onChange={setTf} latestWeek={latestWeek} />
          </span>
        )}
      </div>

      {failed.length > 0 && (
        <InlineError
          className="mx-4 mb-2"
          message="Some stats could not be loaded."
          onRetry={() => failed.forEach((query) => void query.refetch())}
        />
      )}

      {list.players.length === 0 ? (
        <CenterNote
          className="py-8"
          title="No players yet"
          body={canEdit ? 'Add players to start building this list.' : 'This list has no players yet.'}
          action={canEdit ? <PillButton onClick={onAddPlayers}>Add players</PillButton> : undefined}
        />
      ) : (
        <div>
          {/* The column names stay pinned under the slim bar (#25). A sticky
              row can't pin inside the table's sideways scroller (that makes
              it its own vertical scroller too), so the names sit just above
              it in a strip of their own that follows its sideways scroll —
              and drives it when the swipe starts on the names. */}
          {hasStats && (
            <div className={cn('sticky z-10 bg-m-b0', PINNED_UNDER_BAR)} data-list-column-names>
              <div
                ref={headRef}
                onScroll={() => sideways.scrolled('head')}
                className="overflow-x-auto scrollbar-none"
              >
                <div className="flex h-7 w-max min-w-full items-center border-b border-m-b3">
                  <div
                    className={cn(
                      'sticky left-0 z-[2] flex h-full flex-none items-center border-r border-m-b3 bg-m-b0 pl-4 text-[10px] font-semibold text-m-t3',
                      lead,
                    )}
                  >
                    Player
                  </div>
                  {stats.map((stat) => (
                    <div
                      key={stat.id}
                      className="flex w-[58px] flex-none items-center justify-center whitespace-nowrap text-[10px] font-semibold text-m-t3"
                    >
                      {stat.label}
                    </div>
                  ))}
                  <span className="w-3 flex-none" />
                </div>
              </div>
            </div>
          )}
          <div
            ref={bodyRef}
            onScroll={() => sideways.scrolled('body')}
            className="overflow-x-auto pb-6 scrollbar-none"
          >
            <div className="inline-flex min-w-full flex-col">
              {sections.map((section, sectionIndex) => (
                <React.Fragment key={section.label ?? sectionIndex}>
                  {section.label !== null && (
                    <div
                      className={cn(
                        'sticky left-0 flex items-center gap-1.5 pb-1 pl-4 pt-3',
                        hasStats && 'border-r border-m-b3',
                        lead,
                      )}
                    >
                      {/* Desktop's tier palette, as desktop's chip (gap list #10)
                          — rounds and price bands step through it too. */}
                      <span className={tierChipClass(section.colorIndex)}>{section.label}</span>
                      {section.meta ? (
                        <span className="text-[11px] font-semibold text-m-t3">{section.meta}</span>
                      ) : null}
                    </div>
                  )}
                  {section.entries.map((entry) => {
                    n += 1
                    return (
                      <PlayerRow
                        key={entry.id}
                        entry={entry}
                        rank={ranked ? n : null}
                        price={priced ? priceLabel(entry, org, display.budget) : null}
                        drafted={drafted.has(entry.player_id)}
                        checkOff={checkOff}
                        onTick={() => onTick(entry.player_id)}
                        noteShown={notesShown}
                        stats={stats}
                        ctx={{
                          frames: frames.data?.get(entry.player_id),
                          tf,
                          scoring,
                          usage: usage.data?.get(entry.player_id),
                          posRank: ranks ? (ranks.get(entry.player_id) ?? null) : undefined,
                          ready,
                        }}
                        lead={lead}
                        hasStats={hasStats}
                        onOpen={() => open(entry)}
                      />
                    )
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/** A priced grouping's figure on the row: "$45", or "$45 · 23%" by budget. */
function priceLabel(entry: ListPlayerWithPlayer, org: ListOrg, budget: number): string | null {
  const cost = playerCost(entry)
  if (cost === null) return null
  const money = `$${Math.round(cost)}`
  if (org !== 'budget') return money
  const share = budgetShare(entry, budget)
  return share === null ? money : `${money} · ${share}%`
}

function PlayerRow({
  entry,
  rank,
  price,
  drafted,
  checkOff,
  onTick,
  noteShown,
  stats,
  ctx,
  lead,
  hasStats,
  onOpen,
}: {
  entry: ListPlayerWithPlayer
  rank: number | null
  /** Avg cost / Budget %: the player's price on the second line. */
  price: string | null
  drafted: boolean
  checkOff: boolean
  onTick: () => void
  /** Show notes: the note runs under the row instead of a mark by the name. */
  noteShown: boolean
  stats: readonly MStat[]
  ctx: ValueCtx
  lead: string
  hasStats: boolean
  onOpen: () => void
}) {
  const player = entry.player
  const note = noteOf(entry)
  // Drafted is a resting look — a recessed fill, the name struck through and
  // the rest dimmed — never a shadow (CLAUDE.md → Elevation).
  const fill = drafted ? 'bg-m-b1' : 'bg-m-b0'
  return (
    <div className={cn('border-b border-m-b1', drafted && 'bg-m-b1')} data-drafted={drafted || undefined}>
      <div className="flex h-[52px] items-center">
        <div
          className={cn(
            'sticky left-0 z-[1] flex h-full flex-none items-center',
            fill,
            hasStats && 'border-r border-m-b3',
            lead,
          )}
        >
          {checkOff && (
            <button
              type="button"
              role="checkbox"
              aria-checked={drafted}
              aria-label={`Drafted: ${player.full_name}`}
              onClick={onTick}
              className="flex h-full w-[46px] flex-none items-center pl-4"
            >
              <DraftedBox on={drafted} />
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className={cn('flex h-full min-w-0 flex-1 items-center gap-2 text-left', !checkOff && 'pl-4')}
          >
            {rank !== null && (
              <span className="w-[18px] flex-none text-center text-[13px] font-bold tabular-nums text-m-t1">{rank}</span>
            )}
            <span className={cn('flex flex-none', drafted && 'opacity-45')}>
              <MHeadshot player={player} size={30} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col pr-2">
              <span className="flex min-w-0 items-center gap-1">
                <span
                  className={cn(
                    'truncate text-[13px] font-semibold',
                    drafted ? 'text-m-t3 line-through' : 'text-m-t1',
                  )}
                >
                  {shortName(player.full_name, player.position)}
                </span>
                {note && !noteShown ? (
                  <span className="flex flex-none text-accent">
                    <LIcon name="note" size={11} stroke={1.8} />
                    <span className="sr-only">Has a note</span>
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  'truncate whitespace-nowrap text-[10px] font-semibold',
                  posTextClass(player.position ?? ''),
                  drafted && 'opacity-60',
                )}
              >
                {posLabel(player.position ?? '')} <span className="font-medium text-m-t3">{player.team ?? 'FA'}</span>
                {price ? <span className="font-medium text-m-t3"> · {price}</span> : null}
              </span>
            </span>
          </button>
        </div>
        {stats.map((stat) => {
          const value = stat.value(entry, ctx)
          return (
            <div key={stat.id} className={cn('w-[58px] flex-none px-[3px]', drafted && 'opacity-45')}>
              <div
                className={cn(
                  'flex h-[26px] items-center justify-center rounded text-[12px] font-semibold tabular-nums',
                  drafted ? 'bg-m-b2' : 'bg-m-b1',
                  cellTextClass(value),
                )}
              >
                {value}
              </div>
            </div>
          )
        })}
        {hasStats && <span className="w-3 flex-none" />}
      </div>
      {note && noteShown ? (
        // Pinned to the screen's left edge, so a note reads in full however
        // far the stat columns are scrolled.
        <p
          className={cn(
            'sticky left-0 w-screen max-w-[100vw] px-4 pb-2.5 text-[12px] font-medium leading-[1.4] text-m-t2 [text-wrap:pretty]',
            drafted && 'opacity-60',
          )}
          data-list-note
        >
          {note}
        </p>
      ) : null}
    </div>
  )
}
