'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageHeader } from '@/components/layout/app-header'
import { BoardStage } from '@/components/lists/draft-mode/board-stage'
import { SelectStage } from '@/components/lists/draft-mode/select-stage'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useLists } from '@/hooks/use-lists'

import type { ListWithTags } from '@/hooks/use-lists'

const SELECTION_KEY = 'fieldscout.draft-board.selection'

type Stage = 'select' | 'board'

/**
 * Draft mode — two stages in one route. Stage 1 picks which lists go on the
 * board; stage 2 shows them side by side with tap-to-mark rows. The pick and
 * stage persist to localStorage so a refresh mid-draft lands back on the
 * board; row marks persist per list set (see use-board-marks).
 */
export function DraftModeView() {
  const searchParams = useSearchParams()
  const folderId = searchParams.get('folder')

  const { data, isLoading } = useLists(1, 100)
  const lists = useMemo(() => data?.lists ?? [], [data])
  const shown = useMemo(
    () => (folderId ? lists.filter((l) => l.folder_id === folderId) : lists),
    [lists, folderId],
  )

  const [stage, setStage] = useState<Stage>('select')
  const [picked, setPicked] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  // Restore the previous pick (and stage, when it still qualifies).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SELECTION_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { picked?: unknown; stage?: unknown }
        if (
          Array.isArray(parsed.picked) &&
          parsed.picked.every((x): x is string => typeof x === 'string')
        ) {
          setPicked(parsed.picked)
          if (parsed.stage === 'board' && parsed.picked.length >= 2) {
            setStage('board')
          }
        }
      }
    } catch {
      // ignore
    }
    setHydrated(true)
  }, [])

  // Drop deleted lists from the stored pick once data lands.
  useEffect(() => {
    if (!hydrated || isLoading) return
    const valid = new Set(lists.map((l) => l.id))
    setPicked((cur) => {
      const cleaned = cur.filter((id) => valid.has(id))
      return cleaned.length === cur.length ? cur : cleaned
    })
  }, [hydrated, isLoading, lists])

  // Persist pick + stage.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(
        SELECTION_KEY,
        JSON.stringify({ picked, stage }),
      )
    } catch {
      // ignore quota errors
    }
  }, [picked, stage, hydrated])

  // The board needs at least 2 lists.
  useEffect(() => {
    if (hydrated && stage === 'board' && picked.length < 2) {
      setStage('select')
    }
  }, [hydrated, stage, picked.length])

  const togglePick = useCallback((id: string) => {
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    )
  }, [])

  const pickAll = useCallback(() => {
    setPicked(shown.map((l) => l.id))
  }, [shown])

  const pickedLists = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]))
    return picked
      .map((id) => byId.get(id))
      .filter((l): l is ListWithTags => Boolean(l))
  }, [picked, lists])

  return (
    <div>
      <PageHeader
        title={
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon-sm" aria-label="Back to lists">
              <Link href="/app/lists">
                <Icon name="arrow-prev" size={14} />
              </Link>
            </Button>
            <h3 className="shrink-0 text-h5">Draft mode</h3>
            {stage === 'board' && (
              <span className="hidden truncate text-[11px] font-semibold text-n-3 md:inline">
                Tap a player to mark him — once for marine, twice for green, a
                third tap clears.
              </span>
            )}
          </div>
        }
        actions={
          stage === 'board' ? (
            <Button
              size="sm"
              variant="stroke"
              onClick={() => setStage('select')}
            >
              <Icon name="filters" size={13} />
              Edit selection
            </Button>
          ) : undefined
        }
      />

      {stage === 'select' ? (
        <SelectStage
          lists={shown}
          isLoading={isLoading || !hydrated}
          inFolder={Boolean(folderId)}
          picked={picked}
          onTogglePick={togglePick}
          onPickAll={pickAll}
          onStart={() => setStage('board')}
        />
      ) : (
        <BoardStage lists={pickedLists} isLoading={isLoading} />
      )}
    </div>
  )
}
