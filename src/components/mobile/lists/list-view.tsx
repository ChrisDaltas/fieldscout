'use client'

import * as React from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MHeadshot } from '@/components/mobile/ui/m-headshot'
import { MobileScreen } from '@/components/mobile/ui/mobile-header'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { UsernameLink } from '@/components/shared/username-link'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { useAuth } from '@/hooks/use-auth'
import { useList, useLists, type ListPlayerWithPlayer, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileListsOwner } from '@/hooks/use-mobile-lists-owner'
import { posRanks, rankPoolPositions, useMobileListsPool } from '@/hooks/use-mobile-lists-pool'
import { useMobileListsLatestWeek, useMobileListsTimeframeStats } from '@/hooks/use-mobile-lists-timeframe-stats'
import { useMobileListsUsage } from '@/hooks/use-mobile-lists-usage'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useListDisplay } from '@/stores/list-display-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'
import { VIDEO_TITLE_FALLBACK } from '@/utils/youtube'

import { AiBuildStrip } from './ai-build-strip'
import { ListActionsSheet } from './list-actions-sheet'
import { playersLabel, shortName, tierChipClass, updatedLabel, viewSections } from './lists-model'
import { useListsNav } from './lists-nav'
import { CenterNote, CoverCollage, CoverImage, InlineError, LIcon, PillButton, TimeFrameControl, VideoCard, coverClass } from './lists-parts'
import { useListTimeFrame } from './lists-session-store'
import { cellTextClass, needsSource, resolveMobileStats, type MStat, type ValueCtx } from './lists-stats'

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
 */
export function ListView({ listId }: { listId: string }) {
  const nav = useListsNav()
  const { profile } = useAuth()
  const detail = useList(listId)
  const lists = useLists(1, 50)
  const aiBuild = useAiListBuild(listId)
  const pushHistory = useHistoryStore((state) => state.push)
  const [optionsOpen, setOptionsOpen] = React.useState(false)

  const list = detail.data
  const summary = lists.data?.lists.find((l) => l.id === listId)
  const owner = useMobileListsOwner(list?.owner_id, Boolean(list && !list.is_owner && !summary?.owner))
  const ownerUsername = list?.is_owner
    ? (profile?.username ?? null)
    : (summary?.owner?.username ?? owner.data ?? null)
  const canEdit = Boolean(list?.is_owner) && !aiBuild.building

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

  const tiersOn = list.ranking_mode === 'rank_and_tier'
  const ranked = list.ranking_mode !== 'unranked'
  const count = list.players.length
  const videos = list.links.filter((link) => link.kind === 'video')
  const articles = list.links.filter((link) => link.kind === 'article')

  return (
    <MobileScreen className="leading-[normal] tabular-nums">
      <div className={cn('relative h-[200px] overflow-hidden', coverClass(list))}>
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
          {playersLabel(count)} · {ranked ? 'Ranked' : 'Unranked'}
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
          <VideoCard key={link.id} url={link.url} title={link.title || VIDEO_TITLE_FALLBACK} sub={link.source_label ?? 'Watch on YouTube'} />
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
              <span className="truncate text-[13px] font-semibold text-m-t1">{link.title}</span>
              <span className="truncate text-[11px] font-medium text-m-t3">{link.source_label ?? hostOf(link.url)}</span>
            </span>
          </a>
        ))}
        {aiBuild.job && <AiBuildStrip job={aiBuild.job} onRetry={aiBuild.retry} onDismiss={aiBuild.dismiss} />}
      </div>

      <PlayersTable
        list={list}
        tiersOn={tiersOn}
        ranked={ranked}
        canEdit={canEdit}
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
// "Players · n" + the table (lr-lists §2.7 items 3–4)
// =============================================================================

