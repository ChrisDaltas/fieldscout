'use client'

import * as React from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import {
  useDraftedFanOut,
  useRegisterFanOutColumn,
  type ColumnMembership,
  type DraftedFanOut,
} from '@/components/lists/v2/drafted-fan-out'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { posLabel, posTextClass } from '@/components/mobile/ui/m-pos-chip'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useList, useLists, type ListPlayerWithPlayer, type ListWithTags } from '@/hooks/use-lists'
import { isNumbered } from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { resolveOrg, useListDisplay } from '@/stores/list-display-store'
import { usePlayerModalStore } from '@/stores/player-modal-store'

import { SheetRow } from './folder-sheets'
import { groupOptions, groupSections, leftLabel, resolveGroup } from './list-tools'
import { ComparePickSheet, DraftedBox, GroupBySheet } from './list-tools-sheets'
import { shortName, tierChipClass } from './lists-model'
import { useListsNav } from './lists-nav'
import { CenterNote, LIcon, PillButton } from './lists-parts'

/**
 * FieldScout Mobile — Side by side (`/app/lists?compare=<id>,<id>`): desktop's
 * comparison columns (`side-by-side-columns.tsx`) on a phone. The design has
 * no such screen (gap list §3 #3), so it's drawn in the Lists language: a
 * 52px bar (Back · Side by side · Change), then the lists as cards in a
 * sideways strip that snaps a column at a time, each scrolling on its own.
 *
 * Everything else is desktop's, composed rather than rebuilt:
 * - **A tick fans out across the comparison** and no further (D12,
 *   `drafted-fan-out.ts`): every column on screen that holds the player
 *   strikes him, each through its own `useDraftMode(listId)` write, and a
 *   column that fails rolls back alone.
 * - **Each column groups on its own** through its ⋯ (Group by, the same
 *   session store the List view reads), and its sub-line counts what's left.
 * - A name opens the player, with the list's Remove where the list is yours.
 *
 * Back goes to where you came from (#27), else the first column's list.
 */
export function CompareScreen({ ids }: { ids: readonly string[] }) {
  const nav = useListsNav()
  const lists = useLists(1, 50)
  const fanOut = useDraftedFanOut(ids)
  const [changing, setChanging] = React.useState(false)
  const summaryById = React.useMemo(
    () => new Map((lists.data?.lists ?? []).map((list) => [list.id, list] as const)),
    [lists.data?.lists],
  )

  return (
    <div
      className="fixed inset-0 z-[45] flex flex-col bg-m-b0 pt-[env(safe-area-inset-top)] leading-[normal] text-m-t1 tabular-nums"
      data-mobile-screen
    >
      <div className="grid h-[52px] flex-none grid-cols-[1fr_auto_1fr] items-center border-b border-m-b3 px-3">
        <button
          type="button"
          aria-label="Back"
          onClick={() => nav.closeCompare(ids[0])}
          className="flex size-9 items-center justify-center rounded-full text-m-t1 active:bg-m-b2"
        >
          <MIcon name="back" size={16} stroke={2} />
        </button>
        <span className="text-center text-[16px] font-semibold text-m-t1">Side by side</span>
        <button
          type="button"
          onClick={() => setChanging(true)}
          className="flex h-8 items-center justify-self-end whitespace-nowrap rounded-pill bg-m-b2 px-3.5 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
        >
          Change
        </button>
      </div>

      <div
        className="flex min-h-0 flex-1 snap-x snap-mandatory items-start gap-2.5 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 scrollbar-none"
        data-compare-strip
      >
        {ids.map((id) => (
          <CompareColumn
            key={id}
            listId={id}
            summary={summaryById.get(id)}
            fanOut={fanOut}
            onRemove={ids.length > 2 ? () => nav.changeCompare(ids.filter((other) => other !== id)) : undefined}
          />
        ))}
      </div>

      <ComparePickSheet open={changing} onOpenChange={setChanging} initial={ids} onShow={(next) => nav.changeCompare(next)} />
    </div>
  )
}

