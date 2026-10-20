'use client'

import Link from 'next/link'

import { leagueMockRoomHref, mockRoomHref } from '@/components/draft/mock-launcher-entry'
import { mockIdentityLabel, mockProgressLabel } from '@/components/draft/mock-launcher-ops'
import { useDeleteMockDraft, type MockDraftSummary } from '@/hooks/use-mock-drafts'
import type { RoomEntryTargetProps } from '@/hooks/use-room-entry-target-ops'
import { toast } from '@/hooks/use-toast'
import { LeagueActionError } from '@/lib/leagues/api/client-fetch'
import { cn } from '@/lib/utils'

import { mockFinishedLabel } from './mocks-ops'

/**
 * One practice draft on the phone — the desktop `MockRow` in the mobile
 * language: its status chip (Live / Paused / Report), what it was ("Snake ·
 * 8 teams"), its progress or the day it finished, and its two controls —
 * Rejoin / Resume (into the room) or View report, and Delete. Drawn on a b1
 * card; the rows rule off with b3 hairlines.
 *
 * Two mounts: the League tab's pre-draft "Your practice drafts" (a league's
 * own mocks) and the phone's practice home, `/app/mocks` (every mock you
 * launched, gap list §4 item 110). So the row is league-optional, as
 * `MockRow` is: `leagueId` null is a STANDALONE practice draft, whose room
 * is `/app/mocks/[id]`; a league mock's room stays on its league's draft
 * route. Every finished mock's report is `/app/mocks/[id]/report` (D230(4)).
 *
 * `openBlocked` is the mount's reason the open control can't be used yet
 * (a flag the PAGE reads — never the row): the control is drawn off, with
 * the reason under the row. `roomEntry` is the mount's room-entry split
 * (`useRoomEntryTarget`), spread on the Rejoin / Resume link only.
 */

const PILL = 'flex h-8 flex-none items-center gap-1.5 rounded-pill px-3.5 text-[13px] font-semibold'
const NOTE = 'text-[12px] font-medium leading-[1.35] text-m-t3'

function messageOf(cause: unknown): string {
  if (cause instanceof LeagueActionError) return cause.message
  if (cause instanceof Error) return cause.message
  return 'Something went wrong. Please try again.'
}

export function PracticeRow({
  leagueId,
  row,
  seatCount,
  openBlocked,
  roomEntry,
}: {
  /** The mock's league, or null for a standalone practice draft. */
  leagueId: string | null
  row: MockDraftSummary
  seatCount: number | null
  /** Why it can't be opened yet, or null. */
  openBlocked: string | null
  roomEntry: RoomEntryTargetProps
}) {
  const deleteMock = useDeleteMockDraft(leagueId)
  const complete = row.status === 'complete'
  const openLabel = complete ? 'View report' : row.status === 'paused' ? 'Resume' : 'Rejoin'
  const roomHref = leagueId === null ? mockRoomHref(row.id) : leagueMockRoomHref(leagueId, row.id)
  const status = complete
    ? { label: 'Report', cls: 'bg-m-b2 text-m-t3' }
    : row.status === 'paused'
      ? { label: 'Paused', cls: 'bg-m-go text-m-to' }
      : { label: 'Live', cls: 'bg-m-gg text-m-tg' }
  const progress = complete ? mockFinishedLabel(row.completed_at) : mockProgressLabel(row, seatCount)
  const remove = () => {
    deleteMock.mutateAsync(row.id).catch((error: unknown) => {
      toast({
        title: complete ? 'Couldn’t delete the report' : 'Couldn’t delete the practice draft',
        description: messageOf(error),
        variant: 'destructive',
      })
    })
  }
  return (
    <div className="flex flex-col gap-2.5 border-b border-m-b3 py-3 last:border-b-0" data-practice-row={row.id}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn('flex h-[20px] flex-none items-center rounded-pill px-2 text-[11px] font-semibold', status.cls)}>{status.label}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-m-t1">{mockIdentityLabel(row, seatCount)}</span>
      </div>
      <p className={NOTE}>{progress}</p>
      {openBlocked && (
        <p className={NOTE} role="status">
          {openBlocked}
        </p>
      )}
      <div className="flex items-center gap-2">
        {openBlocked ? (
          <span className={cn(PILL, 'bg-m-b0 text-m-t4')} aria-disabled="true">
            {openLabel}
          </span>
        ) : complete ? (
          <Link href={`/app/mocks/${row.id}/report`} className={cn(PILL, 'bg-m-b0 text-m-t1 active:bg-m-b2')}>
            {openLabel}
          </Link>
        ) : (
          <Link href={roomHref} {...roomEntry} className={cn(PILL, 'bg-accent text-white active:bg-accent-strong')}>
            {openLabel}
          </Link>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={deleteMock.isPending}
          aria-label={complete ? 'Delete report' : 'Delete practice draft'}
          className={cn(PILL, 'bg-m-gr text-m-tr disabled:opacity-50')}
        >
          {deleteMock.isPending ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
