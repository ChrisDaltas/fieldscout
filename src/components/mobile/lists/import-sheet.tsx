'use client'

import * as React from 'react'

import { ListThumbnail } from '@/components/lists/list-thumbnail'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useLists, type ListPlayerWithPlayer } from '@/hooks/use-lists'
import { readList } from '@/hooks/use-mobile-lists-commit'
import { useMobileListsImportPlayers } from '@/hooks/use-mobile-lists-import-players'
import { useMyRankingBoards } from '@/hooks/use-mobile-rankings-boards'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'

import {
  importSourceOf,
  listImportOptions,
  rankingImportOptions,
  type ImportOption,
} from './import-sources'
import { importCounts, importOptionLine } from './lists-model'
import { CenterNote, InlineError } from './lists-parts'

/** What the sheet hands the editor when an option is tapped. */
export interface ImportSource {
  kind: ImportOption['kind']
  entries: ListPlayerWithPlayer[]
  sourceTiers: boolean
}

/** The tool chip, the sheet's title and the empty editor's copy: "Import a
 *  ranking" (the design), or "Import a list" while rankings are switched off
 *  (launch scope) and lists are all it can offer. */
export function importToolLabel(): string {
  return featureFlags.weeklyRanks ? 'Import a ranking' : 'Import a list'
}

/**
 * FieldScout Mobile — Import a ranking (lr-lists §2.6, state L7; gap list §3
 * #5). The design's option cards — a 34px rounded-square tile, the name, a
 * one-line sub — for the user's own rankings (one per position on each
 * board, as My rankings shows them; the tile is the user's avatar, the
 * design's "D") and their other lists (the tile is the list's cover). A tap
 * reads that list in full, hands its players to the editor's draft and
 * closes; the design's Scout AI and Experts sources come later.
 *
 * Each option says how many players it would really bring in — anyone the
 * list already holds, or outside its position group, is skipped (each player
 * appears once per list) — and one that would bring in nobody can't be
 * tapped. The header carries the design's blue "Cancel" pill (Add players
 * and Add stats carry "Done"; gap list §4 item 3).
 */
