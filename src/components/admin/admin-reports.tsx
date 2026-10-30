'use client'

import Link from 'next/link'
import { useState } from 'react'

import { DeleteCommentDialog, type CommentConfirmCopy } from '@/components/lists/v2/delete-comment-dialog'
import { inAppListHref } from '@/components/mobile/community/community-ops'
import { UsernameLink } from '@/components/shared/username-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useAdminReportAction, type AdminReportActionAnswer } from '@/hooks/use-admin-report-action'
import { useAdminReports } from '@/hooks/use-admin-reports'
import { toast } from '@/hooks/use-toast'
import { AdminApiError } from '@/lib/admin/admin-api'
import {
  REPORTS_UNAVAILABLE,
  type AdminReport,
  type AdminReportKind,
  type AdminReportListState,
  type AdminReportReason,
  type AdminReportsPayload,
} from '@/lib/admin/content-reports'
import { featureFlags } from '@/lib/feature-flags'

import { AdminEmpty, AdminError, AdminHeader, AdminLoading, AdminSection, when } from './admin-parts'

/**
 * `/app/admin/reports` — Admin › Reports (Community launch plan C10;
 * readiness S3). Every report, newest first: what was reported (with Open),
 * who wrote it, who reported it (usernames are links), the reason and note,
 * and when. Each open report has **Mark reviewed** (214's
 * `mark_content_report_reviewed`); a reported comment that's still up also
 * has **Remove** — C2's operator permission (`remove_list_comment`), which
 * also marks every open report on it reviewed by you. Remove asks first, and
 * is the soft red tint, never a bright red fill.
 *
 * Lists, tags, bios, avatars and AI boards are taken down by hand
 * (`docs/runbooks/community-takedowns.md`). Desktop: the phone has no Admin
 * screen. Before migration 214 is pushed the page says reports aren't
 * available yet — never a fake "no reports".
 */
export function AdminReports() {
  const q = useAdminReports({ enabled: featureFlags.community })
  const unavailable = q.error instanceof AdminApiError && q.error.status === 503

  return (
    <div className="flex max-w-3xl flex-col gap-5" data-admin-page="reports">
      <AdminHeader title="Admin" subtitle="Reports" />
      <p className="text-[11px] font-medium leading-[1.5] text-n-3">
        What people reported on Community, newest first. Mark a report reviewed once you’ve dealt with it. Lists, tags,
        bios and profile pictures are taken down by hand — the takedown runbook says how.
      </p>
      {q.isLoading && <AdminLoading rows={4} label="reports" />}
      {unavailable ? (
        <ReportsUnavailable />
      ) : (
        q.error && <AdminError error={q.error} onRetry={() => q.refetch()} what="reports" />
      )}
      {q.data && <AdminReportsBody payload={q.data} />}
    </div>
  )
}

/** Before migration 214 is pushed: says so, in a plain notice. */
export function ReportsUnavailable() {
  return (
    <p className="rounded-message bg-surface-sunken px-3 py-2.5 text-[11px] font-medium text-n-3" data-reports-unavailable>
      {REPORTS_UNAVAILABLE}
    </p>
  )
}

const KIND_LABEL: Record<AdminReportKind, string> = {
  list: 'List',
  comment: 'Comment',
  start_sit: 'Start/sit question',
}

const REASON_LABEL: Record<AdminReportReason, string> = {
  spam: 'Spam',
  abusive: 'Abusive',
  other: 'Something else',
}

const LIST_STATE_LABEL: Record<Exclude<AdminReportListState, 'live'>, string> = {
  private: 'Made private',
  deleted: 'Deleted',
  missing: 'No longer there',
}

/**
 * Remove's confirm, in the comment row's own Delete dialog (C1): the comment
 * quoted, what happens, Cancel, and Remove in the soft red tint — never a
 * bright red fill.
 */
export const REMOVE_COMMENT: CommentConfirmCopy = {
  title: 'Remove this comment?',
  body: 'It comes off the list for everyone, and every open report on it is marked reviewed by you. You can’t undo this.',
  cancel: 'Cancel',
  confirm: 'Remove',
  busyLabel: 'Removing…',
}

