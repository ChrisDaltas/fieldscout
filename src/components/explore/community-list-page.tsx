'use client'

import { useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { toastLikeFailed } from '@/components/explore/explore-feed'
import { FollowButton } from '@/components/explore/follow-button'
import { ListAiNote } from '@/components/lists/list-ai-note'
import { PublicListView } from '@/components/lists/public-list-view'
import { formatCount } from '@/components/lists/v2/list-stats'
import { COMMUNITY_HREF } from '@/components/mobile/community/community-ops'
import { listHref } from '@/components/mobile/lists/lists-routes'
import { useGoBack } from '@/components/mobile/ui/back-nav'
import { ReportDialog, ReportMenuItem } from '@/components/report/report-dialog'
import { reportAccess } from '@/components/report/report-ops'
import { userProfileHref } from '@/components/shared/username-link-ops'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { useComments } from '@/hooks/use-comments'
import {
  exploreFeedKeys,
  withLikeCount,
  type ExploreFeedPage,
  type ExploreFeedPageParam,
} from '@/hooks/use-explore-feed'
import { useListPersona } from '@/hooks/use-list-persona'
import { useList, useToggleLike, type ListWithDetails } from '@/hooks/use-lists'
import { useMobileCommunityListMeta } from '@/hooks/use-mobile-community-detail'
import { cn } from '@/lib/utils'
import { useReportedStore, wasReported } from '@/stores/reported-store'

/**
 * Community's list page on desktop — someone else's list, inside the app
 * shell (plan C5; readiness S7b, F10). The address is the phone's
 * (`/app/explore?list=<id>`, `inAppListHref`): Community's feed and search
 * open it, so does a shared link opened by someone signed in, and a phone
 * address pasted on desktop no longer shows the feed instead.
 *
 * The body is the share page's (`PublicListView` — one list renderer, not
 * two), with everything it offers — the list, Details, comments, Share,
 * Pin — plus what Community adds for a signed-in reader:
 *  - **Like**, with its count (optimistic, and a failure says so);
 *  - **Follow** beside the author — a person's list only: an AI expert's
 *    board is owned by the FieldScout AI account, which isn't a person to
 *    follow (the phone's rule). Its byline names the expert, as plain
 *    text, never that account (plan E2);
 *  - the comments with C1's ⋯ menu (`ListCommentsTab`);
 *  - the "made by FieldScout AI" note on an AI expert's board;
 *  - the list's ⋯ menu, with Report (plan C10: the Report dialog, then
 *    "Reported");
 *  - **Back** to where you came from — history when the app is behind
 *    this page, else Community (`useGoBack`, the phone's one Back rule).
 *
 * Your own list is not a Community post (ruling #20): it opens your Lists,
 * with Edit, instead. Everything here waits for both reads — the list and
 * who made it — and a failed read says so with Try again, never an empty
 * page.
 */
export function CommunityListPage({ listId, fromFeed = false }: { listId: string; fromFeed?: boolean }) {
  const list = useList(listId)
  const goBack = useGoBack()
  const router = useRouter()
  const own = list.data?.is_owner === true
  const backRef = useRef<HTMLButtonElement>(null)

  // Opened from the feed, the row that was clicked is hidden now: focus
  // moves to Back, as on the phone's list page. (Arriving from outside, the
  // page starts where any page does.)
  useEffect(() => {
    if (fromFeed) backRef.current?.focus({ preventScroll: true })
  }, [fromFeed, listId])

  // Your own list opens on your Lists, with Edit (ruling #20).
  useEffect(() => {
    if (own) router.replace(listHref(listId))
  }, [own, listId, router])

  return (
    <div className="flex w-full max-w-[900px] flex-col gap-3" data-community-list-page>
      <div>
        <Button ref={backRef} variant="stroke" size="sm" onClick={() => goBack(COMMUNITY_HREF)}>
          <Icon name="arrow-prev" size={13} /> Back
        </Button>
      </div>
      {list.data && !own ? (
        <LoadedList list={list.data} />
      ) : list.isError ? (
        <ReadFailed
          gone={(list.error as (Error & { status?: number }) | null)?.status === 404}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <ListSkeleton />
      )}
    </div>
  )
}

function LoadedList({ list }: { list: ListWithDetails }) {
  const { user, profile } = useAuth()
  // Who made it (the owner's handle and picture, and whether a person or an
  // AI expert) — the read, and cache, the phone's list page uses.
  const meta = useMobileCommunityListMeta({
    owner_id: list.owner_id,
    ai_persona_id: list.ai_persona_id,
    scoring_system_id: null,
  })
  // The thread the Comments tab shows, so its count is the thread's.
  const comments = useComments(list.id)
  const persona = useListPersona(list.ai_persona_id)

  if (meta.isError) {
    return <ReadFailed gone={false} onRetry={() => void meta.refetch()} retrying={meta.isFetching} />
  }
  if (!meta.data) return <ListSkeleton />

  const { author, ownerUsername, ownerAvatarUrl } = meta.data
  // A person's list (an AI expert's board has no person to follow);
  // FollowButton hides itself on your own.
  const followId = author.profileId
  // Who the byline names: a person's list names its owner, a link to their
  // profile; an AI expert's board names the expert, as plain text — the
  // phone's rule — never the FieldScout AI account that owns every expert
  // board, so nobody follows it by mistake (plan E2).
  const owner = author.isPersona
    ? { username: author.username, avatarUrl: author.avatarUrl, isPersona: true }
    : { username: ownerUsername, avatarUrl: ownerAvatarUrl }

  return (
    <>
      <PublicListView
        list={list}
        owner={owner}
        viewer={{ username: profile?.username ?? null, avatarUrl: profile?.avatar_url ?? null }}
        canPin
        signedIn
        initialPinned={Boolean(list.is_favorited)}
        commentCount={comments.data?.pagination.total}
        // Share copies the list's public link — what someone else can open,
        // signed in or not — never the app's own address.
        shareHref={`${userProfileHref(ownerUsername)}/lists/${encodeURIComponent(list.slug)}`}
        community={{
          like: <LikeButton list={list} />,
          follow: followId ? <FollowButton userId={followId} className="ml-1" /> : null,
          // The list's ⋯ menu: Report (plan C10) — never on your own list
          // (prevent, don't refuse). With no item there is no ⋯ (the
          // comment ⋯'s rule).
          menu:
            reportAccess({ viewerId: user?.id, ownerId: list.owner_id }) === 'report' ? <ListMenu list={list} /> : null,
        }}
      />
      {/* A switched-off expert's board has no line (`null`), as on the share
          page; until the expert is read — or if it can't be — the line still
          says the board is AI-made. */}
      {list.ai_persona_id && persona.data !== null && <ListAiNote persona={persona.data} />}
    </>
  )
}

/**
 * The list's ⋯ (plan C10): Report — "Reported" once the database has
 * answered. A menu and a dialog overlay the page, so they keep the
 * primitives' resting shadows.
 */
function ListMenu({ list }: { list: ListWithDetails }) {
  const { user } = useAuth()
  const [reportOpen, setReportOpen] = useState(false)
  const reported = useReportedStore((state) => wasReported(state.reported, user?.id, 'list', list.id))
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" title="List options" aria-label="List options">
            <Icon name="dots" size={13} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[168px]">
          <ReportMenuItem type="list" reported={reported} onSelect={() => setReportOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} target={{ type: 'list', id: list.id }} quote={list.title} />
    </>
  )
}

