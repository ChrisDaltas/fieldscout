'use client'

import { useMemo } from 'react'

import { BoardColumn } from '@/components/lists/draft-mode/board-column'
import { useBoardMarks } from '@/components/lists/draft-mode/use-board-marks'
import { Skeleton } from '@/components/ui/skeleton'

import type { ListWithTags } from '@/hooks/use-lists'

interface BoardStageProps {
  /** Picked lists in pick order — one column each. */
  lists: ListWithTags[]
  isLoading: boolean
}

/** Stage 2 — the side-by-side draft board. */
export function BoardStage({ lists, isLoading }: BoardStageProps) {
  const listIds = useMemo(() => lists.map((l) => l.id), [lists])
  const { markOf, cycle } = useBoardMarks(listIds)

  if (isLoading && lists.length === 0) {
    return (
      <div className="flex items-start gap-4 overflow-x-auto pb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-96 min-w-[240px] flex-[1_0_240px]" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-4 overflow-x-auto pb-4">
      {lists.map((list) => (
        <BoardColumn
          key={list.id}
          list={list}
          markOf={markOf}
          onCycle={cycle}
        />
      ))}
    </div>
  )
}
