'use client'

import { use, useEffect } from 'react'

import { AiBuildBanner } from '@/components/lists/ai-build-banner'
import { CommentsThread } from '@/components/lists/comments-thread'
import { ListDetailView } from '@/components/lists/list-detail-view'
import { ListDetailPageV2 } from '@/components/lists/v2/list-detail-page-v2'
import { Skeleton } from '@/components/ui/skeleton'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { useList } from '@/hooks/use-lists'
import { featureFlags } from '@/lib/feature-flags'
import { useHistoryStore } from '@/stores/history-store'

interface ListDetailPageProps {
  params: Promise<{ listId: string }>
}

// LV.1.1 (delivery-plan-lists-v2.md §4): route-level branch so the old and
// new list detail screens can coexist. Flag OFF must render byte-for-byte
// today's page, so ListDetailPageLegacy below is that page unchanged — only
// given a name so its hooks (useList, useAiListBuild, ...) stay unconditional
// and don't run when the branch takes the v2 placeholder instead.
export default function ListDetailPage(props: ListDetailPageProps) {
  const params = use(props.params)
  const { listId } = params

  if (featureFlags.listsV2) {
    return <ListDetailPageV2 listId={listId} />
  }

  return <ListDetailPageLegacy listId={listId} />
}

function ListDetailPageLegacy({ listId }: { listId: string }) {
  const { data, isLoading, isError, error } = useList(listId)
  // Runs the "watch the AI build this list" sequence when the generate modal
  // queued a job for this list; `building` locks the page to read-only so the
  // user can't fight the AI over the order mid-show.
  const aiBuild = useAiListBuild(listId)

  // Record the view so the home page's "Recently Viewed" reflects it.
  const pushHistory = useHistoryStore((s) => s.push)
  useEffect(() => {
    if (!data) return
    pushHistory({
      type: 'list',
      href: `/app/lists/${data.id}`,
      name: data.title,
      subtitle: `${data.player_count ?? data.players.length} players`,
      imageUrl: data.thumbnail_url ?? undefined,
    })
  }, [data?.id, data?.title, data?.player_count, data?.thumbnail_url, pushHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="space-y-4 px-2 lg:px-3">
        <Skeleton className="h-[104px] w-full" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="mx-2 rounded-sm border border-negative-strong bg-negative-soft p-6 text-sm font-medium text-ink lg:mx-3">
        {(error as Error)?.message ?? 'List not found.'}
      </div>
    )
  }

  // Server-authoritative — avoids the client auth race that hid actions.
  const isOwner = data.is_owner && !aiBuild.building

  return (
    <div className="space-y-10 px-2 pb-6 lg:px-3">
      {aiBuild.job && (
        <AiBuildBanner
          job={aiBuild.job}
          onRetry={aiBuild.retry}
          onDismiss={aiBuild.dismiss}
        />
      )}
      <ListDetailView list={data} isOwner={isOwner} aiBuilding={aiBuild.building} />
      <CommentsThread
        listId={data.id}
        ownerId={data.owner_id}
        commentsEnabled={data.comments_enabled ?? true}
      />
    </div>
  )
}
