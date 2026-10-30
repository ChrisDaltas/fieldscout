'use client'

import { useDroppable } from '@dnd-kit/core'
import * as React from 'react'

import { AttachListToLeagueModal } from '@/components/leagues/attach-list-modal'
import { AiBuildBanner } from '@/components/lists/ai-build-banner'
import { commentControlsOn } from '@/components/lists/comment-menu-ops'
import { toastMovedToTrash } from '@/components/lists/trash-door'
import { ReportDialog } from '@/components/report/report-dialog'
import { reportAccess } from '@/components/report/report-ops'
import { Icon } from '@/components/ui/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAiListBuild } from '@/hooks/use-ai-list-build'
import { useAuth } from '@/hooks/use-auth'
import { useToast } from '@/hooks/use-toast'
import { useComments } from '@/hooks/use-comments'
import { useDraftMode } from '@/hooks/use-draft-mode'
import { useFolders, useMoveListToFolder } from '@/hooks/use-folders'
import {
  useAddLink,
  useAddPlayer,
  useDeleteList,
  useDuplicateList,
  useList,
  useRemoveLink,
  useRemovePlayer,
  useToggleFavorite,
  useUpdateList,
  type ListPlayerWithPlayer,
  type ListWithTags,
} from '@/hooks/use-lists'
import { featureFlags } from '@/lib/feature-flags'
import {
  groupingWrite,
  isNumbered,
  isTierOnlyUnavailableResponse,
  numbersWrite,
} from '@/lib/lists/ranking-mode'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useListWindowsStore } from '@/stores/list-windows-store'
import { useReportedStore, wasReported } from '@/stores/reported-store'
import { openPlayer as openPlayerView } from '@/hooks/use-open-player'
import {
  colsForView,
  resolveOrg,
  useListDisplay,
  useListDisplayStore,
  type ListOrg,
} from '@/stores/list-display-store'

import { buildBuckets, type Bucket } from './list-buckets'
import { EmptyListState } from './list-row-parts'
import { ListBody, type RowHandlers } from './list-body'
import { useListDropCommit } from './use-list-drop'
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
 *
 * **Because it is the whole open list, it is also where the AI build show runs
 * (LV.5).** The legacy detail page mounts `AiBuildBanner` and `useAiListBuild`;
 * this file did not, so behind `featureFlags.listsV2` a queued build was never
 * claimed and narrated nothing. Two rules carried across from that page:
 *
 * 1. **The banner renders in every state of the panel**, including the loading
 *    skeleton — the user arrives here straight from the dialog, before the
 *    detail query has landed, and an unexplained empty frame is the worst
 *    moment to say nothing. That is why it is a `PanelShell` prop.
 * 2. **The list is read-only while the AI owns it**, so the user cannot fight
 *    the build over the order mid-show (legacy: `data.is_owner &&
 *    !aiBuild.building`).
 *
 * ## What LV.7 carried here from the retired detail page
 *
 * The panel *is* the detail view now, so four live behaviours that lived on
 * `list-detail-view.tsx` moved onto it rather than being lost with it
 * (PROGRESS §3 Q3, ruled by Chris 2026-08-11 — *"all four survive"*):
 *
 * * **A drop zone for players dragged from the right rail.** The rail makes
 *   every row a `kind: 'players'` draggable (`layout/rail/players-panel.tsx`);
 *   the retired view held the only `list-drop:` droppable left in the app.
 * * **The Recently-viewed push** — nothing had recorded a list view behind the
 *   flag since LV.1.1, because only the legacy `[listId]` route did it.
 * * **Pin / unpin**, whose only consumer was `list-card.tsx`.
 * * **Move to folder**, whose only consumer was the same card's submenu.
 */

type DetailTab = 'list' | 'details' | 'comments'

/**
 * Set the first time this page load hears the server answer a tier-only save
 * with "Tiers without numbers is coming in the next update" (409
 * `TIER_ONLY_UNAVAILABLE` — migration 191 not pushed yet). From then on a Tier
 * pick on a Basic list stays session-only and the note is not repeated; it
 * lives for the page load, across lists, and a reload asks again.
 */
