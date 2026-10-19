'use client'

import { useRouter } from 'next/navigation'

import {
  duplicateQuestion,
  hasRankingAt,
  myRankingDesktopHref,
  rankedPositions,
  replaceQuestion,
  type RankingDuplicate,
} from '@/components/mobile/rankings/duplicate-ops'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDuplicateRanking } from '@/hooks/use-duplicate-ranking'
import { useList } from '@/hooks/use-lists'
import { useMyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

/** A ranking someone else made, picked for Duplicate. */
export interface RankingDuplicateTarget {
  listId: string
  dup: RankingDuplicate
}

/**
 * Desktop's Duplicate on a ranking that isn't yours (Chris, 2026-10-18/19:
 * "If a user dupes some popular ranking it then becomes their own") — a
 * saved ranking's card menu and its open panel in Lists. Not a list copy: it
 * publishes the ranking as YOUR ranking for the same period, at every
 * position it ranks (`useDuplicateRanking` — the requests the ranking
 * publish makes), then opens yours: the Rankings page's Pre-draft tab, or
 * that week's board.
 *
 * Desktop always asks first — "Replace your Week 7 RB and WR rankings with
 * this one?" over rankings you have, "Duplicate this as your …?" otherwise —
 * since the menu item can't show what it would write. The positions come
 * from the ranking's own read (the panel's cache; a card fetches it here).
 */
export function RankingDuplicateDialog({
  target,
  currentWeek,
  onClose,
}: {
  target: RankingDuplicateTarget | null
  currentWeek: number
  onClose: () => void
}) {
  const router = useRouter()
  const source = useList(target?.listId)
  const boards = useMyRankingBoards(target !== null)
  const duplicate = useDuplicateRanking()

  const positions = source.data ? rankedPositions(source.data.players) : []
  const ready = target !== null && source.data !== undefined && boards.data !== undefined
  // Your boards unread: treat it as a replace — asking that is never wrong.
  const replacing = target !== null && (!boards.data || hasRankingAt(boards.data, target.dup.week, positions))
  const empty = ready && positions.length === 0
  const question = !target
    ? ''
    : !ready
      ? 'Duplicate this ranking?'
      : empty
        ? 'This ranking has no players to copy'
        : replacing
          ? replaceQuestion(target.dup.type, positions, currentWeek)
          : duplicateQuestion(target.dup.type, positions, currentWeek)

  const confirm = () => {
    if (!target || !ready || empty || duplicate.isPending) return
    duplicate.mutate(
      { sourceListId: target.listId, week: target.dup.week, positions },
      {
        onSuccess: () => {
          onClose()
          router.push(myRankingDesktopHref(target.dup.week))
        },
      },
    )
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !duplicate.isPending && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{question}</DialogTitle>
          <DialogDescription>
            {source.isError
              ? 'Couldn’t load this ranking.'
              : replacing
                ? 'Its order replaces yours at those positions. It becomes your ranking — you can edit it after.'
                : 'It becomes your ranking — you can edit it after.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="stroke" onClick={onClose} disabled={duplicate.isPending}>
            Cancel
          </Button>
          <Button type="button" variant="blue" onClick={confirm} disabled={!ready || empty || duplicate.isPending}>
            {duplicate.isPending ? 'Duplicating…' : replacing ? 'Replace' : 'Duplicate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