/** "1 new report" / "3 new reports". */
export function newReportsWords(n: number): string {
  return `${n} new ${n === 1 ? 'report' : 'reports'}`
}

/**
 * Where Open goes: the list inside the app — Community's list page, or your
 * own Lists for a list of yours (`inAppListHref`); a reported comment opens
 * its list. Nowhere when the list is deleted or gone, or private and not
 * yours (nobody else can open it).
 */
export function reportOpenHref(report: Pick<AdminReport, 'list'>): string | null {
  const list = report.list
  if (!list) return null
  if (list.state === 'live' || (list.state === 'private' && list.own)) {
    return inAppListHref(list.id, featureFlags.community, { own: list.own })
  }
  return null
}

/** Presentational — exported for the render tests. */
export function AdminReportsBody({ payload }: { payload: AdminReportsPayload }) {
  const action = useAdminReportAction()
  // The report whose comment Remove is confirming, and whether its confirm is
  // open — kept apart so the quote stays put while the dialog closes.
  const [removing, setRemoving] = useState<AdminReport | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  const act = (report: AdminReport, kind: 'review' | 'remove') =>
    action.mutate(
      { reportId: report.id, action: kind },
      {
        onSuccess: (answer) => {
          if (kind === 'remove') setRemoveOpen(false)
          toast(actionToast(kind, answer))
        },
        onError: (error) =>
          toast({
            title: kind === 'review' ? 'Couldn’t mark that report reviewed' : 'Couldn’t remove that comment',
            description: error.message,
            variant: 'destructive',
          }),
      },
    )

  return (
    <AdminSection
      title="Reports"
      hint={
        <>
          <span className="fs-num">{newReportsWords(payload.open)}</span> · <span className="fs-num">{payload.total}</span> in
          all
        </>
      }
      data-admin-section="reports"
    >
      {payload.reports.length === 0 ? (
        <AdminEmpty label="reports">Nobody has reported anything yet.</AdminEmpty>
      ) : (
        <ol className="flex flex-col divide-y divide-n-4">
          {payload.reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              busy={action.isPending && action.variables?.reportId === report.id}
              onReview={() => act(report, 'review')}
              onRemove={() => {
                setRemoving(report)
                setRemoveOpen(true)
              }}
            />
          ))}
        </ol>
      )}
      {payload.total > payload.reports.length && (
        <p className="text-[10px] font-semibold text-caution-strong" data-overflow="reports">
          Showing the newest {payload.reports.length} of {payload.total} reports.
        </p>
      )}
      {removing?.comment && (
        <DeleteCommentDialog
          open={removeOpen}
          onOpenChange={setRemoveOpen}
          body={removing.comment.body}
          copy={REMOVE_COMMENT}
          busy={action.isPending}
          onConfirm={() => act(removing, 'remove')}
        />
      )}
    </AdminSection>
  )
}

/** The toast after Mark reviewed / Remove — the database's answer, in words. */
export function actionToast(kind: 'review' | 'remove', answer: AdminReportActionAnswer): { title: string; description?: string } {
  if (kind === 'review') {
    return answer.status === 'already_reviewed'
      ? { title: 'Already reviewed', description: 'Someone had marked this report reviewed. Nothing changed.' }
      : { title: 'Marked reviewed' }
  }
  if (answer.removed_as !== 'operator') {
    // Removed as the list's owner (a report on your own list): the database
    // stamps no report then — it stays open for Mark reviewed.
    return { title: 'Comment removed', description: 'This report is still open — mark it reviewed.' }
  }
  const n = answer.reports_reviewed ?? 0
  return {
    title: 'Comment removed',
    description: n > 0 ? `${n} ${n === 1 ? 'report' : 'reports'} on it marked reviewed by you.` : undefined,
  }
}