function PlayersTable({
  list,
  tiersOn,
  ranked,
  canEdit,
  onAddPlayers,
}: {
  list: ListWithDetails
  tiersOn: boolean
  ranked: boolean
  canEdit: boolean
  onAddPlayers: () => void
}) {
  const display = useListDisplay(list.id)
  const stats = React.useMemo(() => resolveMobileStats(display.cols), [display.cols])
  const [tf, setTf] = useListTimeFrame(list.id)
  const openPlayerView = usePlayerModalStore((state) => state.openPlayerView)
  const hasStats = stats.length > 0
  const ids = list.players.map((entry) => entry.player_id)

  // Each column source is its own read, made only when a chosen column needs it.
  const latest = useMobileListsLatestWeek(hasStats)
  const frames = useMobileListsTimeframeStats(ids, latest.data, needsSource(stats, 'frames'))
  const usage = useMobileListsUsage(ids, needsSource(stats, 'usage'))
  const pool = useMobileListsPool(
    rankPoolPositions(
      list.position_filter,
      list.players.map((entry) => entry.player.position),
    ),
    needsSource(stats, 'ranks'),
  )
  const ranks = React.useMemo(() => (pool.data ? posRanks(pool.data) : null), [pool.data])

  // A failed read is said out loud — its cells stay blank, never "–" (CLAUDE.md).
  const failed = [latest, frames, usage, pool].filter((query) => query.isError)
  const latestWeek = latest.data ?? null
  const sections = React.useMemo(() => viewSections(list.players, tiersOn), [list.players, tiersOn])
  const lead = hasStats ? 'w-[172px]' : 'w-full'
  const ready = { frames: frames.isSuccess, usage: usage.isSuccess, ranks: pool.isSuccess }

  const open = (entry: ListPlayerWithPlayer) =>
    openPlayerView(entry.player_id, null, list.is_owner ? { listId: list.id, listTitle: list.title } : null)

  let n = 0

  return (
    <>
      <div className="flex items-center gap-2 px-4 pb-2 pt-[18px]">
        <span className="flex-1 text-[16px] font-semibold text-m-t1">Players · {list.players.length}</span>
        {hasStats && <TimeFrameControl value={tf} onChange={setTf} latestWeek={latestWeek} />}
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
        <div className="overflow-x-auto pb-6 scrollbar-none">
          <div className="inline-flex min-w-full flex-col">
            {hasStats && (
              <div className="flex h-7 items-center border-b border-m-b3">
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
            )}
            {sections.map((section, sectionIndex) => (
              <React.Fragment key={section.label ?? sectionIndex}>
                {section.label !== null && (
                  <div className={cn('sticky left-0 pb-1 pl-4 pt-3', hasStats && 'border-r border-m-b3', lead)}>
                    {/* Desktop's tier palette, as desktop's chip (gap list #10). */}
                    <span className={tierChipClass(section.tierIndex)}>{section.label}</span>
                  </div>
                )}
                {section.entries.map((entry) => {
                  n += 1
                  return (
                    <PlayerRow
                      key={entry.id}
                      entry={entry}
                      rank={ranked ? n : null}
                      stats={stats}
                      ctx={{
                        frames: frames.data?.get(entry.player_id),
                        tf,
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
      )}
    </>
  )
}

function PlayerRow({
  entry,
  rank,
  stats,
  ctx,
  lead,
  hasStats,
  onOpen,
}: {
  entry: ListPlayerWithPlayer
  rank: number | null
  stats: readonly MStat[]
  ctx: ValueCtx
  lead: string
  hasStats: boolean
  onOpen: () => void
}) {
  const player = entry.player
  return (
    <div className="flex h-[52px] items-center border-b border-m-b1">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'sticky left-0 z-[1] flex h-full flex-none items-center gap-2 bg-m-b0 pl-4 text-left',
          hasStats && 'border-r border-m-b3',
          lead,
        )}
      >
        {rank !== null && (
          <span className="w-[18px] flex-none text-center text-[13px] font-bold tabular-nums text-m-t1">{rank}</span>
        )}
        <MHeadshot player={player} size={30} />
        <span className="flex min-w-0 flex-1 flex-col pr-2">
          <span className="truncate text-[13px] font-semibold text-m-t1">{shortName(player.full_name, player.position)}</span>
          <span className={cn('whitespace-nowrap text-[10px] font-semibold', posTextClass(player.position ?? ''))}>
            {posLabel(player.position ?? '')} <span className="font-medium text-m-t3">{player.team ?? 'FA'}</span>
          </span>
        </span>
      </button>
      {stats.map((stat) => {
        const value = stat.value(entry, ctx)
        return (
          <div key={stat.id} className="w-[58px] flex-none px-[3px]">
            <div
              className={cn(
                'flex h-[26px] items-center justify-center rounded bg-m-b1 text-[12px] font-semibold tabular-nums',
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
  )
}
