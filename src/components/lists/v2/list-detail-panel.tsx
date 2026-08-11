'use client'

import * as React from 'react'

import { Icon } from '@/components/ui/icon'
import { useToast } from '@/hooks/use-toast'
import { useComments } from '@/hooks/use-comments'
import { useDraftMode } from '@/hooks/use-draft-mode'
import {
  useAddLink,
  useAddPlayer,
  useDeleteList,
  useDuplicateList,
  useList,
  useRemoveLink,
  useRemovePlayer,
  useReorderPlayers,
  useSetPlayerTier,
  useUpdateList,
  type ListPlayerWithPlayer,
  type ListWithTags,
} from '@/hooks/use-lists'
import { cn } from '@/lib/utils'
import {
  colsForView,
  resolveOrg,
  useListDisplay,
  useListDisplayStore,
  type ListOrg,
} from '@/stores/list-display-store'

import { bucketDrop, buildBuckets, type Bucket } from './list-buckets'
import { ListBody, type RowHandlers } from './list-body'
import { planDrop, positionsFor, type DropTarget } from './list-reorder'
import { ListCommentsTab } from './list-comments-tab'
import { ListDetailHero, type HeroOwner } from './list-detail-hero'
import { ListDetailsTab } from './list-details-tab'
import { formatCount, resolveStats } from './list-stats'
import { AddPlayersPopover, ListToolbar } from './list-toolbar'

/**
 * Lists v2 — the open list.
 *
 * **This is the piece the previous attempt missed.** Rail mode is not a rail
 * plus a teaser: the right-hand panel carries the *complete* list — hero, tabs,
 * toolbar and rows (PROGRESS §7 gap 1, `screens/list-rail-list-view.png`). The
 * same panel is what Cards mode opens into.
 */

type DetailTab = 'list' | 'details' | 'comments'

interface DetailPanelProps {
  listId: string
  /** Row from the collection, used to render the hero before the detail lands. */
  summary: ListWithTags | undefined
  viewer: { username: string | null; avatarUrl: string | null }
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
  onDeleted: () => void
}

