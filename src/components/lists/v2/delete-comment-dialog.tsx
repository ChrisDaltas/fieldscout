'use client'

import { DELETE_COMMENT } from '@/components/lists/comment-menu-ops'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** The words of a take-a-comment-down confirm. */
export interface CommentConfirmCopy {
  title: string
  body: string
  cancel: string
  confirm: string
  /** What the confirm button says while it runs (with `busy`). */
  busyLabel?: string
}

/**
 * The confirm before a comment comes down, desktop: the comment quoted,
 * Cancel, and the confirm in the soft red tint (bright red is for words,
 * never a fill). A dialog is a true overlay, so it keeps the primitive's
 * resting shadow. Hookless: the caller holds it.
 *
 * One dialog, two uses: the comment row's Delete (C1, the default words)
 * and Admin › Reports' Remove (C10, its own `copy` and `busy`).
 */
export function DeleteCommentDialog({
  open,
  onOpenChange,
  body,
  onConfirm,
  copy = DELETE_COMMENT,
  busy = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  body: string
  onConfirm: () => void
  copy?: CommentConfirmCopy
  /** The take-down is running: the confirm can't be pressed twice. */
  busy?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-comment-confirm>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        <p className="line-clamp-3 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] font-medium leading-snug text-n-2 [overflow-wrap:anywhere]">
          {body}
        </p>
        <div className="flex justify-end gap-[5px]">
          <Button variant="stroke" size="md" onClick={() => onOpenChange(false)} data-comment-confirm-cancel>
            {copy.cancel}
          </Button>
          <Button
            variant="destructive"
            size="md"
            className="bg-negative-soft"
            disabled={busy}
            onClick={onConfirm}
            data-comment-confirm-delete
          >
            {busy && copy.busyLabel ? copy.busyLabel : copy.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
