'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

import {
  commentControlsOn,
  commentMenuItems,
  commentsOffCopy,
  confirmCommentDelete,
  DELETE_COMMENT,
  type CommentMenuItem,
} from '@/components/lists/comment-menu-ops'
import { signInHref } from '@/components/explore/follow-button'
import { ReportRow, ReportSheet } from '@/components/mobile/community/report-sheet'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { UsernameLink } from '@/components/shared/username-link'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useAuth } from '@/hooks/use-auth'
import { useCommentCooldown } from '@/hooks/use-comment-cooldown'
import {
  CommentRequestError,
  useAddComment,
  useComments,
  useDeleteComment,
  type CommentWithAuthor,
} from '@/hooks/use-comments'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'
import { commentWaitCopy } from '@/lib/rate-limit/comment-limit'
import { useReportedStore, wasReported } from '@/stores/reported-store'
import { MAX_COMMENT_LEN } from '@/types/schemas/lists'

import { SheetRow } from './folder-sheets'
import { updatedLabel } from './lists-model'
import { LIcon } from './lists-parts'

/**
 * FieldScout Mobile — a list's comments (an app feature the design lacks,
 * reached from the List view's options). Same hooks as the desktop Comments
 * tab; the composer is pinned to the bottom of the sheet.
 *
 * The comment limit (migration 213 — 5 a minute): once the poster has used
 * his five, Post is held with "You can comment again in 20s", counting down;
 * if the server refuses first, its wait is held instead. A refused or failed
 * post shows in the ink toast and the typed text stays in the box.
 *
 * Each row's ⋯ (Community launch plan C1) opens the comment's own sheet —
 * Report on everyone else's comment (C10: the Report sheet, then
 * "Reported"), and Delete, for whoever wrote it and for the list's owner,
 * with a confirm (`comment-menu-ops`). No item, no ⋯. The thread
 * reads the newest 20 first; "Show older comments" reads the next 20. Both
 * ride the Community switch (`commentControlsOn`).
 */
export function CommentsSheet({
  open,
  onOpenChange,
  listId,
  enabled,
  listOwned,
  viewer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  listId: string
  /** `lists.comments_enabled`. */
  enabled: boolean
  /** The viewer owns the list: he may delete anyone's comment on it. */
  listOwned: boolean
  viewer: { username: string | null; avatarUrl: string | null }
}) {
  const [text, setText] = React.useState('')
  const router = useRouter()
  const { user } = useAuth()
  const comments = useComments(open ? listId : undefined)
  const add = useAddComment(listId)
  const remove = useDeleteComment(listId)
  const cooldown = useCommentCooldown({ active: open && enabled })
  const holding = cooldown.waitSeconds > 0
  const total = comments.data?.pagination.total ?? 0
  // C1's ⋯, older comments and the owner's note ride the Community switch.
  const controls = commentControlsOn()
  // No ⋯ on a thread still showing the last list's comments.
  const menusLive = controls && !comments.isPlaceholderData

  // The comment whose sheet is open. Kept while the sheet slides away so
  // its words don't vanish mid-close.
  const [menu, setMenu] = React.useState<{ comment: CommentWithAuthor; items: CommentMenuItem[]; step: CommentMenuStep } | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // Report (C10): the comment being reported, kept while its sheet closes.
  const [reporting, setReporting] = React.useState<CommentWithAuthor | null>(null)
  const [reportOpen, setReportOpen] = React.useState(false)
  const reportedMarks = useReportedStore((state) => state.reported)

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

  // A failed read of older comments says so beside its button; the thread
  // already shown stays.
  const olderFailed = comments.isFetchNextPageError
  const readFailed = comments.isError && !olderFailed

  return (
    <>
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
            <p className="rounded-xl bg-m-b1 px-3 py-2.5 text-[13px] font-medium text-m-t3" data-comments-off>
              {commentsOffCopy(controls && listOwned)}
            </p>
          )}
          {comments.isPending && <p className="py-6 text-center text-[13px] font-medium text-m-t3">Loading comments…</p>}
          {readFailed && (
            <p className="py-6 text-center text-[13px] font-medium text-m-t3">
              Comments could not be loaded. {comments.error.message}
            </p>
          )}
          {comments.data?.comments.map((comment) => {
            const items = menusLive ? commentMenuItems({ viewerId: user?.id, authorId: comment.author_id, listOwned }) : []
            return (
              <div key={comment.id} className="flex gap-2.5 border-b border-m-b2 py-3 last:border-b-0" data-comment={comment.id}>
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
                {items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenu({ comment, items, step: 'menu' })
                      setMenuOpen(true)
                    }}
                    aria-label={`Comment options · @${comment.author.username}`}
                    aria-haspopup="dialog"
                    className="-mr-1.5 -mt-1 flex size-8 flex-none items-center justify-center rounded-full text-m-t3 active:bg-m-b2"
                    data-comment-menu
                  >
                    <MIcon name="more" size={16} stroke={2.6} />
                  </button>
                )}
              </div>
            )
          })}
          {comments.data && comments.data.comments.length === 0 && enabled && (
            <p className="py-6 text-center text-[13px] font-medium text-m-t3">No comments yet.</p>
          )}
          {controls && comments.hasNextPage && (
            <div className="flex flex-col items-center gap-1.5 pt-3">
              {olderFailed && (
                <p className="text-[12px] font-medium text-m-t3">Couldn’t load older comments. {comments.error?.message}</p>
              )}
              <button
                type="button"
                onClick={() => void comments.fetchNextPage()}
                disabled={comments.isFetchingNextPage}
                className="flex h-9 items-center rounded-pill bg-m-b2 px-4 text-[13px] font-semibold text-m-t1 active:bg-m-b2h disabled:text-m-t3"
                data-older-comments
              >
                {comments.isFetchingNextPage ? 'Loading…' : olderFailed ? 'Try again' : 'Show older comments'}
              </button>
            </div>
          )}
        </div>
      </MobileSheet>

      {menu && (
        <CommentMenuSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          comment={menu.comment}
          items={menu.items}
          step={menu.step}
          onStep={(step) => setMenu((m) => (m ? { ...m, step } : m))}
          reported={wasReported(reportedMarks, user?.id, 'comment', menu.comment.id)}
          onReport={() => {
            setMenuOpen(false)
            if (!user) {
              router.push(signInHref(window.location.pathname + window.location.search, featureFlags.community))
              return
            }
            setReporting(menu.comment)
            setReportOpen(true)
          }}
          onDelete={() => {
            setMenuOpen(false)
            confirmCommentDelete(remove, menu.comment.id, toast)
          }}
        />
      )}

      {reporting && (
        <ReportSheet
          open={reportOpen}
          onOpenChange={setReportOpen}
          target={{ type: 'comment', id: reporting.id }}
          quote={reporting.body}
        />
      )}
    </>
  )
}

