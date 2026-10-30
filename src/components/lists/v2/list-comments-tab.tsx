'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  commentControlsOn,
  commentMenuItems,
  commentsOffCopy,
  confirmCommentDelete,
  DELETE_COMMENT,
  type CommentMenuItem,
} from '@/components/lists/comment-menu-ops'
import { signInHref } from '@/components/explore/follow-button'
import { ReportDialog, ReportMenuItem } from '@/components/report/report-dialog'
import { UsernameLink } from '@/components/shared/username-link'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
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

import { formatRelative } from './list-stats'

/**
 * Lists v2 — the **Comments** tab (`screens/detail-tab-comments.png`).
 *
 * Composer (avatar, single-line field, `Post`) then the thread: avatar,
 * `@handle` + relative time, body, and the row's ⋯ menu.
 *
 * Notes on what is and is not wired:
 *
 * * **No comment likes.** The design draws a heart and a count on every
 *   comment, but `list_comments` stores no per-comment like, so the heart is
 *   left out rather than shown as a control with nothing behind it
 *   (Community launch plan C1, readiness S12 — CLAUDE.md: features with no
 *   backend are left out, not stubbed). C1 rides the Community switch
 *   (`commentControlsOn`): while it is off this tab is exactly as it was —
 *   the old heart, no ⋯, no "Show older comments".
 * * A failed read renders as an **error**, never as "no comments yet" — the
 *   false-empty-state shape CLAUDE.md calls out by name.
 *
 * ## The ⋯ menu (C1)
 *
 * Report (C10) on everyone else's comment — signed out it sends you to
 * sign in — opening the Report dialog; once sent it shows "Reported". Delete,
 * with a confirm, for whoever wrote the comment and for the list's owner
 * (`comment-menu-ops`). No item, no ⋯. A refused delete puts the comment
 * back and says why in the toast.
 *
 * ## Older comments (C1)
 *
 * The thread reads the newest 20; "Show older comments" reads the next 20
 * (`useComments` pages the API's `hasMore`), so a list that says "35
 * comments" can show all 35.
 *
 * ## Who gets a composer (LV.6)
 *
 * The thread reads for everyone; **writing needs two conditions and the tab
 * asks for both explicitly.** `signedIn` came in with the public share view,
 * which is the only Lists surface that renders to a stranger — a composer that
 * 401s on submit is the same lie as a drag that snaps back. `commentsEnabled`
 * is `lists.comments_enabled`, which this tab previously ignored: the app panel
 * showed a working-looking composer on a list whose owner had turned comments
 * off, and the POST would have been refused. Both callers now pass the truth.
 * With comments off, readers see the note and no box (the database hides the
 * thread from everyone but the owner); the owner still sees and can delete
 * what was there.
 *
 * ## The comment limit (migration 213 — 5 a minute)
 *
 * Once the poster has used his five, `Post` is held with "You can comment
 * again in 20s", counting down; if the server refuses first, its wait is held
 * instead. A refused or failed post shows in the ink toast and the typed text
 * stays in the field.
 */

interface CommentsTabProps {
  listId: string
  viewer: { username: string | null; avatarUrl: string | null }
  /** A signed-out viewer reads the thread and gets a sign-in link, not a field. */
  signedIn?: boolean
  /** `lists.comments_enabled` — the owner's switch. */
  commentsEnabled?: boolean
  /** The viewer owns the list: he may delete anyone's comment on it. */
  listOwned?: boolean
}