/**
 * Like, with the list's count: a v7 secondary pill, blue once you've liked
 * it. Optimistic on the list's own read (`useToggleLike` knows `is_liked`);
 * the toggle's answer — liked or not, and the real count — is written into
 * Community's feed too, so Back shows the same. A like that doesn't go
 * through puts it back and says so.
 */
function LikeButton({ list }: { list: ListWithDetails }) {
  const qc = useQueryClient()
  const toggleLike = useToggleLike(list.id)
  const liked = list.is_liked === true
  const likes = Math.max(0, list.like_count ?? 0)

  const onClick = () => {
    // One toggle at a time: the server flips whatever it holds.
    if (toggleLike.isPending) return
    toggleLike.mutate(undefined, {
      onSuccess: (data) =>
        qc.setQueriesData<InfiniteData<ExploreFeedPage, ExploreFeedPageParam>>(
          { queryKey: exploreFeedKeys.all },
          (old) => withLikeCount(old, list.id, data.like_count, data.liked),
        ),
      onError: () => toastLikeFailed(!liked),
    })
  }

  return (
    <Button
      variant="stroke"
      size="sm"
      onClick={onClick}
      aria-pressed={liked}
      aria-label={`Like · ${likes} ${likes === 1 ? 'like' : 'likes'}`}
      className={cn(liked && 'text-accent')}
      data-like
    >
      <Icon name="like" size={11} />
      <span className="fs-num">{formatCount(likes)}</span>
    </Button>
  )
}

function ReadFailed({ gone, onRetry, retrying }: { gone: boolean; onRetry: () => void; retrying: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-2.5 px-[19px] py-10 text-center" data-list-read-failed>
      {gone ? (
        <p className="text-[13px] font-bold tracking-[-0.01em] text-ink">
          This list isn&apos;t available. It may have been deleted or made private.
        </p>
      ) : (
        <>
          <p className="text-[11px] font-semibold text-negative-strong">Couldn&apos;t load this list.</p>
          <Button variant="stroke" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Loading…' : 'Try again'}
          </Button>
        </>
      )}
    </Card>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-n-4 bg-white p-[17px]" aria-busy="true" aria-label="Loading">
      <div className="flex items-start gap-3">
        <Skeleton className="h-[51px] w-[51px] rounded-[12px] bg-surface-control" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-1/2 rounded-md bg-surface-control" />
          <Skeleton className="h-3 w-1/3 rounded-md bg-surface-control" />
        </div>
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-9 rounded-md bg-surface-control" />
      ))}
    </div>
  )
}
