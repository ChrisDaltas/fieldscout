'use client'

import * as React from 'react'

import { SheetRow } from '@/components/mobile/lists/folder-sheets'
import { LIcon } from '@/components/mobile/lists/lists-parts'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import {
  noteCounter,
  REPORT_COPY,
  REPORT_HELP,
  REPORT_NOTE_PLACEHOLDER,
  REPORT_REASON_LABEL,
  REPORT_SEND,
  REPORT_SENDING,
  REPORTED_LABEL,
  type ReportableType,
} from '@/components/report/report-ops'
import { useReport } from '@/hooks/use-report'
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from '@/lib/community/report-content'
import { cn } from '@/lib/utils'

/**
 * Report, on the phone (Community launch plan C10). The handoff draws no
 * Report, so it is built in the sheets' own row language: a "Report …" row
 * in the thing's options sheet, then this sheet — what's being reported
 * (quoted), an optional reason (tap one; tap it again to clear it), an
 * optional note of up to 500 characters, and Send report. The answer reaches
 * the normal toast (`useReport` → `reportResult`); once the database says
 * reported or already reported, the row shows "Reported".
 *
 * On the m-* tokens, so it follows the phone's dark mode.
 */

/** The options sheet's Report row — or, once reported, "Reported" (a fact,
 *  not a control: it can't be tapped, and it stays legible). */
export function ReportRow({
  type,
  reported,
  onReport,
}: {
  type: ReportableType
  reported: boolean
  onReport: () => void
}) {
  if (reported) {
    return (
      <div className="flex h-12 items-center gap-3 px-2" data-reported={type}>
        <span className="flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b2 text-m-t3">
          <MIcon name="check" size={15} stroke={2.2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-m-t3">{REPORTED_LABEL}</span>
      </div>
    )
  }
  return (
    <div className="contents" data-report={type}>
      <SheetRow icon={<LIcon name="flag" size={15} />} label={REPORT_COPY[type].item} onClick={onReport} />
    </div>
  )
}

/** The Report sheet. Its form starts fresh on every open. */
export function ReportSheet({
  open,
  onOpenChange,
  target,
  quote,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: { type: ReportableType; id: string }
  quote: string
}) {
  const report = useReport(target)
  const [reason, setReason] = React.useState<ReportReason | null>(null)
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setReason(null)
      setNote('')
    }
  }, [open, target.type, target.id])

  return (
    <MobileSheet
      bodyClassName="leading-[normal]"
      open={open}
      onOpenChange={onOpenChange}
      title={REPORT_COPY[target.type].title}
      subtitle={REPORT_HELP}
      showClose
      footer={
        <div className="px-4 pt-2.5">
          <button
            type="button"
            onClick={() => report.send({ reason, note }, () => onOpenChange(false))}
            disabled={report.sending}
            className="flex h-12 w-full items-center justify-center rounded-[14px] bg-accent text-[15px] font-semibold text-white active:bg-accent-strong disabled:bg-m-b3s disabled:text-m-t3"
            data-report-send
          >
            {report.sending ? REPORT_SENDING : REPORT_SEND}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-5 pb-2" data-report-sheet={target.type}>
        <p
          className="line-clamp-3 rounded-xl bg-m-b1 px-3 py-2.5 text-[14px] font-medium leading-[1.4] text-m-t2 [overflow-wrap:anywhere]"
          data-report-quote
        >
          {quote}
        </p>
        <ReportSheetFields reason={reason} onReason={setReason} note={note} onNote={setNote} />
      </div>
    </MobileSheet>
  )
}

/** The reason rows and the note — hookless, exported for the render tests. */
export function ReportSheetFields({
  reason,
  onReason,
  note,
  onNote,
}: {
  reason: ReportReason | null
  onReason: (reason: ReportReason | null) => void
  note: string
  onNote: (note: string) => void
}) {
  return (
    <>
      <div className="flex flex-col" role="group" aria-label={REPORT_REASON_LABEL} data-report-reasons>
        <span className="pb-1 text-[13px] font-semibold text-m-t3">{REPORT_REASON_LABEL}</span>
        {REPORT_REASONS.map((option) => {
          const on = reason === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              // Optional: tapping the chosen reason again clears it.
              onClick={() => onReason(on ? null : option.value)}
              className="flex min-h-[48px] items-center gap-3 border-b border-m-b2 py-2 text-left last:border-b-0"
              data-report-reason={option.value}
            >
              <span className={cn('min-w-0 flex-1 text-[15px] font-semibold', on ? 'text-accent' : 'text-m-t1')}>
                {option.label}
              </span>
              {on && <MIcon name="check" size={16} stroke={2.4} className="flex-none text-accent" />}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          value={note}
          onChange={(event) => onNote(event.target.value)}
          maxLength={REPORT_NOTE_MAX}
          rows={3}
          placeholder={REPORT_NOTE_PLACEHOLDER}
          aria-label="Note"
          className="resize-none rounded-xl bg-m-b1 p-3 text-[14px] font-medium leading-[1.4] text-m-t1 outline-none placeholder:text-m-t3"
          data-report-note
        />
        <span className="self-end text-[11px] font-medium tabular-nums text-m-t3" data-report-counter>
          {noteCounter(note, REPORT_NOTE_MAX)}
        </span>
      </div>
    </>
  )
}