export function ListCommentsTab({
  listId,
  viewer,
  signedIn = true,
  commentsEnabled = true,
  listOwned = false,
}: CommentsTabProps) {
  const [text, setText] = React.useState('')
  const router = useRouter()
  const { user } = useAuth()
  const comments = useComments(listId)
  const addComment = useAddComment(listId)
  const remove = useDeleteComment(listId)
  // The comment Delete is asking about (null = no confirm open).
  const [confirming, setConfirming] = React.useState<CommentWithAuthor | null>(null)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  // The comment Report is open for (C10).
  const [reporting, setReporting] = React.useState<CommentWithAuthor | null>(null)
  const [reportOpen, setReportOpen] = React.useState(false)
  const reportedMarks = useReportedStore((state) => state.reported)
  const olderFailed = comments.isFetchNextPageError
  // C1's ⋯, older comments and the owner's note ride the Community switch;
  // while it's off the tab is as it was.
  const controls = commentControlsOn()
  // No ⋯ on a thread still showing the last list's comments.
  const menusLive = controls && !comments.isPlaceholderData
  const cooldown = useCommentCooldown({ active: commentsEnabled && signedIn })
  const holding = cooldown.waitSeconds > 0

  const post = () => {
    const body = text.trim()
    if (!body || addComment.isPending || holding) return
    addComment.mutate(
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
    <div className="flex max-w-[576px] flex-col gap-3">
      {!commentsEnabled ? (
        <p className="rounded-xl bg-surface-sunken px-3 py-2.5 text-[11px] font-medium text-n-3" data-comments-off>
          {commentsOffCopy(controls && listOwned)}
        </p>
      ) : !signedIn ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2">
          <span className="mr-auto text-[11px] font-medium text-n-3">
            Sign in to join the discussion.
          </span>
          <Button asChild variant="blue" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <UserAvatar
            src={viewer.avatarUrl}
            name={viewer.username}
            className="h-6 w-6 shrink-0"
            fallbackClassName="text-[9px]"
          />
          <Input
            value={text}
            maxLength={MAX_COMMENT_LEN}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') post()
            }}
            placeholder="Add a comment…"
            aria-label="Add a comment"
            className="h-input min-w-0 flex-1 rounded-pill px-3"
          />
          <Button
            variant="blue"
            size="md"
            onClick={post}
            disabled={!text.trim() || addComment.isPending || holding}
          >
            <Icon name="send" size={12} /> Post
          </Button>
        </div>
      )}

      {holding && commentsEnabled && signedIn && (
        <p aria-live="polite" className="-mt-1 pl-8 text-[10px] font-medium text-n-6" data-comment-wait>
          {commentWaitCopy(cooldown.waitSeconds)}
        </p>
      )}

      {comments.isPending && (
        <p className="py-4 text-center text-[11px] font-medium text-n-6">Loading comments…</p>
      )}

      {comments.isError && !olderFailed && (
        <p className="text-[11px] font-medium text-negative-strong">
          Comments could not be loaded. {comments.error.message}
        </p>
      )}

      {comments.data?.comments.map((comment) => (
        <div key={comment.id} className="flex gap-2.5 border-t border-n-4 pt-3" data-comment={comment.id}>
          <UserAvatar
            src={comment.author.avatar_url}
            name={comment.author.username}
            className="mt-0.5 h-6 w-6 shrink-0"
            fallbackClassName="text-[9px]"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <UsernameLink username={comment.author.username} className="text-[11px] font-semibold text-ink" />
              <span className="text-[10px] font-medium text-n-6">
                {formatRelative(comment.created_at)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] font-medium leading-snug text-n-2 [overflow-wrap:anywhere]">{comment.body}</p>
            {!controls && (
              // The pre-C1 heart, kept only while Community is off (it goes
              // with the switch — there are no comment likes to show).
              <span
                title="Comment likes are not stored yet"
                className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-n-6"
              >
                <Icon name="like" size={11} />
                <span className="fs-num">0</span>
              </span>
            )}
          </div>
          <CommentRowMenu
            username={comment.author.username}
            items={menusLive ? commentMenuItems({ viewerId: user?.id, authorId: comment.author_id, listOwned }) : []}
            reported={wasReported(reportedMarks, user?.id, 'comment', comment.id)}
            onReport={() => {
              // Signed out, Report sends you to sign in, then back here.
              if (!user) {
                router.push(signInHref(window.location.pathname + window.location.search, featureFlags.community))
                return
              }
              setReporting(comment)
              setReportOpen(true)
            }}
            onDelete={() => {
              setConfirming(comment)
              setConfirmOpen(true)
            }}
          />
        </div>
      ))}

      {comments.data && comments.data.comments.length === 0 && (commentsEnabled || !controls) && (
        <p className="py-4 text-center text-[11px] font-medium text-n-6">No comments yet.</p>
      )}

      {controls && comments.hasNextPage && (
        <div className="flex flex-wrap items-center gap-2 border-t border-n-4 pt-3">
          <Button
            variant="stroke"
            size="sm"
            onClick={() => void comments.fetchNextPage()}
            disabled={comments.isFetchingNextPage}
            data-older-comments
          >
            {comments.isFetchingNextPage ? 'Loading…' : olderFailed ? 'Try again' : 'Show older comments'}
          </Button>
          {olderFailed && (
            <span className="text-[10px] font-medium text-negative-strong">
              Couldn’t load older comments. {comments.error?.message}
            </span>
          )}
        </div>
      )}

      {reporting && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          target={{ type: 'comment', id: reporting.id }}
          quote={reporting.body}
        />
      )}

      {confirming && (
        <DeleteCommentDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          body={confirming.body}
          onConfirm={() => {
            setConfirmOpen(false)
            confirmCommentDelete(remove, confirming.id, toast)
          }}
        />
      )}
    </div>
  )
}

/**
 * A comment row's ⋯ (C1): its items in a menu — Report (C10; "Reported"
 * once sent), then Delete. No item, no ⋯. A menu overlays the page, so it
 * keeps the primitive's resting shadow.
 */
export function CommentRowMenu({
  username,
  items,
  reported = false,
  onReport = () => {},
  onDelete,
}: {
  username: string
  items: CommentMenuItem[]
  /** You've reported this comment this session. */
  reported?: boolean
  onReport?: () => void
  onDelete: () => void
}) {
  if (items.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Comment options · @${username}`}
          className="-mt-1 shrink-0 text-n-6 hover:text-ink data-[state=open]:bg-surface-hover data-[state=open]:text-ink"
          data-comment-menu
        >
          <Icon name="dots" size={13} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[168px]">
        {items.includes('report') && <ReportMenuItem type="comment" reported={reported} onSelect={onReport} />}
        {items.includes('delete') && (
          <DropdownMenuItem variant="destructive" onSelect={onDelete} data-comment-delete>
            <Icon name="remove" size={13} />
            {DELETE_COMMENT.item}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Delete's confirm: the comment quoted, Cancel, and Delete in the soft red
 * tint (bright red is for words, never a fill). A dialog is a true overlay,
 * so it keeps the primitive's resting shadow. Hookless: the tab holds it.
 */
export function DeleteCommentDialog({
  open,
  onOpenChange,
  body,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  body: string
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm" data-comment-confirm>
        <DialogHeader>
          <DialogTitle>{DELETE_COMMENT.title}</DialogTitle>
          <DialogDescription>{DELETE_COMMENT.body}</DialogDescription>
        </DialogHeader>
        <p className="line-clamp-3 rounded-xl bg-surface-sunken px-3 py-2 text-[12px] font-medium leading-snug text-n-2 [overflow-wrap:anywhere]">
          {body}
        </p>
        <div className="flex justify-end gap-[5px]">
          <Button variant="stroke" size="md" onClick={() => onOpenChange(false)} data-comment-confirm-cancel>
            {DELETE_COMMENT.cancel}
          </Button>
          <Button variant="destructive" size="md" className="bg-negative-soft" onClick={onConfirm} data-comment-confirm-delete>
            {DELETE_COMMENT.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