export function ImportSheet({
  open,
  onOpenChange,
  listId,
  positionFilter,
  inList,
  currentWeek,
  onImport,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The list being edited (never offered as its own source). */
  listId: string
  positionFilter: string | null
  /** The draft's players. */
  inList: ReadonlySet<string>
  currentWeek: number
  /** Apply the import to the draft; false when it brought in nobody (the
   *  sheet then stays open). */
  onImport: (source: ImportSource) => boolean
}) {
  const { profile } = useAuth()
  const rankingsOn = featureFlags.weeklyRanks
  const boards = useMyRankingBoards(open && rankingsOn)
  const lists = useLists(1, 50)
  const ownIds = React.useMemo(
    () => (lists.data?.lists ?? []).filter((list) => !list.owner && list.id !== listId && !list.is_big_board).map((list) => list.id),
    [lists.data?.lists, listId],
  )
  const players = useMobileListsImportPlayers(ownIds, open)

  const rankingOptions = React.useMemo(
    // A board opened in this editor isn't offered as its own source.
    () =>
      rankingsOn && boards.data
        ? rankingImportOptions(boards.data, currentWeek, positionFilter).filter((option) => option.listId !== listId)
        : [],
    [rankingsOn, boards.data, currentWeek, positionFilter, listId],
  )
  const listOptions = React.useMemo(
    () => (lists.data ? listImportOptions(lists.data.lists, players.data, listId) : []),
    [lists.data, players.data, listId],
  )

  // One read at a time; closing the sheet drops an answer still on its way.
  const [busy, setBusy] = React.useState<string | null>(null)
  const run = React.useRef(0)
  React.useEffect(() => {
    run.current += 1
    setBusy(null)
  }, [open])

  const choose = async (option: ImportOption) => {
    if (busy) return
    const mine = (run.current += 1)
    setBusy(option.key)
    try {
      const source = await readList(option.listId)
      if (run.current !== mine) return
      const { entries, sourceTiers } = importSourceOf(option, source.players, source.ranking_mode)
      if (onImport({ kind: option.kind, entries, sourceTiers })) onOpenChange(false)
    } catch (error) {
      if (run.current !== mine) return
      toast({
        title: option.kind === 'ranking' ? 'That ranking couldn’t be imported' : 'That list couldn’t be imported',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    } finally {
      if (run.current === mine) setBusy(null)
    }
  }

  const label = importToolLabel()
  const rankingsLoading = rankingsOn && open && boards.isPending && !boards.isError
  const listsLoading = !lists.data && !lists.isError
  const nothing =
    !rankingsLoading && !listsLoading && !boards.isError && !lists.isError && rankingOptions.length === 0 && listOptions.length === 0

  const card = (option: ImportOption) => {
    const counts = option.picks ? importCounts(option.picks, inList, positionFilter) : null
    const line = importOptionLine(counts, option.total, option.extra, positionFilter)
    const loading = busy === option.key
    return (
      <button
        key={option.key}
        type="button"
        onClick={() => void choose(option)}
        disabled={line.disabled || (busy !== null && !loading)}
        aria-busy={loading || undefined}
        className="flex w-full items-center gap-3 rounded-[14px] bg-m-b1 px-3.5 py-3 text-left active:bg-m-b2h disabled:opacity-40"
      >
        {option.kind === 'ranking' ? (
          // The design's "D" on #0088FF: the user's own avatar (photo, or
          // two letters — mobile gap ruling #8) as a rounded-square tile.
          <UserAvatar
            kind="team"
            src={profile?.avatar_url ?? null}
            name={profile?.username ?? 'You'}
            className="size-[34px] flex-none rounded-[10px]"
            fallbackClassName="bg-accent text-[11px] font-bold text-white"
          />
        ) : (
          <ListThumbnail
            positionFilter={option.list?.position_filter ?? null}
            coverColor={option.list?.cover_color ?? null}
            isTeam={option.list?.is_team ?? false}
            imageUrl={option.list?.thumbnail_url ?? null}
            players={option.list?.first_players}
            size={34}
            className="flex-none rounded-[10px]"
          />
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[14px] font-semibold text-m-t1">{option.label}</span>
          <span className="truncate text-[11px] font-medium text-m-t3">{loading ? 'Bringing in players…' : line.sub}</span>
        </span>
      </button>
    )
  }

  const skeleton = (what: string) => (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label={`Loading your ${what}`}>
      {[0, 1].map((i) => (
        <div key={i} className="h-[58px] animate-pulse rounded-[14px] bg-m-b1" />
      ))}
    </div>
  )

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={onOpenChange}
      title={label}
      subtitle="Brings in players in order, with their tiers"
      action={{ label: 'Cancel' }}
    >
      <div className="flex flex-col gap-3.5 px-4 pb-[30px]">
        {nothing ? (
          <CenterNote
            className="py-8"
            title="Nothing to import yet"
            body={rankingsOn ? 'Your rankings and your other lists show up here.' : 'Your other lists show up here.'}
          />
        ) : (
          <>
            {rankingsOn && (boards.isError || rankingsLoading || rankingOptions.length > 0) && (
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-m-t3">My rankings</h3>
                {boards.isError ? (
                  <InlineError message="Your rankings could not be loaded." onRetry={() => void boards.refetch()} />
                ) : rankingsLoading ? (
                  skeleton('rankings')
                ) : (
                  rankingOptions.map(card)
                )}
              </section>
            )}
            {(lists.isError || listsLoading || listOptions.length > 0) && (
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold text-m-t3">My lists</h3>
                {lists.isError ? (
                  <InlineError message="Your lists could not be loaded." onRetry={() => void lists.refetch()} />
                ) : listsLoading ? (
                  skeleton('lists')
                ) : (
                  <>
                    {players.isError && (
                      <InlineError
                        message="Couldn’t check who’s already in this list."
                        onRetry={() => void players.refetch()}
                      />
                    )}
                    {listOptions.map(card)}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </MobileSheet>
  )
}
