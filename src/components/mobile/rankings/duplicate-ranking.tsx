'use client'

import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import {
  hasRankingAt,
  myRankingEditorHref,
  REPLACE_DETAIL,
  replaceQuestion,
  type RankingDuplicate,
} from '@/components/mobile/rankings/duplicate-ops'
import { RkIcon, RK_ICON } from '@/components/mobile/rankings/rank-parts'
import type { RankPos, RankType } from '@/components/mobile/rankings/rankings-ops'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useAuth } from '@/hooks/use-auth'
import { useDuplicateRanking } from '@/hooks/use-duplicate-ranking'
import { useMyRankingBoards } from '@/hooks/use-mobile-rankings-boards'

/**
 * The phone's Duplicate on a ranking that isn't yours (Chris, 2026-10-18/19:
 * "If a user dupes some popular ranking it then becomes their own") — an AI
 * expert's ranking in Rankings, a ranking's Community detail, and a saved
 * ranking's List options. It publishes the ranking as yours
 * (`useDuplicateRanking`) and then opens yours in the editor — Rankings ›
 * Mine, that period and position — to tweak.
 *
 * Over a ranking you already have it asks first ("Replace your Week 7 RB
 * ranking with this one?"); it never silently overwrites. Signed out, it goes
 * to sign in.
 */
export interface DuplicateRankingFlow {
  start: () => void
  pending: boolean
  /** The "Replace …?" sheet — render it once, where it stays mounted while
   *  the Duplicate runs (null when there is nothing to duplicate). */
  sheet: ReactNode
}

export function useDuplicateRankingFlow({
  sourceListId,
  dup,
  positions,
  currentWeek,
  onOpenMine,
}: {
  sourceListId: string
  /** null: not a ranking someone else made — nothing to do (the caller keeps
   *  the list Duplicate). */
  dup: RankingDuplicate | null
  /** What it copies: the position shown, or every one the ranking ranks. */
  positions: readonly RankPos[]
  currentWeek: number
  /** Open your ranking in place (Rankings opens its editor over the hub);
   *  without it, the editor's own URL is pushed. */
  onOpenMine?: (type: RankType, pos: RankPos) => void
}): DuplicateRankingFlow {
  const router = useRouter()
  const { user } = useAuth()
  const boards = useMyRankingBoards(dup !== null)
  const duplicate = useDuplicateRanking()
  const [asking, setAsking] = useState(false)

  const run = (target: RankingDuplicate) =>
    duplicate.mutate(
      { sourceListId, week: target.week, positions },
      {
        onSuccess: (res) => {
          if (onOpenMine) onOpenMine(target.type, res.openAt)
          else router.push(myRankingEditorHref(target.type, res.openAt))
        },
      },
    )

  const start = () => {
    if (!user) {
      router.push('/login')
      return
    }
    if (!dup || dup.blocked || duplicate.isPending || positions.length === 0) return
    // Until your boards are read, assume there's one to replace: asking is
    // never wrong, overwriting without asking would be.
    if (!boards.data || hasRankingAt(boards.data, dup.week, positions)) setAsking(true)
    else run(dup)
  }

  const sheet = dup && (
    <MobileSheet
      open={asking}
      onOpenChange={setAsking}
      title={replaceQuestion(dup.type, positions, currentWeek)}
      subtitle={REPLACE_DETAIL}
      footer={
        <div className="flex flex-col gap-2 px-4 pb-[30px] pt-1">
          <button
            type="button"
            onClick={() => {
              setAsking(false)
              run(dup)
            }}
            className="flex h-12 items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => setAsking(false)}
            className="flex h-12 items-center justify-center rounded-[14px] bg-m-b2 text-[15px] font-semibold text-m-t1"
          >
            Cancel
          </button>
        </div>
      }
    >
      <span className="sr-only">Choose whether to replace your ranking with this one.</span>
    </MobileSheet>
  )

  return { start, pending: duplicate.isPending, sheet }
}

/** The Duplicate button on a ranking you're reading (Rankings' AI expert
 *  card, the Community detail): disabled, with the reason, when its week
 *  can't be ranked now. */
export function DuplicateRankingButton({ flow, blocked }: { flow: DuplicateRankingFlow; blocked: string | null }) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={flow.start}
        disabled={blocked !== null || flow.pending}
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-[12px] bg-m-b0 text-[13px] font-semibold text-m-t1 shadow-m-outline disabled:text-m-t4"
      >
        <RkIcon d={RK_ICON.copy} size={13} stroke={1.8} />
        {flow.pending ? 'Duplicating…' : 'Duplicate'}
      </button>
      {blocked && <span className="text-center text-[11px] font-medium text-m-t3">{blocked}</span>}
      {flow.sheet}
    </div>
  )
}