function CompareColumn({
  listId,
  summary,
  fanOut,
  onRemove,
}: {
  listId: string
  summary: ListWithTags | undefined
  fanOut: DraftedFanOut
  /** Absent while the comparison is down to two (it stays a comparison). */
  onRemove?: () => void
}) {
  const nav = useListsNav()
  const detail = useList(listId)
  const display = useListDisplay(listId)
  const { drafted, desiredDraftedFor, setDrafted } = useDraftMode(listId)
  const openPlayerView = usePlayerModalStore((state) => state.openPlayerView)
  const [optionsOpen, setOptionsOpen] = React.useState(false)
  const [groupOpen, setGroupOpen] = React.useState(false)

  const list = detail.data
  const entries = list?.players
  const rankingMode = list?.ranking_mode ?? summary?.ranking_mode
  const org = list ? resolveGroup(display.org, list) : resolveOrg(display.org, rankingMode)
  const numbered = isNumbered(rankingMode)
  const title = list?.title ?? summary?.title ?? 'List'
  const canEdit = Boolean(list?.is_owner)
  const sections = React.useMemo(
    () => groupSections(entries ?? [], org, display.budget),
    [entries, org, display.budget],
  )
  const options = list ? groupOptions(list) : []

  const memberIds = React.useMemo(
    () => (entries ? new Set(entries.map((entry) => entry.player_id)) : null),
    [entries],
  )

  // Join the comparison's fan-out (D12) exactly as a desktop column does.
  useRegisterFanOutColumn(fanOut, listId, {
    title,
    membership: (playerId): ColumnMembership =>
      detail.isError ? 'unreadable' : !memberIds ? 'loading' : memberIds.has(playerId) ? 'in' : 'out',
    desiredFor: desiredDraftedFor,
    write: (playerId, next) => setDrafted(playerId, next, { notify: false }),
  })

  const subline = detail.isError ? 'Could not load' : entries ? leftLabel(entries, drafted) : 'Loading…'
  const cover = list ?? summary ?? null

  const open = (entry: ListPlayerWithPlayer) =>
    openPlayerView(entry.player_id, null, canEdit && list ? { listId: list.id, listTitle: list.title } : null)

  let n = 0

  return (
    <section
      aria-label={title}
      className="flex max-h-full w-[min(300px,calc(100vw-56px))] flex-none snap-start flex-col overflow-hidden rounded-2xl border border-m-b2 bg-m-b0"
      data-compare-column={listId}
    >
      <div className="flex flex-none items-center gap-2.5 border-b border-m-b2 py-2 pl-3 pr-1.5">
        {cover ? (
          <ListThumbnail
            positionFilter={cover.position_filter}
            coverColor={cover.cover_color}
            isTeam={cover.is_team ?? false}
            imageUrl={cover.thumbnail_url}
            players={summary?.first_players}
            size={30}
          />
        ) : (
          <span aria-hidden className="size-[30px] flex-none rounded bg-m-b1" />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[14px] font-semibold text-m-t1">{title}</span>
          <span className="truncate text-[11px] font-medium text-m-t3">{subline}</span>
        </span>
        <button
          type="button"
          aria-label={`Options for ${title}`}
          onClick={() => setOptionsOpen(true)}
          className="flex size-9 flex-none items-center justify-center rounded-full text-m-t2 active:bg-m-b2"
        >
          <LIcon name="dots" size={16} stroke={2.6} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2 pt-1 scrollbar-none">
        {detail.isError ? (
          <CenterNote
            className="py-8"
            title="This list could not be loaded."
            action={<PillButton onClick={() => void detail.refetch()}>Try again</PillButton>}
          />
        ) : !entries ? (
          <div className="flex flex-col gap-1.5 px-1.5 pt-1.5" aria-busy="true" aria-label="Loading list">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded-lg bg-m-b1" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <CenterNote className="py-8" title="No players yet" />
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              {section.label !== null && (
                <div className="flex items-center gap-1.5 px-1.5 pb-1 pt-2.5">
                  <span className={tierChipClass(section.colorIndex)}>{section.label}</span>
                  {section.meta ? <span className="text-[11px] font-semibold text-m-t3">{section.meta}</span> : null}
                </div>
              )}
              {section.entries.map((entry) => {
                n += 1
                return (
                  <CompareRow
                    key={entry.id}
                    entry={entry}
                    rank={numbered ? n : null}
                    drafted={drafted.has(entry.player_id)}
                    onTick={() => fanOut.tick(listId, entry.player_id, entry.player.full_name)}
                    onOpen={() => open(entry)}
                  />
                )
              })}
            </div>
          ))
        )}
      </div>

      <MobileSheet open={optionsOpen} onOpenChange={setOptionsOpen} title={title} subtitle="Column options" showClose>
        <div className="flex flex-col px-3 pb-[max(8px,env(safe-area-inset-bottom))]">
          {options.length > 1 && (
            <SheetRow
              icon={<LIcon name="group" size={15} />}
              label="Group by"
              sub={options.find((option) => option.id === org)?.label}
              onClick={() => {
                setOptionsOpen(false)
                setGroupOpen(true)
              }}
            />
          )}
          <SheetRow
            icon={<LIcon name="share" size={15} />}
            label="Open list"
            onClick={() => {
              setOptionsOpen(false)
              nav.openListFromCompare(listId)
            }}
          />
          {onRemove && (
            <SheetRow
              icon={<MIcon name="close" size={13} stroke={2.2} />}
              label="Remove column"
              onClick={() => {
                setOptionsOpen(false)
                onRemove()
              }}
            />
          )}
        </div>
      </MobileSheet>
      {list && <GroupBySheet open={groupOpen} onOpenChange={setGroupOpen} listId={listId} options={options} value={org} />}
    </section>
  )
}

function CompareRow({
  entry,
  rank,
  drafted,
  onTick,
  onOpen,
}: {
  entry: ListPlayerWithPlayer
  rank: number | null
  drafted: boolean
  onTick: () => void
  onOpen: () => void
}) {
  const player = entry.player
  const name = shortName(player.full_name, player.position)
  return (
    <div className={cn('flex h-11 items-center rounded-lg pr-2', drafted && 'bg-m-b1')} data-drafted={drafted || undefined}>
      <button
        type="button"
        role="checkbox"
        aria-checked={drafted}
        aria-label={`Drafted: ${player.full_name}`}
        onClick={onTick}
        className="flex h-full w-9 flex-none items-center justify-center"
      >
        <DraftedBox on={drafted} />
      </button>
      {rank !== null && (
        <span className="w-6 flex-none text-[12px] font-bold tabular-nums text-m-t3">{rank}</span>
      )}
      <button type="button" onClick={onOpen} className="flex h-full min-w-0 flex-1 flex-col justify-center text-left">
        <span className={cn('truncate text-[13px] font-semibold', drafted ? 'text-m-t3 line-through' : 'text-m-t1')}>
          {name}
        </span>
        <span className={cn('whitespace-nowrap text-[10px] font-semibold', posTextClass(player.position ?? ''), drafted && 'opacity-60')}>
          {posLabel(player.position ?? '')} <span className="font-medium text-m-t3">{player.team ?? 'FA'}</span>
        </span>
      </button>
    </div>
  )
}
