'use client'

import * as React from 'react'

import { PinListButton } from '@/components/lists/pin-list-button'
import { ListBody, type RowHandlers } from '@/components/lists/v2/list-body'
import { buildBuckets, type Bucket } from '@/components/lists/v2/list-buckets'
import { ListCommentsTab } from '@/components/lists/v2/list-comments-tab'
import { ListHeroShell, type HeroOwner } from '@/components/lists/v2/list-detail-hero'
import { ListDetailsTab } from '@/components/lists/v2/list-details-tab'
import { EmptyListState } from '@/components/lists/v2/list-row-parts'
import { formatCount, resolveStats } from '@/components/lists/v2/list-stats'
import { ListToolbar } from '@/components/lists/v2/list-toolbar'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import type { ListWithDetails } from '@/hooks/use-lists'
import {
  colsForView,
  resolveOrg,
  useListDisplay,
  useListDisplayStore,
  type ListOrg,
} from '@/stores/list-display-store'

/**
 * The public share view — `/u/[username]/lists/[slug]` (LV.6).
 *
 * This is the only Lists surface that renders to a **stranger**, and the only
 * one that renders signed out. Its shape is the signed-in open list
 * (`lists/v2/list-detail-panel.tsx`) with everything a stranger cannot do
 * subtracted — not a second design. Every piece below is the same component the
 * app panel mounts: `ListHeroShell`, `ListToolbar`, `ListBody`,
 * `ListDetailsTab`, `ListCommentsTab`, `ui/tabs`. The design package defines no
 * dedicated share screen, so *derive and subtract* is the whole method, and the
 * subtractions are listed rather than left to be inferred from the diff.
 *
 * ## What a signed-out stranger does not get, and why
 *
 * | Removed entirely | Why |
 * | --- | --- |
 * | drag grips + reordering | `canEdit` is false and no `onDrop` is passed, so `ListBody` renders no grip at all — an inert dot column is furniture that lies about an affordance |
 * | the drafted checkbox + its menu item | a mark is a row in `list_player_drafted` keyed by `user_id` (LV.1.2) — it needs an account, and it is a *drafting* tool for your own board, not a reading control on someone else's |
 * | the row menu | with drafted, Add note and Remove all gone it had nothing left; `RowMenu` returns `null` rather than opening an empty popover |
 * | `Add players` | the one control on the toolbar that writes |
 * | inline rename | owner-only; the shell gets no `onRename`, so the pencil cannot render |
 * | the hero options menu | every item is owner-or-account: Visibility, Duplicate, Clear drafted, Delete |
 * | expand / pop out / close | affordances of the app's *panel*. There is no panel here to expand, pop out of, or close |
 * | `Add +` on a bucket header, and cost-band rename | write gestures; `ListBody` receives neither `onAddToBucket` nor `onRenameBand` |
 * | tag add/remove, description Edit, link attach/remove | `ListDetailsTab canEdit={false}` |
 * | the comment composer (signed out) | replaced by a sign-in link — a field that 401s on submit is the same lie as a drag that snaps back |
 *
 * | Kept, read-only | Why |
 * | --- | --- |
 * | grouping · view style · `Stats` | **display** state only. It never leaves the session (plan D3, `list-display-store`) and writes nothing, so a reader may look at someone else's board however they like. This is the line the toolbar is split on: display stays, writes go |
 * | attached links | LV.8/D8 — links are the author's attribution and their own video, published *with* the list. They render as `href`s (scheme-guarded twice) and cannot be edited |
 * | player notes | the author's own annotation about a player on their own public board, exactly like the description. Read-only, hover card only |
 * | tags, description, position mix | the Details tab, unedited |
 * | the comment thread | reading is public; posting needs an account and `comments_enabled` |
 * | `Pin` | the one write a stranger is offered, and it already existed with a signed-out sign-in CTA |
 * | `Share` | you are already at the link, but copying it is the gesture the hero is built around and it needs no account |
 *
 * ## Bucket keys are load-bearing here
 *
 * This page is server-rendered (plan **D7**), so a throw is an HTTP **500**, not
 * a blank component — and `list_players.tier` has stored `r1`–`r30` and `c1`–`c4`
 * since migration 081. The previous implementation seeded a `Map` with S–F and
 * did `map.get(key)!.push(...)`, which would have 500'd on the first
 * round-bucketed player (LV.1.5, PROGRESS §4). Grouping now goes through
 * `buildBuckets`, which is total over `string`: an unrecognised key lands in
 * Ungrouped and its colour comes from `bucketBandClass`, which is total too.
 * `public-share-view.test.ts` pins that with round, cost and garbage keys in
 * every grouping mode.
 */

interface PublicListViewProps {
  /**
   * The whole list, in the same shape `/api/lists/[id]` returns — built on the
   * server by the page so the rows are in the initial HTML (D7).
   */
  list: ListWithDetails
  owner: HeroOwner
  /** The signed-in viewer's own identity, for the comment composer's avatar. */
  viewer: { username: string | null; avatarUrl: string | null }
  /** Show the Pin button — true for any viewer who isn't the owner. */
  canPin: boolean
  signedIn: boolean
  initialPinned: boolean
  /**
   * Counted on the server so the tab badge is in the SSR HTML rather than
   * appearing a round-trip later.
   */
  commentCount: number
}

