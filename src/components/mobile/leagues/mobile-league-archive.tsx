'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  ARCHIVE_CONFIRM_BUTTON,
  ARCHIVE_DONE_TOAST,
  ARCHIVE_DONE_TOAST_BODY,
  ARCHIVE_NOTE,
  ARCHIVE_TITLE,
  ARCHIVED_LOAD_FAILED,
  ARCHIVED_SECTION_NOTE,
  ARCHIVED_SECTION_TITLE,
  archiveConfirmLines,
  archivedOn,
  archiveGate,
  DANGER_ZONE_TITLE,
  RESTORE_BUTTON,
  RESTORE_CONFIRM_BODY,
  RESTORE_CONFIRM_BUTTON,
  RESTORE_DONE_TOAST,
  RESTORE_ONLY_COMMISH,
} from '@/components/leagues/league-archive-ops'
import { settingsButtonClass } from '@/components/mobile/settings/settings-parts'
import { MNotice } from '@/components/mobile/ui/m-form'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useArchiveLeague, useRestoreLeague, type LeagueDetail } from '@/hooks/use-league'
import { useArchivedLeagues, type ArchivedLeagueRow } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * The phone's League settings › Danger zone (F716 / migration 212) — the
 * same rule and words as desktop's (`league-archive-ops`): every member sees
 * the row; only the commissioner gets "Archive league" (a sheet asks
 * first); a co-commissioner or a manager reads why it isn't his; mid-draft
 * the commissioner reads why not yet.
 */
export function MobileDangerZone({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
  const gate = archiveGate({
    role: detail.my_role,
    status: detail.league.status,
    draftStatus: detail.active_draft?.status ?? null,
  })
  const [open, setOpen] = useState(false)
  const archive = useArchiveLeague()
  const router = useRouter()
  const lines = archiveConfirmLines({
    inSeason: detail.league.status === 'in_season' || detail.league.status === 'playoffs',
    draftScheduled: detail.league.status === 'scheduled' && Boolean(detail.settings.draft.draft_scheduled_at),
  })
  return (
    <section className="flex flex-col" data-settings-group="danger" data-archive-gate={gate.kind}>
      <h2 className="pb-1 pt-2.5 text-[13px] font-semibold text-m-t3">{DANGER_ZONE_TITLE}</h2>
      <div className="flex flex-col gap-1 border-b border-m-b2 py-2.5">
        {gate.kind === 'archive' ? (
          <button type="button" onClick={() => setOpen(true)} className="text-left text-[14px] font-semibold text-m-tr active:opacity-70" data-archive-open>
            {ARCHIVE_TITLE}
          </button>
        ) : (
          <span className="text-[14px] font-medium text-m-t1">{ARCHIVE_TITLE}</span>
        )}
        <span className="text-[12px] font-medium leading-[1.35] text-m-t3">{ARCHIVE_NOTE}</span>
        {gate.kind !== 'archive' && (
          <span className="text-[12px] font-semibold leading-[1.35] text-m-t2" data-archive-reason>
            {gate.reason}
          </span>
        )}
      </div>
      {gate.kind === 'archive' && (
        <MobileSheet
          open={open}
          onOpenChange={(next) => !archive.isPending && setOpen(next)}
          title={`Archive ${detail.league.name}?`}
          showClose
        >
          <div className="flex flex-col gap-3 px-5 pb-5">
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[13px] font-medium leading-[1.4] text-m-t2">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {archive.isError && <MNotice tone="error">{archive.error.message}</MNotice>}
            <button
              type="button"
              disabled={archive.isPending}
              className={cn(settingsButtonClass('quiet'), 'text-m-tr')}
              data-archive-confirm
              onClick={() =>
                archive.mutate(leagueId, {
                  onSuccess: () => {
                    setOpen(false)
                    toast({ title: ARCHIVE_DONE_TOAST, description: ARCHIVE_DONE_TOAST_BODY })
                    router.push('/app/leagues')
                  },
                })
              }
            >
              {archive.isPending ? 'Archiving…' : ARCHIVE_CONFIRM_BUTTON}
            </button>
          </div>
        </MobileSheet>
      )}
    </section>
  )
}

/**
 * Leagues › Archived leagues on the phone (F716): the same read and rules as
 * desktop's section — read-only rows; Restore (behind a sheet) for the
 * commissioner; nothing when there is none; a failed read says so.
 */
export function MobileArchivedLeagues() {
  const archived = useArchivedLeagues()
  if (archived.isPending) return null
  if (archived.isError && !archived.data) {
    return (
      <section className="mt-5 flex flex-col gap-2" data-archived-leagues="error">
        <h2 className="text-[13px] font-semibold text-m-t3">{ARCHIVED_SECTION_TITLE}</h2>
        <MNotice tone="error" action={{ label: 'Try again', onClick: () => void archived.refetch() }}>
          {ARCHIVED_LOAD_FAILED}
        </MNotice>
      </section>
    )
  }
  const rows = archived.data ?? []
  if (rows.length === 0) return null
  return (
    <section className="mt-5 flex flex-col" data-archived-leagues="shown">
      <h2 className="text-[13px] font-semibold text-m-t3">{ARCHIVED_SECTION_TITLE}</h2>
      <p className="pb-1 text-[12px] font-medium leading-[1.35] text-m-t3">{ARCHIVED_SECTION_NOTE}</p>
      <ul className="flex flex-col" aria-label={ARCHIVED_SECTION_TITLE}>
        {rows.map((row) => (
          <MobileArchivedRow key={row.id} row={row} />
        ))}
      </ul>
    </section>
  )
}

function MobileArchivedRow({ row }: { row: ArchivedLeagueRow }) {
  const [open, setOpen] = useState(false)
  const restore = useRestoreLeague()
  const isCommish = row.my_role === 'commissioner'
  return (
    <li className="flex min-h-[52px] items-center gap-3 border-b border-m-b2 py-2.5" data-archived-league={row.id}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold text-m-t1">{row.name}</span>
        <span className="text-[12px] font-medium text-m-t3">
          {row.season} season · {archivedOn(row.archived_at)}
          {!isCommish && <> · {RESTORE_ONLY_COMMISH}</>}
        </span>
      </span>
      {isCommish && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 flex-none items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h"
          data-restore-open
        >
          {RESTORE_BUTTON}
        </button>
      )}
      {isCommish && (
        <MobileSheet open={open} onOpenChange={(next) => !restore.isPending && setOpen(next)} title={`Restore ${row.name}?`} showClose>
          <div className="flex flex-col gap-3 px-5 pb-5">
            <p className="text-[13px] font-medium leading-[1.4] text-m-t2">{RESTORE_CONFIRM_BODY}</p>
            {restore.isError && <MNotice tone="error">{restore.error.message}</MNotice>}
            <button
              type="button"
              disabled={restore.isPending}
              className={settingsButtonClass('primary', !restore.isPending)}
              data-restore-confirm
              onClick={() =>
                restore.mutate(row.id, {
                  onSuccess: () => {
                    setOpen(false)
                    toast({ title: RESTORE_DONE_TOAST, description: row.name })
                  },
                })
              }
            >
              {restore.isPending ? 'Restoring…' : RESTORE_CONFIRM_BUTTON}
            </button>
          </div>
        </MobileSheet>
      )}
    </li>
  )
}
