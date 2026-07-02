'use client'

import { use, useEffect, useMemo } from 'react'

import { CommentsThread } from '@/components/lists/comments-thread'
import { ListDetailSidebar } from '@/components/lists/list-detail-sidebar'
import { ListDetailView } from '@/components/lists/list-detail-view'
import { Card, CardContent } from '@/components/ui/card'
import { useAddPlayer, useList } from '@/hooks/use-lists'
import { useToast } from '@/hooks/use-toast'
import { useHistoryStore } from '@/stores/history-store'

interface ListDetailPageProps {
  params: Promise<{ listId: string }>
}

export default function ListDetailPage(props: ListDetailPageProps) {
  const params = use(props.params)
  const { listId } = params
  const { toast } = useToast()
  const { data, isLoading, isError, error } = useList(listId)
  const addPlayer = useAddPlayer(listId)

  const addedSet = useMemo(
    () => new Set((data?.players ?? []).map((p) => p.player_id)),
    [data?.players],
  )

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
    return <p className="text-sm text-text-secondary">Loading list…</p>
  }

  if (isError || !data) {
    return (
      <Card className="border-bg-elevated-2 bg-bg-elevated">
        <CardContent className="p-6 text-sm text-destructive">
          {(error as Error)?.message ?? 'List not found.'}
        </CardContent>
      </Card>
    )
  }

  // Server-authoritative — avoids the client auth race that hid the sidebar.
  const isOwner = data.is_owner

  const handleAdd = (playerId: string) => {
    addPlayer.mutate(playerId, {
      onError: (err) =>
        toast({
          title: 'Could not add',
          description: err.message,
          variant: 'destructive',
        }),
    })
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] gap-4">
      <div className="min-w-0 flex-1 space-y-10 px-2 pb-6 lg:px-3">
        <ListDetailView list={data} isOwner={isOwner} />
        <CommentsThread
          listId={data.id}
          ownerId={data.owner_id}
          commentsEnabled={data.comments_enabled ?? true}
        />
      </div>

      {isOwner && (
        <aside className="sticky top-4 hidden h-[calc(100vh-6.5rem)] w-auto shrink-0 self-start py-0 lg:flex">
          <ListDetailSidebar
            scoring="ppr"
            added={addedSet}
            onAddPlayer={handleAdd}
            positionFilter={data.position_filter}
          />
        </aside>
      )}
    </div>
  )
}