type DetailTab = 'list' | 'details' | 'comments'

export function PublicListView({
  list,
  owner,
  viewer,
  canPin,
  signedIn,
  initialPinned,
  commentCount,
}: PublicListViewProps) {
  const [tab, setTab] = React.useState<DetailTab>('list')

  const display = useListDisplay(list.id)
  const setOrg = useListDisplayStore((state) => state.setOrg)
  const setView = useListDisplayStore((state) => state.setView)
  const toggleCol = useListDisplayStore((state) => state.toggleCol)
  const setBudget = useListDisplayStore((state) => state.setBudget)

  const org: ListOrg = resolveOrg(display.org, list.ranking_mode)
  const stats = React.useMemo(
    () => resolveStats(colsForView(display.cols, display.view)),
    [display.cols, display.view],
  )

  const buckets = React.useMemo<Bucket[]>(
    () =>
      buildBuckets({
        org,
        entries: list.players,
        bandLabels: display.bandLabels,
        budget: display.budget,
      }),
    [org, list.players, display.bandLabels, display.budget],
  )

  /**
   * Read-only in both senses. `canEdit` and `canMark` are the two gates
   * `ListBody` keys every affordance off, and `isDrafted` answers `false` for
   * everyone because **this surface does not render drafted state at all** —
   * it is a per-viewer drafting mark, not a fact about the list.
   */
  const handlers: RowHandlers = {
    canEdit: false,
    canMark: false,
    isDrafted: () => false,
  }

  return (
    <article className="flex flex-col gap-3 border border-ink bg-white p-[18px]">
      <ListHeroShell
        list={list}
        owner={owner}
        canRename={false}
        heading="h1"
        actions={
          <>
            <ShareLinkButton />
            {canPin && (
              <PinListButton
                listId={list.id}
                initialPinned={initialPinned}
                signedIn={signedIn}
              />
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(next) => setTab(next as DetailTab)}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-stretch gap-1 border-b border-ink">
          <TabsList aria-label="List sections" className="flex-wrap">
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="comments" count={commentCount}>
              Comments
            </TabsTrigger>
          </TabsList>
          {/* The app panel shows views here. A shared list is also the social
              artifact, so likes ride alongside — the one addition this screen
              makes to the panel's tab row, and it is data the page already has. */}
          <span className="ml-auto flex items-center gap-2.5 pb-1.5 text-[10px] font-medium text-n-3">
            <span className="flex items-center gap-1.5">
              <Icon name="eye" size={12} />
              <span className="fs-num">{formatCount(list.view_count)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="like" size={12} />
              <span className="fs-num">{formatCount(list.like_count)}</span>
            </span>
          </span>
        </div>

        <TabsContent value="list" className="mt-0 flex flex-col gap-3">
          <ListToolbar
            org={org}
            onOrgChange={(next) => setOrg(list.id, next)}
            view={display.view}
            onViewChange={(next) => setView(list.id, next)}
            cols={display.cols}
            onToggleCol={(statId) => toggleCol(list.id, statId)}
            budget={display.budget}
            onBudgetChange={(next) => setBudget(list.id, next)}
            showBudget={org === 'budget'}
            // No `onAddPlayers` — see the subtraction table above.
            canEdit={false}
          />

          {list.players.length === 0 ? (
            <EmptyListState canEdit={false} />
          ) : (
            <ListBody
              buckets={buckets}
              stats={stats}
              view={display.view}
              org={org}
              showBudgetShare={org === 'budget'}
              budget={display.budget}
              handlers={handlers}
              // `onRenameBand`, `onAddToBucket` and `onDrop` are deliberately
              // absent rather than no-ops: their absence is what removes the
              // affordances, so a future edit cannot re-enable a control that
              // silently does nothing.
            />
          )}
        </TabsContent>

        <TabsContent value="details" className="mt-0">
          <ListDetailsTab list={list} canEdit={false} />
        </TabsContent>

        <TabsContent value="comments" className="mt-0">
          <ListCommentsTab
            listId={list.id}
            viewer={viewer}
            signedIn={signedIn}
            commentsEnabled={list.comments_enabled ?? true}
          />
        </TabsContent>
      </Tabs>
    </article>
  )
}

/**
 * Share — brand lime, the same button the app panel's hero carries, copying the
 * page's own address.
 *
 * `window` is read inside the handler and never during render, so this survives
 * the server pass that puts the list into the initial HTML.
 */
function ShareLinkButton() {
  const { toast } = useToast()

  const share = () => {
    const url = window.location.href
    void navigator.clipboard
      ?.writeText(url)
      .then(() => toast({ title: 'Link copied', description: url }))
      .catch(() =>
        toast({
          title: 'Could not copy the link',
          description: url,
          variant: 'destructive',
        }),
      )
  }

  return (
    <Button
      variant="lime"
      size="sm"
      shadow
      onClick={share}
      className="bg-brand hover:bg-brand"
    >
      <Icon name="send" size={13} /> Share
    </Button>
  )
}
