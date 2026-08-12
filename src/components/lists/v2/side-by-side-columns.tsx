'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useList, type ListPlayerWithPlayer, type ListWithTags } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import {
  resolveOrg,
  useListDisplay,
  useListDisplayStore,
  type ListOrg,
} from '@/stores/list-display-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { ListCoverTile } from './cover-tile'
import { bucketHeading, buildBuckets, ORG_OPTIONS, rankMap } from './list-buckets'
import { DraftedCheckbox, EmptyListState, PlayerMeta, PlayerName } from './list-row-parts'

/**
 * Lists v2 — Side by side, step two: **the columns** (LV.13).
 *
 * Built from `docs/design/lists/screens/side-by-side-columns.png` (the fidelity
 * reference, which outranks the prose — `screens/README.md`) and the design
 * LAW's §"Mode: Side by side" → *Columns* bullets, with
 * `docs/design/lists/design/ListsScreen.jsx` (`Compare`, `CompareColumn`,
 * `CompareRow`, :468–530) as the prototype source.
 *
 * ## Composition, not a third tree (plan §6, **D11**)
 *
 * Every behaviour on this screen already exists, so nothing here re-solves one:
 *
 * | Piece | Comes from |
 * | --- | --- |
 * | grouping / bucketing / band colour | `list-buckets.ts` (`buildBuckets`, `bucketHeading`, `rankMap`) |
 * | the cover | `cover-tile.tsx` (`ListCoverTile`) |
 * | checkbox, name, position + team, empty state | `list-row-parts.tsx` |
 * | drafted marks | `use-draft-mode.ts` — the account-persisted source LV.1.3 pointed it at |
 * | the player mini card | `usePlayerWindowsStore`, opened exactly as `list-detail-panel.tsx` opens it |
 * | which grouping this list is showing | `list-display-store.ts` (`useListDisplay` / `setOrg`), session-only (**D3**) |
 *
 * ## Each column groups independently — and that is what the store already does
 *
 * `list-display-store` is keyed **by list id**, so a column's `dots` menu writes
 * `setOrg(thisList, …)` and no other column moves. The prototype does the same
 * thing (`st.patch(list, { org })`), which is also why a column and the detail
 * panel showing the *same* list agree: they read one session value, not two.
 *
 * The menu **does not** persist `lists.ranking_mode`. The detail panel's
 * grouping control does, and that write is a deliberate restoration of the last
 * `rank_and_tier` writer in the codebase (PROGRESS §3 Q3, LV.7) — not a rule
 * about grouping. D3 governs everything else: display state does not save. A
 * comparison also routinely contains lists you do **not** own, where that write
 * is not yours to make.
 *
 * ## What a tick does here, in THIS task
 *
 * **One tick, one list.** The checkbox writes through `useDraftMode(listId)`
 * exactly as the open list does — one row in `list_player_drafted`, keyed
 * `(user_id, list_id, player_id)`. The fan-out across the whole comparison set
 * is **LV.14** and is governed by plan **D12**; nothing here marks anything in
 * a list other than its own.
 *
 * The header's live `N of M left` is derived **per column from that column's own
 * rows**, which is the count D12 asks for as well — it stays correct under
 * today's behaviour and under a partial fan-out alike.
 *
 * ## Scale
 *
 * The handoff's numbers are 1× and this app's tokens are ×0.8 (plan §1) — the
 * same conversion Round 1 made throughout (60px row → 48, 44px row → 36, 30px
 * cover → 24, 26px cover → 21):
 *
 * | Handoff | Here |
 * | --- | --- |
 * | column 300px fixed | `w-[240px] shrink-0` |
 * | scroller `margin: 0 -36px; padding: 0 36px 8px` | the app's **own** gutter — `-mx-4 px-4` / `lg:-mx-7 lg:px-7`, `pb-1.5`. `px-7` is 28px, which is 36 × 0.8, and it has to be the shell's real padding (`app-shell.tsx`) or the bleed either falls short or pushes the page into a horizontal scroll |
 * | column gap 12 | `gap-2.5` (10px) |
 * | header 26px cover, name 13/700, count 10.5/500 mono | `size={21}`, 10.5/700, 8.5/500 mono |
 * | band header 26px tall, 11.5/700 | `h-[21px]`, 9/700 |
 * | row 38px tall, `#N` 26px wide at 11.5/500 | `h-[30px]`, `w-[21px]` at 9/500 |
 * | 14px checkbox | `DraftedCheckbox`, unchanged — the design's 14px box already ships at 1:1 |
 *
 * ## Elevation and the phone
 *
 * The panels rest **flat** with the 1px ink border and lift only under the
 * cursor, like every other card on this screen (CLAUDE.md → Elevation; the
 * prototype's `fs-lift`). A drafted row's state is fill plus strike-through,
 * never a shadow. The `dots` menu is a true overlay and keeps its resting
 * shadow, which it gets from `ui/dropdown-menu`.
 *
 * **There is no phone-specific treatment, by ruling** (Chris, 2026-08-11 —
 * *"id say leave the phone version as is"*). A 240px column on a 375px screen
 * is a sideways scroll through the columns, and that is the intended behaviour
 * rather than a gap: no stacking, no breakpoint width override, no
 * desktop-only empty state.
 */

