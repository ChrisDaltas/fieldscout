'use client'

import * as React from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UsernameLink } from '@/components/shared/username-link'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useCommentCooldown } from '@/hooks/use-comment-cooldown'
import { CommentRequestError, useAddComment, useComments } from '@/hooks/use-comments'
import { toast } from '@/hooks/use-toast'
import { commentWaitCopy } from '@/lib/rate-limit/comment-limit'
import { MAX_COMMENT_LEN } from '@/types/schemas/lists'

import { updatedLabel } from './lists-model'

/**
 * FieldScout Mobile — a list's comments (an app feature the design lacks,
 * reached from the List view's options). Same hooks as the desktop Comments
 * tab; the composer is pinned to the bottom of the sheet.
 *
 * The comment limit (migration 213 — 5 a minute): once the poster has used
 * his five, Post is held with "You can comment again in 20s", counting down;
 * if the server refuses first, its wait is held instead. A refused or failed
 * post shows in the ink toast and the typed text stays in the box.
 */
export function CommentsSheet({
  open,
  onOpenChange,
  listId,
  enabled,
  viewer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
  /** `lists.comments_enabled`. */
  enabled: boolean
  viewer: { username: string | null; avatarUrl: string | null }
}) {
  const [text, setText] = React.useState('')
  const comments = useComments(open ? listId : undefined)
  const add = useAddComment(listId)
  const cooldown = useCommentCooldown({ active: open && enabled })
  const holding = cooldown.waitSeconds > 0
  const total = comments.data?.pagination.total ?? 0

  const post = () => {
    const body = text.trim()
    if (!body || add.isPending || holding) return
    add.mutate(
      { body },
      {
        onSuccess: (created) => {
          setText('')
          cooldown.notePosted(created.created_at)
        },
        onError: (error) => {
          if (error instanceof CommentRequestError && error.retryAfterSeconds !== null) {
            cooldown.noteRefused(error.retryAfterSeconds)
          }
          toast({ title: 'That comment wasn’t posted', description: error.message, variant: 'destructive' })
        },
      },
    )
  }

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={onOpenChange}
      title="Comments"
      subtitle={comments.data ? `${total} ${total === 1 ? 'comment' : 'comments'}` : undefined}
      showClose
      footer={
        enabled ? (
          <div className="flex flex-col gap-1 px-4 pt-2.5">
            <div className="flex items-center gap-2">
              <UserAvatar
                src={viewer.avatarUrl}
                name={viewer.username}
                className="size-7 flex-none !rounded-pill"
                fallbackClassName="bg-accent text-[11px] font-semibold text-white"
              />
              <input
                value={text}
                maxLength={MAX_COMMENT_LEN}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') post()
                }}
                placeholder="Add a comment"
                aria-label="Add a comment"
                className="h-10 min-w-0 flex-1 rounded-xl bg-m-b2 px-3 text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
              />
              <button
                type="button"
                onClick={post}
                disabled={!text.trim() || add.isPending || holding}
                aria-label="Post comment"
                className="flex size-10 flex-none items-center justify-center rounded-full bg-accent text-white disabled:bg-m-b3s disabled:text-m-t3"
              >
                <MIcon name="sendUp" size={16} stroke={2} />
              </button>
            </div>
            {holding && (
              <p aria-live="polite" className="pl-9 text-[12px] font-medium text-m-t3" data-comment-wait>
                {commentWaitCopy(cooldown.waitSeconds)}
              </p>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col px-4 pb-2">
        {!enabled && (
          <p className="rounded-xl bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t3">
            Comments are turned off on this list.
          </p>
        )}
        {comments.isPending && <p className="py-6 text-center text-[13px] font-medium text-m-t3">Loading comments…</p>}
        {comments.isError && (
          <p className="py-6 text-center text-[13px] font-medium text-m-t3">
            Comments could not be loaded. {comments.error.message}
          </p>
        )}
        {comments.data?.comments.map((comment) => (
          <div key={comment.id} className="flex gap-2.5 border-b border-m-b2 py-3 last:border-b-0">
            <UserAvatar
              src={comment.author.avatar_url}
              name={comment.author.username}
              className="mt-0.5 size-7 flex-none !rounded-pill"
              fallbackClassName="bg-m-b2 text-[11px] font-semibold text-m-t2"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-baseline gap-1.5">
                <UsernameLink username={comment.author.username} className="text-[13px] font-semibold text-m-t1" />
                <span className="text-[11px] font-medium text-m-t3">{updatedLabel(comment.created_at)}</span>
              </div>
              <p className="text-[14px] font-medium leading-[1.4] text-m-t2 [overflow-wrap:anywhere]">{comment.body}</p>
            </div>
          </div>
        ))}
        {comments.data && comments.data.comments.length === 0 && enabled && (
          <p className="py-6 text-center text-[13px] font-medium text-m-t3">No comments yet.</p>
        )}
      </div>
    </MobileSheet>
  )
}
