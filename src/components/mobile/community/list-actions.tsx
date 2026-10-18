'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { formatCount } from '@/components/lists/v2/list-stats'
import { CommentsSheet } from '@/components/mobile/lists/comments-sheet'
import { MIcon } from '@/components/mobile/ui/m-icon'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { useAuth } from '@/hooks/use-auth'
import { useComments } from '@/hooks/use-comments'
import { useToggleFavorite, useToggleLike, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileCommunityListMeta } from '@/hooks/use-mobile-community-detail'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/**
 * A shared list's actions: Like (with its count) · Comments · Save · Share
 * (handoff m-community §2.14; Like and Comments, gap list §3 #26). One row
 * wherever someone else's list or ranking is read — the Community detail,
 * and an AI expert's ranking in Rankings (gap list §3 #28), so opening a
 * ranking there never loses them.
 *
 * `list` is the `/api/lists/[id]` read (`useList`): the viewer's own like
 * and save, the like count, the comments switch. Share copies the list's
 * public URL, under its owner's handle (the list meta — the same read, and
 * cache, the Community detail's author line uses).
 */
export function ListActions({ list }: { list: ListWithDetails }) {
  const router = useRouter()
  const { user, profile } = useAuth()
  // The detail's own meta read (same arguments, same cache entry): only
  // the owner's handle is needed here, for Share.
  const meta = useMobileCommunityListMeta({
    owner_id: list.owner_id,
    ai_persona_id: list.ai_persona_id,
    scoring_system_id: null,
  })
  const toggleSave = useToggleFavorite()
  const toggleLike = useToggleLike(list.id)
  // The same read (and cache) the Comments sheet shows: the count is ready
  // before it opens, and the sheet opens on the thread already loaded.
  const comments = useComments(list.id)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [savedOverride, setSavedOverride] = useState<boolean | null>(null)

  const saved = savedOverride ?? Boolean(list.is_favorited)
  // The like flips at once — `useToggleLike` is optimistic on the list's
  // detail read (it knows `is_liked`) and puts it back if the toggle fails.
  const liked = list.is_liked === true
  const likes = Math.max(0, list.like_count ?? 0)
  const commentTotal = comments.data?.pagination.total

  const requireUser = () => {
    if (user) return true
    router.push('/login')
    return false
  }

  const onLike = () => {
    // One toggle at a time: the server flips whatever it holds, so a second
    // tap mid-flight would undo the first.
    if (!requireUser() || toggleLike.isPending) return
    toggleLike.mutate(undefined, {
      onError: () => toast({ title: liked ? 'Couldn’t unlike this list' : 'Couldn’t like this list' }),
    })
  }

  const onSave = () => {
    if (!requireUser() || toggleSave.isPending) return
    const next = !saved
    setSavedOverride(next)
    toggleSave.mutate(list.id, {
      onSuccess: (res) => setSavedOverride(res.is_favorited),
      onError: () => {
        setSavedOverride(!next)
        toast({ title: 'Couldn’t save this list' })
      },
    })
  }

  const onShare = async () => {
    const owner = meta.data?.ownerUsername
    if (!owner) return
    const url = `${window.location.origin}${userProfileHref(owner)}/lists/${encodeURIComponent(list.slug)}`
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: 'Link copied' })
    } catch {
      toast({ title: 'Couldn’t copy the link' })
    }
  }

  return (
    <>
      <div className="flex gap-2" data-list-actions>
        <button
          type="button"
          onClick={onLike}
          aria-pressed={liked}
          aria-label={`Like · ${likes} ${likes === 1 ? 'like' : 'likes'}`}
          className={cn(
            'flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold',
            liked ? 'text-accent' : 'text-m-t1',
          )}
          data-like
        >
          <HeartGlyph filled={liked} />
          <span className="tabular-nums">{formatCount(likes)}</span>
        </button>
        <button
          type="button"
          onClick={() => setCommentsOpen(true)}
          aria-haspopup="dialog"
          aria-label={
            commentTotal === undefined
              ? 'Comments'
              : `Comments · ${commentTotal} ${commentTotal === 1 ? 'comment' : 'comments'}`
          }
          className="flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold text-m-t1"
          data-comments
        >
          <MIcon name="chat" size={14} stroke={1.6} />
          {/* The count once it's read; never a guessed 0. */}
          {commentTotal !== undefined && <span className="tabular-nums">{formatCount(commentTotal)}</span>}
        </button>
        <button
          type="button"
          onClick={onSave}
          aria-pressed={saved}
          className={cn(
            'flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold',
            saved ? 'text-accent' : 'text-m-t1',
          )}
        >
          <svg
            viewBox="0 0 16 16"
            width={14}
            height={14}
            fill={saved ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 2.5h8v11L8 10.5l-4 3z" />
          </svg>
          {saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => void onShare()}
          className="flex h-9 items-center gap-[6px] rounded-pill bg-m-b2 px-[14px] text-[13px] font-semibold text-m-t1"
        >
          <svg
            viewBox="0 0 16 16"
            width={14}
            height={14}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2.5v8M5 5.5l3-3 3 3M3.5 9v4h9V9" />
          </svg>
          Share
        </button>
      </div>

      <CommentsSheet
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        listId={list.id}
        enabled={list.comments_enabled ?? true}
        viewer={{ username: profile?.username ?? null, avatarUrl: profile?.avatar_url ?? null }}
      />
    </>
  )
}

/** The Like pill's heart: an outline, filled once you've liked the list. */
function HeartGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 13.6 2.9 8.7A3.1 3.1 0 0 1 8 4.6a3.1 3.1 0 0 1 5.1 4.1z" />
    </svg>
  )
}