interface SideBySideColumnsProps {
  /** The chosen comparison, in pick order. Session-only state, held by the page (D3). */
  ids: readonly string[]
  /**
   * The collection rows, for the header before each column's own detail query
   * lands. A missing entry is survivable — the column's `useList` is the
   * authority on whether the list exists.
   */
  summaryById: ReadonlyMap<string, ListWithTags>
  /** Drop one column. Removing the last one falls back to the picker. */
  onRemove: (listId: string) => void
}

export function SideBySideColumns({ ids, summaryById, onRemove }: SideBySideColumnsProps) {
  return (
    <div
      // Full-bleed: the negative margin cancels the shell's gutter and the
      // padding puts it back *inside* the scroll container, so the first and
      // last columns still line up with the page while the strip runs edge to
      // edge past it. `scroll-px-*` keeps a keyboard/snap scroll from parking a
      // column underneath that padding.
      className="-mx-4 flex items-start gap-2.5 overflow-x-auto scroll-px-4 px-4 pb-1.5 lg:-mx-7 lg:scroll-px-7 lg:px-7"
    >
      {ids.map((id) => (
        <ComparisonColumn
          key={id}
          listId={id}
          summary={summaryById.get(id)}
          onRemove={() => onRemove(id)}
        />
      ))}
    </div>
  )
}