function ReportRow({
  report,
  busy,
  onReview,
  onRemove,
}: {
  report: AdminReport
  busy: boolean
  onReview: () => void
  onRemove: () => void
}) {
  const href = reportOpenHref(report)
  const reviewed = report.reviewed_at !== null
  const removable = report.kind === 'comment' && report.comment !== null && !report.comment.removed
  const listState = report.list && report.list.state !== 'live' ? LIST_STATE_LABEL[report.list.state] : null

  return (
    <li className="flex flex-col gap-1.5 py-3" data-report-row={report.id} data-report-kind={report.kind}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-n-6">
        <Badge variant="stroke">{KIND_LABEL[report.kind]}</Badge>
        <span className="text-ink" data-report-reason>
          {report.reason ? REASON_LABEL[report.reason] : 'No reason given'}
        </span>
        <span>· {when(report.created_at)}</span>
        {reviewed ? (
          <span data-report-reviewed>
            · Reviewed{report.reviewer ? <> by <UsernameLink username={report.reviewer} className="text-n-3" /></> : null} ·{' '}
            {when(report.reviewed_at)}
          </span>
        ) : (
          <Badge variant="yellow" data-report-new>
            New
          </Badge>
        )}
      </div>

      {report.kind === 'comment' ? (
        <div className="flex flex-col gap-1">
          {report.comment ? (
            <p className="line-clamp-4 rounded-md bg-surface-sunken px-3 py-2 text-[12px] font-medium leading-snug text-n-2 [overflow-wrap:anywhere]" data-report-comment>
              {report.comment.body}
            </p>
          ) : (
            <p className="text-[12px] font-medium text-n-6">This comment is no longer there.</p>
          )}
          {/* A div, not a p: the Removed badge is a <div> (valid nesting). */}
          <div className="text-[11px] font-medium text-n-3" data-report-on>
            {report.comment?.removed && (
              <Badge variant="pink" className="mr-1.5" data-report-removed>
                Removed
              </Badge>
            )}
            On <ListTitle report={report} />
            {listState && <span className="text-n-6"> · {listState}</span>}
          </div>
        </div>
      ) : report.kind === 'list' ? (
        <p className="text-[13px] font-bold tracking-[-0.01em] text-ink">
          <ListTitle report={report} />
          {listState && <span className="ml-1.5 text-[11px] font-medium text-n-6">· {listState}</span>}
        </p>
      ) : (
        <p className="text-[13px] font-bold tracking-[-0.01em] text-ink">A start/sit question</p>
      )}

      <p className="text-[11px] font-medium text-n-3" data-report-people>
        {report.kind === 'start_sit' ? 'Asked' : 'Written'} by <Person username={report.author} /> · Reported by{' '}
        <Person username={report.reporter} />
      </p>

      {report.note && (
        <p className="rounded-md border border-n-4 px-3 py-2 text-[11px] font-medium leading-snug text-ink [overflow-wrap:anywhere]" data-report-note>
          <span className="font-semibold text-n-6">Note: </span>
          {report.note}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {href && (
          <Button asChild variant="stroke" size="sm">
            <Link href={href} data-report-open>
              <Icon name="external-link" size={11} />
              Open
            </Link>
          </Button>
        )}
        {!reviewed && (
          <Button variant="blue" size="sm" disabled={busy} onClick={onReview} data-report-review>
            <Icon name="check" size={11} />
            Mark reviewed
          </Button>
        )}
        {removable && (
          <Button variant="destructive" size="sm" className="bg-negative-soft" disabled={busy} onClick={onRemove} data-report-remove>
            <Icon name="remove" size={11} />
            Remove comment
          </Button>
        )}
      </div>
    </li>
  )
}

function ListTitle({ report }: { report: AdminReport }) {
  const title = report.list?.title
  return <span className="text-ink">{title ? `“${title}”` : 'a list that’s no longer there'}</span>
}

/** A username as a link to the profile — or "a deleted account". */
function Person({ username }: { username: string | null }) {
  return username ? (
    <UsernameLink username={username} className="font-semibold text-ink" />
  ) : (
    <span className="text-n-6">a deleted account</span>
  )
}