export function ListDetailPanel({
  listId,
  summary,
  viewer,
  expanded,
  onToggleExpanded,
  onClose,
  onDeleted,
}: DetailPanelProps) {
  const { toast } = useToast()
  const [tab, setTab] = React.useState<DetailTab>('list')
  const [addOpen, setAddOpen] = React.useState(false)

  const detail = useList(listId)
  const comments = useComments(listId)
  const updateList = useUpdateList(listId)
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const addPlayer = useAddPlayer(listId)
  const removePlayer = useRemovePlayer(listId)
  const addLink = useAddLink(listId)
  const removeLink = useRemoveLink(listId)
  const reorderPlayers = useReorderPlayers(listId)
  const setPlayerTier = useSetPlayerTier(listId)
  const { drafted, toggleDrafted, clearDrafted } = useDraftMode(listId)

  const display = useListDisplay(listId)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const setView = useListDisplayStore((state) => state.setView)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const setBandLabel = useListDisplayStore((state) => state.setBandLabel)
  const setBudget = useListDisplayStore((state) => state.setBudget)

  React.useEffect(() => {
    setTab('list')
  }, [listId])

  const list = detail.data
  const org: ListOrg = resolveOrg(display.org, list?.ranking_mode)
  const stats = React.useMemo(
    () => resolveStats(colsForView(display.cols, display.view)),
    [display.cols, display.view],
  )

  const buckets = React.useMemo<Bucket[]>(
    () =>
      buildBuckets({
        org,
        entries: list?.players ?? [],
        bandLabels: display.bandLabels,
        budget: display.budget,
      }),
    [org, list?.players, display.bandLabels, display.budget],
  )

  const canEdit = Boolean(list?.is_owner)

  /**
   * A drop landed (LV.4). Both writes go through routes that already exist —
   * `PATCH …/players/reorder` and `PATCH …/players/[playerId]/tier` — and both
   * of those hooks are already optimistic with a rollback in `onError`, which is
   * what CLAUDE.md asks for on list reordering.
   *
   * Two rules worth reading before changing anything here:
   *
   * 1. **A refused drop says so.** `bucketDrop` is the only thing that knows
   *    whether a section can be written; a round bucket cannot until LV.1.5
   *    widens `list_players_tier_check`, and a cost/budget band never can
   *    because it is computed from the player's auction value. Both surface the
   *    reason instead of no-oping (CLAUDE.md: never let "nothing happened" mean
   *    "it worked").
   * 2. **The two writes are sequenced, not fired together.** They patch the same
   *    React Query cache in `onMutate`; issued in the same tick, whichever reads
   *    the cache first can be overwritten by the other's snapshot. The bucket
   *    write goes first because it is the one that can be refused by the server,
   *    and the order write follows on its success.
   */
  const handleDrop = React.useCallback(
    (entryId: string, target: DropTarget) => {
      if (!canEdit) return

      const rule =
        target.kind === 'new'
          ? ({ ok: true, tier: target.tier } as const)
          : bucketDrop(org, target.bucketKey)

      if (!rule.ok) {
        toast({
          title: 'That section cannot be assigned',
          description: rule.reason,
          variant: 'destructive',
        })
        return
      }

      const plan = planDrop({ buckets, entryId, target, tier: rule.tier })
      // Dropped exactly where it started: no request, and nothing to announce.
      if (!plan) return

      const applyOrder = (order: string[]) =>
        reorderPlayers.mutate(positionsFor(order), {
          onError: (error) =>
            toast({
              title: 'Could not save the new order',
              description: error.message,
              variant: 'destructive',
            }),
        })

      if (plan.tier) {
        setPlayerTier.mutate(plan.tier, {
          onError: (error) =>
            toast({
              title: 'Could not move that player',
              description: error.message,
              variant: 'destructive',
            }),
          onSuccess: () => {
            if (plan.order) applyOrder(plan.order)
          },
        })
        return
      }

      if (plan.order) applyOrder(plan.order)
    },
    [buckets, canEdit, org, reorderPlayers, setPlayerTier, toast],
  )

  const handlers: RowHandlers = {
    canEdit,
    isDrafted: (playerId) => drafted.has(playerId),
    onToggleDrafted: (playerId) => toggleDrafted(playerId),
    onEditNote: () =>
      toast({
        title: 'Notes are read-only here',
        description: 'The note editor arrives with the rest of the row menu.',
      }),
    onRemove: (entry: ListPlayerWithPlayer) => removePlayer.mutate(entry.player_id),
  }

  if (detail.isError) {
    return (
      <PanelShell>
        <div className="flex flex-col items-center gap-2.5 py-12 text-center">
          <Icon name="info-circle" size={22} className="text-negative-strong" />
          <p className="text-[13px] font-bold">This list could not be loaded.</p>
          <p className="max-w-[320px] text-[11px] font-medium text-n-3">
            {detail.error.message}
          </p>
        </div>
      </PanelShell>
    )
  }

  if (!list) {
    return (
      <PanelShell>
        <DetailSkeleton />
      </PanelShell>
    )
  }

  const owner: HeroOwner = summary?.owner
    ? { username: summary.owner.username, avatarUrl: summary.owner.avatar_url }
    : { username: viewer.username ?? 'you', avatarUrl: viewer.avatarUrl }

  const shareLink = `${window.location.origin}/u/${owner.username}/lists/${list.slug}`

  const share = () => {
    void navigator.clipboard
      ?.writeText(shareLink)
      .then(() => toast({ title: 'Link copied', description: shareLink }))
      .catch(() =>
        toast({
          title: 'Could not copy the link',
          description: shareLink,
          variant: 'destructive',
        }),
      )
  }

  const addedIds = new Set(list.players.map((entry) => entry.player_id))

  return (
    <PanelShell>
      <ListDetailHero
        list={list}
        owner={owner}
        canEdit={canEdit}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onClose={onClose}
        onRename={(title) => updateList.mutate({ title })}
        onShare={share}
        onDuplicate={() =>
          duplicateList.mutate(list.id, {
            onSuccess: (copy) => toast({ title: `“${copy.title}” created` }),
          })
        }
        onSetPrivate={(isPrivate) => updateList.mutate({ is_private: isPrivate })}
        onClearDrafted={() => {
          // `clearDrafted` is guarded: it refuses when the marks were never
          // read, returns false, and raises its own toast saying which. Never
          // announce a clear that did not happen — and never add a second
          // message on top of the hook's own (plan/PROGRESS R201).
          if (clearDrafted()) toast({ title: 'Drafted marks cleared' })
        }}
        onDelete={() =>
          deleteList.mutate(list.id, {
            onSuccess: () => {
              toast({ title: `“${list.title}” moved to trash` })
              onDeleted()
            },
          })
        }
      />

      <div className="flex flex-wrap items-stretch gap-1 border-b border-ink">
        {(
          [
            { id: 'list', label: 'List', count: null },
            { id: 'details', label: 'Details', count: null },
            { id: 'comments', label: 'Comments', count: comments.data?.pagination.total ?? null },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={cn(
              'inline-flex h-tab items-center gap-1.5 rounded-sm px-3 text-[11px] font-bold transition-colors',
              tab === item.id
                ? 'bg-accent text-accent-foreground'
                : 'bg-transparent text-ink hover:bg-accent-soft',
            )}
          >
            {item.label}
            {item.count != null && (
              <span className="fs-num text-[10px] font-medium opacity-75">{item.count}</span>
            )}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 pb-1.5 text-[10px] font-medium text-n-3">
          <Icon name="eye" size={12} />
          <span className="fs-num">{formatCount(list.view_count)}</span>
        </span>
      </div>

      {tab === 'list' && (
        <>
          <ListToolbar
            org={org}
            onOrgChange={(next) => setOrg(listId, next)}
            view={display.view}
            onViewChange={(next) => setView(listId, next)}
            cols={display.cols}
            onToggleCol={(statId) => toggleCol(listId, statId)}
            budget={display.budget}
            onBudgetChange={(next) => setBudget(listId, next)}
            showBudget={org === 'budget'}
            canEdit={canEdit}
            onAddPlayers={
              <AddPlayersPopover
                open={addOpen}
                onOpenChange={setAddOpen}
                addedIds={addedIds}
                positionFilter={list.position_filter}
                onAdd={(player) => addPlayer.mutate(player.id)}
              />
            }
          />

          {list.players.length === 0 ? (
            <EmptyList canEdit={canEdit} />
          ) : (
            <ListBody
              buckets={buckets}
              stats={stats}
              view={display.view}
              org={org}
              showBudgetShare={org === 'budget'}
              budget={display.budget}
              handlers={handlers}
              onRenameBand={(bandKey, label) => setBandLabel(listId, bandKey, label)}
              onAddToBucket={() => setAddOpen(true)}
              onDrop={handleDrop}
            />
          )}
        </>
      )}

      {tab === 'details' && (
        <ListDetailsTab
          list={list}
          canEdit={canEdit}
          onSaveDescription={(description) => updateList.mutate({ description })}
          onSaveTags={(tags) => updateList.mutate({ tags })}
          // A rejected link must SAY why. The service answers with a specific
          // message for every refusal — bad scheme, duplicate, over the cap —
          // and swallowing it would leave the form looking like it worked
          // (CLAUDE.md: never let "nothing happened" mean "it worked").
          onAddLink={(input) =>
            addLink.mutate(input, {
              onError: (error) =>
                toast({
                  title: 'Could not attach that link',
                  description: error.message,
                  variant: 'destructive',
                }),
            })
          }
          onRemoveLink={(linkId) =>
            removeLink.mutate(linkId, {
              onError: (error) =>
                toast({
                  title: 'Could not remove that link',
                  description: error.message,
                  variant: 'destructive',
                }),
            })
          }
          linksBusy={addLink.isPending || removeLink.isPending}
        />
      )}

      {tab === 'comments' && <ListCommentsTab listId={listId} viewer={viewer} />}
    </PanelShell>
  )
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border border-ink bg-white p-[18px]">
      {children}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading list">
      <div className="flex items-start gap-3">
        <div className="h-[42px] w-[42px] rounded-sm bg-n-4" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-40 rounded-sm bg-n-4" />
          <div className="h-2.5 w-56 rounded-sm bg-n-4" />
        </div>
      </div>
      <div className="h-7 w-full rounded-sm bg-n-4" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="h-12 w-full rounded-sm bg-n-4" />
      ))}
    </div>
  )
}

function EmptyList({ canEdit }: { canEdit: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 border border-dashed border-ink px-6 py-10 text-center">
      <Icon name="list" size={20} className="text-n-3" />
      <p className="text-[13px] font-bold">No players on this list yet.</p>
      <p className="max-w-[300px] text-[11px] font-medium text-n-3">
        {canEdit
          ? 'Use Add players to search the pool and start building the board.'
          : 'The owner has not added anyone yet.'}
      </p>
    </div>
  )
}