let tierOnlyUnavailable = false

interface DetailPanelProps {
  listId: string
  /** Row from the collection, used to render the hero before the detail lands. */
  summary: ListWithTags | undefined
  viewer: { username: string | null; avatarUrl: string | null }
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
  onDeleted: () => void
  /** Open on the Comments tab — "@x commented on your list" asked for it
   *  (`LIST_COMMENTS_PARAM`). `onCommentsShown` says it's done, so the
   *  request is spent and a later visit to the list opens on List. */
  openComments?: boolean
  onCommentsShown?: () => void
}

export function ListDetailPanel({
  listId,
  summary,
  viewer,
  expanded,
  onToggleExpanded,
  onClose,
  onDeleted,
  openComments = false,
  onCommentsShown,
}: DetailPanelProps) {
  const { toast } = useToast()
  const [tab, setTab] = React.useState<DetailTab>('list')
  const [addOpen, setAddOpen] = React.useState(false)
  // §7.4 (M2 L.B4.2): the list-side "Attach to league" flow.
  const [attachOpen, setAttachOpen] = React.useState(false)
  // Report (C10) — someone else's list (a saved one).
  const [reportOpen, setReportOpen] = React.useState(false)
  const { user } = useAuth()
  const reportedMarks = useReportedStore((state) => state.reported)

  const detail = useList(listId)
  const comments = useComments(listId)
  const updateList = useUpdateList(listId)
  const duplicateList = useDuplicateList()
  const deleteList = useDeleteList()
  const addPlayer = useAddPlayer(listId)
  const removePlayer = useRemovePlayer(listId)
  const addLink = useAddLink(listId)
  const removeLink = useRemoveLink(listId)
  const toggleFavorite = useToggleFavorite()
  const moveToFolder = useMoveListToFolder()
  const folders = useFolders()
  const { drafted, toggleDrafted, clearDrafted } = useDraftMode(listId)
  const popOut = useListWindowsStore((state) => state.open)
  const pushHistory = useHistoryStore((state) => state.push)
  // Claims a queued job for THIS list and runs the generate → add → order
  // sequence. Returns a null job for every other list, so only the panel
  // showing the list being built ever starts the loop.
  const aiBuild = useAiListBuild(listId)

  const display = useListDisplay(listId)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const setView = useListDisplayStore((state) => state.setView)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const setBandLabel = useListDisplayStore((state) => state.setBandLabel)
  const setBudget = useListDisplayStore((state) => state.setBudget)

  React.useEffect(() => {
    setTab('list')
  }, [listId])
  // After the reset above (effects run in order), so a list opened from the
  // alert lands on Comments.
  React.useEffect(() => {
    if (!openComments) return
    setTab('comments')
    onCommentsShown?.()
  }, [openComments, listId, onCommentsShown])

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

  // Read-only while the AI owns the list (LV.5) — the same guard the legacy
  // page applies. Drag-and-drop, Add players, rename, the drafted checkbox and
  // the row menu all key off this one flag.
  const canEdit = Boolean(list?.is_owner) && !aiBuild.building

  /**
   * The drop target for players dragged out of the right rail (LV.7).
   *
   * The id shape is the one `app-dnd-context.tsx` already parses —
   * `list-drop:detail:<listId>`, read with `overId.split(':').pop()` — so this
   * needs no change to the app-level handler at all. It has to be registered
   * **here**, on the panel shell, and not inside `ListBody`: the body mounts its
   * own nested `DndContext` for the LV.4 gap model, and a `useDroppable` under
   * that would register with the nested context, which the rail's drag never
   * enters.
   */
  const playerDrop = useDroppable({ id: `list-drop:detail:${listId}`, disabled: !canEdit })
  const railDragOver =
    playerDrop.isOver &&
    (playerDrop.active?.data.current as { kind?: string } | undefined)?.kind === 'players'

  /**
   * "Recently viewed" on Home (LV.7). Only the legacy `[listId]` route recorded
   * a list view, so behind the flag nothing had recorded one since LV.1.1. The
   * `href` stays `/app/lists/<id>`, which is a real, resolving URL — that route
   * now redirects into this panel with the list selected.
   */
  React.useEffect(() => {
    if (!list) return
    pushHistory({
      type: 'list',
      href: `/app/lists/${list.id}`,
      name: list.title,
      subtitle: `${list.player_count ?? list.players.length} players`,
      imageUrl: list.thumbnail_url ?? undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list?.id, list?.title, list?.player_count, list?.thumbnail_url, pushHistory])

  /**
   * Click a player's name → the floating mini card (D494, Chris 2026-10-05,
   * superseding D491), via `openPlayer`; its Expand opens the modal. On an
   * owned list both the card and the expanded modal offer Remove from list.
   */
  const openPlayer = React.useCallback(
    // D494: an owned list carries its context, so the card offers Remove.
    (entry: ListPlayerWithPlayer) =>
      openPlayerView(
        entry.player_id,
        undefined,
        list?.is_owner ? { listId: list.id, listTitle: list.title } : null,
      ),
    [list?.is_owner, list?.id, list?.title],
  )

  /**
   * Choosing a grouping is session-only (**D3**) — with one exception, and it is
   * a restoration rather than a new rule.
   *
   * The retired detail view carried a *List order / Tiers* control that wrote
   * `lists.ranking_mode`, and it was the **last writer of `rank_and_tier`
   * anywhere in the codebase**: `list-form-dialog.tsx` sends only `unranked` or
   * `ranked`, and `/api/lists` reaches `rank_and_tier` only from a
   * `tiers_enabled: true` payload nothing sends. Deleting that control without
   * putting the write somewhere would have meant **no list could ever be tiered
   * again** — `resolveOrg(null, …)` would answer `'rank'` forever — while the
   * create dialog goes on promising *"Numbered 1–N. Flip on the tiers view any
   * time."* (PROGRESS §3 Q3.)
   *
   * So the grouping control inherits that one write, and nothing more. Since
   * Chris's 2026-10-15 ruling ("allow tiers without numbers", migration 191)
   * the Tiers switch is independent of Ranked, so the write flips **only the
   * Tiers half** and keeps the list's numbering as it is (`withTiers`):
   *
   * * **Tier** turns tiers on — `ranked` → `rank_and_tier`, and a Basic
   *   (`unranked`) list → `tier_only`, tiers without numbers. (Before 191 a
   *   Basic list was written `rank_and_tier` here — Tiers turned Ranked on,
   *   the rule Chris's ruling removes.)
   * * **Rank** turns tiers off — `rank_and_tier` → `ranked`, `tier_only` →
   *   `unranked`. Nothing is ever numbered or un-numbered by this control.
   * * **Round / cost / budget** persist nothing. D4 makes them label sets over
   *   the same bucket mechanism, and cost/budget membership is computed — there
   *   is no `ranking_mode` value that means either.
   *
   * (`groupingWrite` in `@/lib/lists/ranking-mode` is that table.) Numbering
   * is the Ranked switch: chosen at create (Basic / Ranked), and flippable
   * from the list menu's Numbers choice (`setNumbered`, below) and the phone
   * editor.
   *
   * **Before 191 is pushed** a `tier_only` save answers 409 ("Tiers without
   * numbers is coming in the next update"). That is not a failure to shout
   * about: the grouping still shows as picked for the session, so it gets one
   * neutral note per page load — never the red "Could not save" — and later
   * Tier picks on a Basic list stay session-only without asking the server
   * again (`tierOnlyUnavailable`). A reload asks once more, which is how the
   * first pick after the push saves.
   *
   * The display store still never writes (its own header says a persist is "a
   * route call it makes *alongside* `setOrg`" — this is that call).
   */
  const chooseOrg = React.useCallback(
    (next: ListOrg) => {
      setOrg(listId, next)
      if (!canEdit || !list || list.is_big_board) return
      const persisted = groupingWrite(list.ranking_mode, next, { tierOnlyUnavailable })
      if (!persisted) return
      updateList.mutate(
        { ranking_mode: persisted },
        {
          onError: (error) => {
            if (isTierOnlyUnavailableResponse(error)) {
              // 191 isn't pushed yet: say so once, plainly, and stop asking.
              if (tierOnlyUnavailable) return
              tierOnlyUnavailable = true
              toast({
                title: 'Tiers without numbers is coming in the next update',
                description: 'This list shows in tiers for now. It isn’t saved that way yet.',
              })
              return
            }
            toast({
              title: 'Could not save the grouping',
              description: error.message,
              variant: 'destructive',
            })
          },
        },
      )
    },
    [canEdit, list, listId, setOrg, toast, updateList],
  )

  /**
   * The list menu's **Numbers → Ranked / Unranked** — the Ranked switch, the
   * same one the phone editor carries. Since the one numbering rule (Chris,
   * 2026-10-16) a Basic list shows no 1-2-3 on desktop either, so this is how
   * a desktop owner turns them back on (or off) after create. It flips only
   * the numbers (`numbersWrite` → `withNumbers`); tiers stay as they are.
   *
   * Unranked on a tiered list is tiers without numbers (`tier_only`), so
   * **before 191 is pushed** that save answers 409. Nothing changed, and the
   * owner asked for it outright, so every such pick gets the same neutral
   * "coming in the next update" note as the grouping control — never the red
   * "Could not save" — and once this page load has heard it, the server isn't
   * asked again (`tierOnlyUnavailable`).
   */
  const setNumbered = React.useCallback(
    (numbered: boolean) => {
      if (!canEdit || !list || list.is_big_board) return
      const next = numbersWrite(list.ranking_mode, numbered)
      if (!next) return
      const comingSoon = () =>
        toast({
          title: 'Tiers without numbers is coming in the next update',
          description: 'This list keeps its numbers for now.',
        })
      if (next === 'tier_only' && tierOnlyUnavailable) {
        comingSoon()
        return
      }
      updateList.mutate(
        { ranking_mode: next },
        {
          onError: (error) => {
            if (isTierOnlyUnavailableResponse(error)) {
              tierOnlyUnavailable = true
              comingSoon()
              return
            }
            toast({
              title: 'Could not save the numbers',
              description: error.message,
              variant: 'destructive',
            })
          },
        },
      )
    },
    [canEdit, list, toast, updateList],
  )

  const aiBanner = aiBuild.job ? (
    <AiBuildBanner job={aiBuild.job} onRetry={aiBuild.retry} onDismiss={aiBuild.dismiss} />
  ) : null

  /**
   * A drop landed (LV.4). The commit itself — the refusal toast, the two
   * sequenced writes and their rollbacks — **moved to `use-list-drop.ts` at
   * LV.16**, where the pop-out window reads the same one. It was this file's
   * `handleDrop` verbatim; the rules it carries are documented there.
   */
  const handleDrop = useListDropCommit({ listId, org, buckets, canEdit })

  const handlers: RowHandlers = {
    canEdit,
    // Signed in by construction — `/app/**` is behind auth — so a drafted mark
    // always has a `user_id` to hang on. The public share view is the surface
    // that passes `false` (LV.6).
    canMark: true,
    isDrafted: (playerId) => drafted.has(playerId),
    onToggleDrafted: (playerId) => toggleDrafted(playerId),
    onEditNote: () =>
      toast({
        title: 'Notes are read-only here',
        description: 'The note editor arrives with the rest of the row menu.',
      }),
    onRemove: (entry: ListPlayerWithPlayer) => removePlayer.mutate(entry.player_id),
    onOpenPlayer: openPlayer,
  }

  if (detail.isError) {
    return (
      <PanelShell banner={aiBanner} dropRef={playerDrop.setNodeRef} dropActive={railDragOver}>
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Icon name="info-circle" size={20} className="text-negative-strong" />
          <p className="text-[15px] font-bold tracking-[-0.02em] text-ink">
            This list could not be loaded.
          </p>
          <p className="max-w-[320px] text-[11px] font-medium text-n-6">
            {detail.error.message}
          </p>
        </div>
      </PanelShell>
    )
  }

  if (!list) {
    return (
      <PanelShell banner={aiBanner} dropRef={playerDrop.setNodeRef} dropActive={railDragOver}>
        <DetailSkeleton />
      </PanelShell>
    )
  }

  const owner: HeroOwner = summary?.owner
    ? { username: summary.owner.username, avatarUrl: summary.owner.avatar_url }
    : { username: viewer.username ?? 'you', avatarUrl: viewer.avatarUrl }

  const shareLink = `${window.location.origin}/u/${owner.username}/lists/${list.slug}`

  // Comments on / off (C1): the switch says what happened, or why it didn't.
  const setCommentsEnabled = (enabled: boolean) => {
    if ((list.comments_enabled ?? true) === enabled) return
    updateList.mutate(
      { comments_enabled: enabled },
      {
        onSuccess: () => toast({ title: enabled ? 'Comments are on' : 'Comments are off', description: list.title }),
        onError: (error) =>
          toast({ title: 'Couldn’t change comments', description: error.message, variant: 'destructive' }),
      },
    )
  }

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
    <PanelShell banner={aiBanner} dropRef={playerDrop.setNodeRef} dropActive={railDragOver}>
      <ListDetailHero
        list={list}
        owner={owner}
        canEdit={canEdit}
        expanded={expanded}
        onToggleExpanded={onToggleExpanded}
        onClose={onClose}
        // Pop out (LV.17). The store refocuses rather than duplicating, so a
        // second press on an already-open list brings its window to the front.
        onPopOut={() => popOut(list.id)}
        onRename={(title) => updateList.mutate({ title })}
        onShare={share}
        onDuplicate={() =>
          duplicateList.mutate(list.id, {
            onSuccess: (copy) => toast({ title: `“${copy.title}” created` }),
          })
        }
        onSetPrivate={(isPrivate) => updateList.mutate({ is_private: isPrivate })}
        // Comments on / off (C1, on the Community switch) — the owner's,
        // beside Visibility.
        onSetCommentsEnabled={canEdit && commentControlsOn() ? setCommentsEnabled : undefined}
        // The Ranked switch — owner only, and never the Big Board (always ranked).
        onSetNumbered={canEdit && !list.is_big_board ? setNumbered : undefined}
        onTogglePin={() =>
          toggleFavorite.mutate(list.id, {
            onSuccess: (result) =>
              toast({
                title: result.is_favorited ? 'Pinned' : 'Unpinned',
                description: list.title,
              }),
            onError: (error) =>
              toast({
                title: 'Could not update the pin',
                description: error.message,
                variant: 'destructive',
              }),
          })
        }
        folders={folders.data ?? []}
        onMoveToFolder={(folderId) =>
          moveToFolder.mutate(
            { listId: list.id, folderId },
            {
              onSuccess: () =>
                toast({
                  title: folderId ? 'Moved to folder' : 'Removed from folder',
                  description: list.title,
                }),
              onError: (error) =>
                toast({
                  title: 'Could not move the list',
                  description: error.message,
                  variant: 'destructive',
                }),
            },
          )
        }
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
              toastMovedToTrash(list.title)
              onDeleted()
            },
          })
        }
        // §7.4 (M2 L.B4.2): only when the leagues surface is on AND the
        // viewer owns the list (attach requires ownership — the §15.5 403).
        onAttachToLeague={
          featureFlags.leagues && list.is_owner ? () => setAttachOpen(true) : undefined
        }
        // Report (C10, on the Community switch) — someone else's list only,
        // never your own (prevent, don't refuse).
        report={
          !list.is_owner && reportAccess({ viewerId: user?.id, ownerId: list.owner_id }) === 'report'
            ? { reported: wasReported(reportedMarks, user?.id, 'list', list.id), onReport: () => setReportOpen(true) }
            : undefined
        }
      />

      {!list.is_owner && (
        <ReportDialog open={reportOpen} onOpenChange={setReportOpen} target={{ type: 'list', id: list.id }} quote={list.title} />
      )}

      <AttachListToLeagueModal
        open={attachOpen}
        onOpenChange={setAttachOpen}
        list={{ id: list.id, title: list.title }}
      />

      {/*
        The **label + count** variation of the shared control (`ui/tabs.tsx`),
        bare, per `screens/list-rail-list-view.png`.

        This one *is* a genuine tab set — each trigger owns a sibling panel —
        so it runs on Radix rather than on `Segment`. That is an upgrade, not a
        restyle: the hand-rolled buttons it replaces had no `tabpanel`
        association and no arrow-key navigation.
      */}
      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as DetailTab)}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-stretch gap-1 border-b border-n-4">
          <TabsList aria-label="List sections" className="flex-wrap">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="comments" count={comments.data?.pagination.total ?? null}>
              Comments
            </TabsTrigger>
          </TabsList>
          <span className="ml-auto flex items-center gap-1 pb-1.5 text-[10px] font-semibold text-n-6">
            <Icon name="eye" size={12} />
            <span className="fs-num">{formatCount(list.view_count)}</span>
          </span>
        </div>

        <TabsContent value="list" className="mt-0 flex flex-col gap-3">
          <ListToolbar
            org={org}
            onOrgChange={chooseOrg}
            numbered={isNumbered(list.ranking_mode)}
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
            <EmptyListState canEdit={canEdit} />
          ) : (
            <ListBody
              buckets={buckets}
              stats={stats}
              view={display.view}
              org={org}
              numbered={isNumbered(list.ranking_mode)}
              showBudgetShare={org === 'budget'}
              budget={display.budget}
              handlers={handlers}
              onRenameBand={(bandKey, label) => setBandLabel(listId, bandKey, label)}
              onAddToBucket={() => setAddOpen(true)}
              onDrop={handleDrop}
            />
          )}
        </TabsContent>

        <TabsContent value="details" className="mt-0">
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
        </TabsContent>

        <TabsContent value="comments" className="mt-0">
          <ListCommentsTab
            listId={listId}
            viewer={viewer}
            commentsEnabled={list.comments_enabled ?? true}
            listOwned={list.is_owner}
          />
        </TabsContent>
      </Tabs>
    </PanelShell>
  )
}

