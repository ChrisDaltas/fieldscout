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
import { useListWindowsStore } from '@/stores/list-windows-store'
import { usePlayerWindowsStore } from '@/stores/player-windows-store'

import { ListCoverTile } from './cover-tile'
import {
  useDraftedFanOut,
  useRegisterFanOutColumn,
  type ColumnMembership,
  type DraftedFanOut,
} from './drafted-fan-out'
import { bucketHeading, buildBuckets, ORG_OPTIONS, rankMap } from './list-buckets'
import {
  DraftedCheckbox,
  EmptyListState,
  ListReadFailure,
  ListRowsSkeleton,
  PlayerMeta,
  PlayerName,
} from './list-row-parts'

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
 * | the failed / loading states | `list-row-parts.tsx` (`ListReadFailure`, `ListRowsSkeleton`) — shared with the pop-out window at LV.17, rather than a second spelling of the same three sentences. The column's **sub-line** is unchanged from LV.13 (`Could not load`): R248 restored it after LV.17 briefly re-worded a merged surface |
 * | `Pop out into a window` | `list-windows-store.ts` (LV.15), the same `open` the detail hero calls |
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
 * ## What a tick does here — the fan-out (LV.14, **D12**)
 *
 * **One tick writes across every column in the comparison that contains the
 * player, and no further.** The comparison set *is* the draft: a tick writes one
 * `list_player_drafted` row per list on screen that holds him, keyed
 * `(user_id, list_id, player_id)` through LV.1.2's route, and a list you did not
 * pick is untouched however many of your lists he is on. That is Chris's
 * 2026-08-10 ruling (*"per user, per list… players will have multiple lists for
 * multiple leagues"*) and the handoff's global `toggleDrafted` reconciled, not
 * one of them ignored.
 *
 * The mechanism is `drafted-fan-out.ts`, and it is deliberately not in this
 * file: each column keeps its own `useDraftMode(listId)` — its own optimistic
 * write, its own rollback, its own invalidation — and merely **registers**
 * itself, so a write refused on one column rolls that column back and leaves the
 * other four alone. The failure model (a column still loading, a column that
 * failed to load, a partial write) is stated in that module's header.
 *
 * The header's live `N of M left` is derived **per column from that column's own
 * rows**, which is the count D12 asks for — it stays correct under a whole
 * fan-out and a partial one alike, because it never counts anything but this
 * column's own marks.
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
  // The comparison set *is* the draft (D12). It is held here, beside the column
  // order it fans out over, and nowhere else — there is no app-level version of
  // this, because there is no app-level version of "drafted".
  const fanOut = useDraftedFanOut(ids)

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
          fanOut={fanOut}
        />
      ))}
    </div>
  )
}

function ComparisonColumn({
  listId,
  summary,
  onRemove,
  fanOut,
}: {
  listId: string
  summary: ListWithTags | undefined
  onRemove: () => void
  fanOut: DraftedFanOut
}) {
  const detail = useList(listId)
  const display = useListDisplay(listId)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const { drafted, desiredDraftedFor, setDrafted } = useDraftMode(listId)
  const openPlayerWindow = usePlayerWindowsStore((state) => state.open)
  const popOut = useListWindowsStore((state) => state.open)

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
   * Who this column can vouch for. `null` while the rows are unknown — the
   * fan-out must not read "no rows yet" as "he is not on this list" (D12
   * consequence 2 is about a player genuinely absent, not about a request that
   * has not answered).
   */
  const memberIds = React.useMemo(
    () => (entries ? new Set(entries.map((entry) => entry.player_id)) : null),
    [entries],
  )

  /**
   * Join the comparison's fan-out (**D12**). This column contributes what only
   * it knows — its name, who is on it, what a tap here would ask for, and how to
   * write it — and keeps every mechanism: the write is still this column's own
   * `useDraftMode(listId)`, so the optimistic strike, the rollback and the
   * invalidation are all per column by construction.
   */
  useRegisterFanOutColumn(fanOut, listId, {
    title,
    membership: (playerId): ColumnMembership =>
      detail.isError
        ? 'unreadable'
        : !memberIds
          ? 'loading'
          : memberIds.has(playerId)
            ? 'in'
            : 'out',
    desiredFor: desiredDraftedFor,
    // `notify: false` — the gesture gets ONE report, from the fan-out, naming
    // every column that failed. Per-column toasts would be N−1 invisible ones
    // (`use-toast.ts` sets `TOAST_LIMIT = 1`) and the survivor would name none.
    // The rollback is not part of the deal: it happens either way.
    write: (playerId, next) => setDrafted(playerId, next, { notify: false }),
  })

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
  // **Restored to the merged surface's own wording (R248).** LV.17 briefly split
  // this into `Deleted` / `Could not load` on the read's 404 — but a 404 is not
  // a deletion (see `listReadIsGone`), and re-wording a shipped surface was not
  // this task's to do even where the word had been true. `Could not load` claims
  // nothing about cause and is what a column has always said.
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
            {/* Pop out (LV.17). The window is hosted by the app shell, so it
                floats *over* this comparison and outlives it — which is the
                point: you can leave the compare screen with one board still on
                top. The column is deliberately **not** removed. Popping out is
                not "take this out of the comparison"; the comparison set is
                what a tick fans out over (D12), so silently shrinking it here
                would change what the next tick writes. Two surfaces showing one
                list is already the ordinary case — the panel and a column do
                it — and they agree because both read one `useDraftMode(listId)`
                cache and one `list-display-store` entry. */}
            <DropdownMenuItem onSelect={() => popOut(listId)}>
              <Icon name="arrow-up-right" size={13} />
              Pop out into a window
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRemove}>
              <Icon name="close" size={13} />
              Remove column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {detail.isError ? (
        // Shared with the pop-out window (LV.17) — including the split between
        // *unavailable* (a 404: gone, or no longer visible to you) and *could
        // not be loaded* (a fault worth retrying). A column needs that split for
        // the same reason a window did: a comparison routinely holds someone
        // else's list, and it can stop being readable while you are looking at
        // it. **Neither branch names a cause** — R248.
        <ListReadFailure error={detail.error} canEdit={canEdit} />
      ) : !entries ? (
        <ListRowsSkeleton rowHeight={30} />
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
                  onToggleDrafted={() =>
                    fanOut.tick(listId, entry.player_id, entry.player.full_name)
                  }
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
          The tick fans out across the comparison set and no further (LV.14,
          D12): every column on screen that holds this player, none that does
          not, and no list you did not pick. See `drafted-fan-out.ts`. */}
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
