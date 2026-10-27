'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { useArchiveLeague, useRestoreLeague, type LeagueDetail } from '@/hooks/use-league'
import { useArchivedLeagues, type ArchivedLeagueRow } from '@/hooks/use-leagues'
import { toast } from '@/hooks/use-toast'

import { Crest } from './league-cells'
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
} from './league-archive-ops'

/**
 * League settings › Danger zone (F716 — Chris 2026-10-27: leagues are
 * archived, never deleted; the commissioner can restore). Every member sees
 * the card; only the league's commissioner gets the button — a
 * co-commissioner or a manager reads the reason instead (prevent, don't
 * refuse), and a commissioner mid-draft sees the button disabled with its
 * reason. Archive asks first, then sends him to the Leagues page, where the
 * league now sits under Archived leagues.
 */
export function LeagueDangerZone({ leagueId, detail }: { leagueId: string; detail: LeagueDetail }) {
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
    <section className="flex flex-col gap-2" data-danger-zone data-archive-gate={gate.kind}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-n-6">{DANGER_ZONE_TITLE}</h2>
      <Card className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
        <span className="mr-auto flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-bold leading-tight tracking-[-0.01em] text-ink">{ARCHIVE_TITLE}</span>
          <span className="text-[11px] font-medium text-n-6">{ARCHIVE_NOTE}</span>
          {gate.kind !== 'archive' && (
            <span className="text-[11px] font-semibold text-ink" data-archive-reason>
              {gate.reason}
            </span>
          )}
        </span>
        {gate.kind !== 'not_commissioner' && (
          <Button
            variant="destructive"
            size="sm"
            className="shrink-0 self-start sm:self-center"
            disabled={gate.kind === 'blocked' || archive.isPending}
            onClick={() => setOpen(true)}
            data-archive-open
          >
            <Icon name="folder" size={13} />
            {ARCHIVE_TITLE}
          </Button>
        )}
      </Card>

      <Dialog open={open} onOpenChange={(next) => !archive.isPending && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{`Archive ${detail.league.name}?`}</DialogTitle>
            <DialogDescription asChild>
              <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[11px] font-medium text-n-6">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </DialogDescription>
          </DialogHeader>
          {archive.isError && (
            <p role="alert" className="rounded-message bg-negative-soft px-3 py-2 text-[11px] font-semibold text-negative-strong">
              {archive.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" disabled={archive.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={archive.isPending}
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
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

/**
 * Leagues › Archived leagues (F716): the leagues you are in that their
 * commissioner archived, so nobody wonders where a league went. Read-only —
 * a league's pages are closed while it is archived. Its commissioner restores
 * it from here; everyone else reads that only the commissioner can. Nothing
 * at all renders while there is none; a failed read says so.
 */
export function ArchivedLeaguesSection() {
  const archived = useArchivedLeagues()
  if (archived.isPending) return null
  if (archived.isError && !archived.data) {
    return (
      <section className="flex flex-col gap-2" data-archived-leagues="error">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-n-6">{ARCHIVED_SECTION_TITLE}</h2>
        <div role="alert" className="flex items-center gap-2.5 rounded-message bg-negative-soft px-3 py-2">
          <span className="mr-auto text-[11px] font-semibold text-ink">{ARCHIVED_LOAD_FAILED}</span>
          <Button variant="stroke" size="sm" onClick={() => void archived.refetch()}>
            <Icon name="reset" size={13} /> Retry
          </Button>
        </div>
      </section>
    )
  }
  const rows = archived.data ?? []
  if (rows.length === 0) return null
  return (
    <section className="flex flex-col gap-2" data-archived-leagues="shown">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.04em] text-n-6">{ARCHIVED_SECTION_TITLE}</h2>
        <p className="text-[10px] font-medium text-n-6">{ARCHIVED_SECTION_NOTE}</p>
      </div>
      <Card className="flex flex-col">
        {rows.map((row) => (
          <ArchivedLeagueRowView key={row.id} row={row} />
        ))}
      </Card>
    </section>
  )
}

function ArchivedLeagueRowView({ row }: { row: ArchivedLeagueRow }) {
  const [open, setOpen] = useState(false)
  const restore = useRestoreLeague()
  const isCommish = row.my_role === 'commissioner'
  return (
    <div
      className="flex min-h-[52px] items-center gap-2.5 border-t border-n-4 px-4 py-2.5 first:border-t-0"
      data-archived-league={row.id}
    >
      <Crest name={row.name} className="h-[27px] w-[27px] opacity-60" />
      <span className="mr-auto flex min-w-0 flex-col gap-px">
        <span className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em] text-ink">{row.name}</span>
        <span className="truncate text-[10px] font-medium text-n-6">
          <span className="fs-num">{row.season}</span> season · {archivedOn(row.archived_at)}
          {!isCommish && <> · {RESTORE_ONLY_COMMISH}</>}
        </span>
      </span>
      {isCommish && (
        <Button variant="stroke" size="sm" onClick={() => setOpen(true)} disabled={restore.isPending} data-restore-open>
          <Icon name="reset" size={13} />
          {RESTORE_BUTTON}
        </Button>
      )}
      {isCommish && (
        <Dialog open={open} onOpenChange={(next) => !restore.isPending && setOpen(next)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{`Restore ${row.name}?`}</DialogTitle>
              <DialogDescription>{RESTORE_CONFIRM_BODY}</DialogDescription>
            </DialogHeader>
            {restore.isError && (
              <p role="alert" className="rounded-message bg-negative-soft px-3 py-2 text-[11px] font-semibold text-negative-strong">
                {restore.error.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" disabled={restore.isPending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="blue"
                size="sm"
                disabled={restore.isPending}
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
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