/**
 * `banner` is a slot rather than something the caller composes into `children`
 * so the AI build narration renders above the hero in **all three** panel
 * states — loaded, loading skeleton, and load error. The user arrives here from
 * the generate dialog while the detail query is still in flight, which is
 * precisely the state where saying nothing would be worst.
 */
function PanelShell({
  banner,
  dropRef,
  dropActive,
  children,
}: {
  banner?: React.ReactNode
  /** The app-level `list-drop:` droppable for rail drags (LV.7). */
  dropRef?: (element: HTMLElement | null) => void
  /** A `kind: 'players'` drag is over the panel right now. */
  dropActive?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      ref={dropRef}
      className={cn(
        // v7 card: hairline, 14px radius, no resting shadow.
        'flex flex-col gap-3 rounded-2xl border bg-white p-[17px]',
        // A drop target has to say it is one *while you are over it*, or the
        // gesture is a guess. This is an active drag state, not a resting
        // elevation, so it is a border/fill change — CLAUDE.md, "Elevation is a
        // hover state, never a resting one".
        dropActive ? 'border-accent bg-accent-soft' : 'border-n-4',
      )}
    >
      {banner}
      {children}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3" aria-busy="true" aria-label="Loading list">
      <div className="flex items-start gap-3">
        <div className="h-[51px] w-[51px] rounded-xl bg-surface-control" />
        <div className="flex flex-col gap-2">
          <div className="h-6 w-48 rounded-md bg-surface-control" />
          <div className="h-3 w-56 rounded-md bg-surface-control" />
        </div>
      </div>
      <div className="h-7 w-full rounded-md bg-surface-control" />
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="h-[34px] w-full rounded-md bg-surface-control" />
      ))}
    </div>
  )
}
