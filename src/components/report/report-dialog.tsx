'use client'

import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Segment, SegmentItem } from '@/components/ui/tabs'
import { useReport } from '@/hooks/use-report'
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from '@/lib/community/report-content'
import { cn } from '@/lib/utils'

import {
  noteCounter,
  REPORT_CANCEL,
  REPORT_COPY,
  REPORT_HELP,
  REPORT_NOTE_PLACEHOLDER,
  REPORT_REASON_LABEL,
  REPORT_SEND,
  REPORT_SENDING,
  REPORTED_LABEL,
  type ReportableType,
} from './report-ops'

/**
 * Report, on desktop (Community launch plan C10). The design draws no
 * Report, so it is built from v7's own pieces: a menu item in the thing's ⋯
 * and a small dialog — what's being reported (quoted), an optional reason
 * (Spam / Abusive / Something else — the shared segment control; press the
 * chosen one again to clear it), an optional note of up to 500 characters,
 * Cancel and Send report. The answer reaches the normal toast
 * (`useReport` → `reportResult`); once the database says reported or
 * already reported, the item shows "Reported".
 */

/** The ⋯ menu's Report item — or, once reported, "Reported" (a fact, not a
 *  control: it can't be pressed, and it stays legible, never greyed). */
export function ReportMenuItem({
  type,
  reported,
  onSelect,
}: {
  type: ReportableType
  reported: boolean
  onSelect: () => void
}) {
  if (reported) {
    return (
      <DropdownMenuItem disabled className="text-n-6 data-[disabled]:opacity-100" data-reported={type}>
        <Icon name="check" size={13} />
        {REPORTED_LABEL}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuItem onSelect={onSelect} data-report={type}>
      <Icon name="flag" size={13} />
      {REPORT_COPY[type].item}
    </DropdownMenuItem>
  )
}

/**
 * The Report dialog. `quote` is what's being reported, as the reader sees it
 * (the comment's words, or the list's title). Its form starts fresh on every
 * open. A dialog is a true overlay, so it keeps the primitive's resting
 * shadow.
 *
 * The report's controller (`useReport`) lives here, not in the open-only
 * body: closing the dialog mid-send (Cancel, the X, Esc, a click outside)
 * unmounts the body, and TanStack Query drops a `mutate` call's own
 * onSuccess / onError once nothing is listening — the report would be
 * written with no thanks, no error and no "Reported". Held here, the answer
 * still lands after the dialog has closed.
 */
export function ReportDialog({
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ReportDialogBody
          key={`${target.type}:${target.id}`}
          report={report}
          type={target.type}
          quote={quote}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  )
}

function ReportDialogBody({
  report,
  type,
  quote,
  onClose,
}: {
  report: ReturnType<typeof useReport>
  type: ReportableType
  quote: string
  onClose: () => void
}) {
  const [reason, setReason] = React.useState<ReportReason | null>(null)
  const [note, setNote] = React.useState('')
  const copy = REPORT_COPY[type]

  return (
    <DialogContent className="max-w-sm" data-report-dialog={type}>
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{REPORT_HELP}</DialogDescription>
      </DialogHeader>
      <p
        className="line-clamp-3 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] font-medium leading-snug text-n-2 [overflow-wrap:anywhere]"
        data-report-quote
      >
        {quote}
      </p>
      <ReportFields reason={reason} onReason={setReason} note={note} onNote={setNote} />
      <div className="flex justify-end gap-[5px]">
        <Button variant="stroke" size="md" onClick={onClose} data-report-cancel>
          {REPORT_CANCEL}
        </Button>
        <Button
          variant="blue"
          size="md"
          disabled={report.sending}
          onClick={() => report.send({ reason, note }, onClose)}
          data-report-send
        >
          {report.sending ? REPORT_SENDING : REPORT_SEND}
        </Button>
      </div>
    </DialogContent>
  )
}

/** The reason and the note — hookless, exported for the render tests. */
export function ReportFields({
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] font-semibold text-n-6">{REPORT_REASON_LABEL}</span>
        <Segment aria-label={REPORT_REASON_LABEL} className="self-start" data-report-reasons>
          {REPORT_REASONS.map((option) => (
            <SegmentItem
              key={option.value}
              active={reason === option.value}
              // Optional: pressing the chosen reason again clears it.
              onClick={() => onReason(reason === option.value ? null : option.value)}
              data-report-reason={option.value}
            >
              {option.label}
            </SegmentItem>
          ))}
        </Segment>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          rows={3}
          value={note}
          maxLength={REPORT_NOTE_MAX}
          onChange={(event) => onNote(event.target.value)}
          placeholder={REPORT_NOTE_PLACEHOLDER}
          aria-label="Note"
          className={cn(
            'w-full resize-none rounded-md bg-surface-control p-2.5 text-[12px] font-medium leading-relaxed text-ink outline-none transition-shadow focus-visible:bg-white focus-visible:shadow-field',
            'placeholder:text-n-6',
          )}
          data-report-note
        />
        <span className="self-end text-[10px] font-medium tabular-nums text-n-6" data-report-counter>
          {noteCounter(note, REPORT_NOTE_MAX)}
        </span>
      </div>
    </div>
  )
}