function ComparisonColumn({
  listId,
  summary,
  onRemove,
}: {
  listId: string
  summary: ListWithTags | undefined
  onRemove: () => void
}) {
  const detail = useList(listId)
  const display = useListDisplay(listId)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const { drafted, toggleDrafted } = useDraftMode(listId)
  const openPlayerWindow = usePlayerWindowsStore((state) => state.open)

  const list = detail.data
  const entries = list?.players
  const org: ListOrg = resolveOrg(display.org, list?.ranking_mode ?? summary?.ranking_mode)

  const buckets = React.useMemo(
    () =>
      buildBuckets({
        org,
        entries: entries ?? [],
        bandLabels: display.bandLabels,
        budget: display.budget,
      }),
    [org, entries, display.bandLabels, display.budget],
  )
  const ranks = React.useMemo(() => rankMap(buckets), [buckets])

  // The list is editable only by its owner, and a comparison routinely holds
  // saved lists that are not yours. This gates the mini card's list context —
  // the window offers "Remove from list" only where that would be legal — and
  // the empty state's copy, exactly as the open list decides them.
  const canEdit = Boolean(list?.is_owner)
  const title = list?.title ?? summary?.title ?? 'List'
  const cover = list ?? summary ?? null

  const openPlayer = React.useCallback(
    (entry: ListPlayerWithPlayer) =>
      openPlayerWindow(entry.player_id, {
        listContext: canEdit && list ? { listId: list.id, listTitle: list.title } : null,
      }),
    [openPlayerWindow, canEdit, list],
  )

  /**
   * `18 of 24 left`, live — and **only once the marks and the rows are both
   * real**.
   *
   * A column that renders `0 of 0 left` over a request that has not answered is
   * CLAUDE.md's "never let 'nothing happened' mean 'it worked'" written as a
   * headline number, on the one screen where the count is the whole point. The
   * loading and failed reads therefore say what they are.
   */
  const left = (entries ?? []).filter((entry) => !drafted.has(entry.player_id)).length
  const subline = detail.isError
    ? 'Could not load'
    : entries
      ? `${left} of ${entries.length} left`
      : 'Loading…'

  return (
    <section
      // Named, because the cover tile is `aria-hidden` and the title sits in a
      // nested span — leaving the column to be computed from its subtree is one
      // refactor away from a landmark that announces nothing (LV.12's finding).
      aria-label={title}
      className="flex w-[240px] shrink-0 flex-col self-start border border-ink bg-white transition-shadow hover:shadow-hard-4"
    >
      <div className="flex items-center gap-1.5 border-b border-ink py-[7px] pl-2 pr-1.5">
        {cover ? (
          <ListCoverTile list={cover} players={summary?.first_players} size={21} />
        ) : (
          <span aria-hidden="true" className="h-[21px] w-[21px] shrink-0 rounded-sm bg-n-4" />
        )}
        <span className="mr-auto min-w-0">
          <span className="block truncate text-[10.5px] font-bold leading-tight">{title}</span>
          <span className="fs-num mt-px block text-[8.5px] font-medium leading-tight text-n-3">
            {subline}
          </span>
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="stroke"
              size="icon-sm"
              title="Column options"
              aria-label={`Options for ${title}`}
            >
              <Icon name="dots" size={13} />
            </Button>
          </DropdownMenuTrigger>
          {/* 168px, not the prototype's 180 × 0.8: `Remove column` wraps onto
              two lines at 144 once the item's icon and padding are counted.
              It is the width `RowMenu` already uses for the same reason. */}
          <DropdownMenuContent align="end" className="w-[168px]">
            {/* The five grouping modes, from the one list every grouping surface
                reads (`ORG_OPTIONS`), and keyed to THIS list's id — which is
                what makes the columns group independently. */}
            {ORG_OPTIONS.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => setOrg(listId, option.id)}>
                {option.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRemove}>
              <Icon name="close" size={13} />
              Remove column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {detail.isError ? (
        <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
          <Icon name="info-circle" size={16} className="text-negative-strong" />
          <p className="text-[11px] font-bold">This list could not be loaded.</p>
          <p className="text-[9px] font-medium text-n-3">{detail.error.message}</p>
        </div>
      ) : !entries ? (
        <div className="flex animate-pulse flex-col" aria-busy="true" aria-label="Loading list">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <span key={row} className="h-[30px] border-b border-n-4 p-2">
              <span className="block h-full rounded-sm bg-n-4" />
            </span>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-2">
          <EmptyListState canEdit={canEdit} />
        </div>
      ) : (
        buckets.map((bucket) => {
          const heading = bucketHeading(org, bucket)
          return (
            <div key={bucket.key}>
              {heading !== null && (
                <div
                  className={cn(
                    'flex h-[21px] items-center border-b border-ink px-2 text-[9px] font-bold',
                    bucket.className,
                  )}
                >
                  {heading}
                </div>
              )}
              {bucket.entries.map((entry) => (
                <ComparisonRow
                  key={entry.id}
                  entry={entry}
                  rank={ranks.get(entry.id) ?? 0}
                  drafted={drafted.has(entry.player_id)}
                  onToggleDrafted={() => toggleDrafted(entry.player_id)}
                  onOpenPlayer={() => openPlayer(entry)}
                />
              ))}
            </div>
          )
        })
      )}
    </section>
  )
}

function ComparisonRow({
  entry,
  rank,
  drafted,
  onToggleDrafted,
  onOpenPlayer,
}: {
  entry: ListPlayerWithPlayer
  rank: number
  drafted: boolean
  onToggleDrafted: () => void
  onOpenPlayer: () => void
}) {
  return (
    <div
      className={cn(
        'flex h-[30px] items-center gap-1.5 border-b border-n-4 px-2 transition-colors',
        // Drafted is a resting condition, so it is carried by fill and the
        // strike-through below — never by elevation (CLAUDE.md → Elevation).
        drafted ? 'bg-n-4' : 'bg-white hover:bg-accent-soft',
      )}
    >
      {/* Permanent — there is no draft-mode gate (Chris, 2026-08-10; plan D2).
          One tick, one list: `toggleDrafted` is this column's own
          `useDraftMode(listId)`. The comparison-wide fan-out is LV.14 (D12). */}
      <DraftedCheckbox drafted={drafted} onToggle={onToggleDrafted} />
      <span className="fs-num w-[21px] shrink-0 text-[9px] font-medium text-ink">#{rank}</span>
      <PlayerName
        name={entry.player.full_name}
        drafted={drafted}
        onOpen={onOpenPlayer}
        className={cn('min-w-0 flex-1 truncate text-[10.5px] font-bold', drafted && 'opacity-60')}
      />
      <PlayerMeta entry={entry} />
    </div>
  )
}