export type CommentMenuStep = 'menu' | 'confirm-delete'

/**
 * One comment's sheet, over the thread: the comment quoted, its items
 * (Report — "Reported" once sent — then Delete), then Delete's confirm in the
 * same sheet — Cancel and a Delete in the soft red tint (never bright red
 * paint). Hookless: the thread holds the step.
 */
export function CommentMenuSheet({
  open,
  onOpenChange,
  comment,
  items,
  step,
  onStep,
  reported = false,
  onReport = () => {},
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  comment: Pick<CommentWithAuthor, 'id' | 'body'>
  items: CommentMenuItem[]
  step: CommentMenuStep
  onStep: (step: CommentMenuStep) => void
  /** You've reported this comment this session. */
  reported?: boolean
  onReport?: () => void
  onDelete: () => void
}) {
  const confirming = step === 'confirm-delete'
  return (
    <MobileSheet
      bodyClassName="leading-[normal]"
      open={open}
      onOpenChange={onOpenChange}
      title={confirming ? DELETE_COMMENT.title : 'Comment'}
      subtitle={confirming ? DELETE_COMMENT.body : undefined}
      showClose={!confirming}
      scrollKey={step}
    >
      <p className="mx-5 mb-2 line-clamp-3 rounded-xl bg-m-b1 px-3 py-2.5 text-[14px] font-medium leading-[1.4] text-m-t2 [overflow-wrap:anywhere]" data-comment-quote>
        {comment.body}
      </p>
      {confirming ? (
        <div className="flex flex-col gap-3 px-5 pb-2" data-comment-confirm={comment.id}>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-12 rounded-pill bg-m-b2 text-[15px] font-semibold text-m-t1 active:bg-m-b2h"
              data-comment-confirm-cancel
            >
              {DELETE_COMMENT.cancel}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="h-12 rounded-pill bg-m-gr text-[15px] font-semibold text-m-tr"
              data-comment-confirm-delete
            >
              {DELETE_COMMENT.confirm}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col px-3 pb-2" data-comment-items>
          {items.includes('report') && <ReportRow type="comment" reported={reported} onReport={onReport} />}
          {items.includes('delete') && (
            <SheetRow
              tone="danger"
              icon={<LIcon name="trash" size={15} />}
              label={DELETE_COMMENT.item}
              onClick={() => onStep('confirm-delete')}
            />
          )}
        </div>
      )}
    </MobileSheet>
  )
}
