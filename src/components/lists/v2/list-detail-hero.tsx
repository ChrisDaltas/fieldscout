'use client'

import * as React from 'react'

import { offersDuplicate } from '@/components/mobile/community/community-ops'
import { ReportMenuItem } from '@/components/report/report-dialog'
import { UsernameLink } from '@/components/shared/username-link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ListWithDetails } from '@/hooks/use-lists'
import { isNumbered } from '@/lib/lists/ranking-mode'
import type { ListFolder } from '@/types/database'

import { ListCoverTile } from './cover-tile'
import { formatCreated } from './list-stats'

/**
 * Lists v2 — the list hero.
 *
 * `screens/list-rail-list-view.png`: cover tile, name with a rename pencil that
 * fades in on hover (owner only), a byline of avatar + `@handle` +
 * `created Aug 8` + `· N players`, and the action cluster on the right —
 * **Share**, then dots, expand, pop out, close.
 *
 * v7 restyle (FieldScout Next v7, "One list"): the name is the 24px page
 * title, the byline is v7's 11px grey meta line, and Share is a v7 secondary
 * pill (`stroke`, size `sm`) — the old lime override is gone.
 *
 * ## Two surfaces, one hero (LV.6)
 *
 * The public share view (`/u/[username]/lists/[slug]`) renders the same cover,
 * the same name and the same byline — and a completely different right-hand
 * cluster, because **expand / pop out / close are affordances of the app's
 * panel and there is no panel on a standalone page**. So the identity half
 * lives in {@link ListHeroShell} with the cluster as a slot, and
 * {@link ListDetailHero} is that shell plus the panel's own buttons. Copying
 * the hero for the public page instead would have forked the byline, the
 * rename affordance and the cover in one move.
 */

export interface HeroOwner {
  username: string
  avatarUrl: string | null
}

interface HeroShellProps {
  list: ListWithDetails
  owner: HeroOwner
  /** Inline rename (owner only). Without `onRename` the pencil never renders. */
  canRename: boolean
  onRename?: (title: string) => void
  /**
   * Heading level for the list name. `h3` inside the app panel, where the page
   * already owns the `h1`; `h1` on the public share page, where the list name
   * *is* the page's subject and an SEO-critical route (plan **D7**) must say so.
   */
  heading?: 'h1' | 'h3'
  /** The right-hand action cluster. Entirely surface-specific. */
  actions: React.ReactNode
  /**
   * A control at the end of the byline, beside the author — Community's
   * Follow on someone else's list (plan C5). Absent everywhere else.
   */
  bylineAction?: React.ReactNode
}

/**
 * Cover + name + byline + an action slot. The half of the hero that is the
 * same whoever is looking.
 */
export function ListHeroShell({
  list,
  owner,
  canRename,
  onRename,
  heading = 'h3',
  actions,
  bylineAction,
}: HeroShellProps) {
  const [renaming, setRenaming] = React.useState(false)
  const [draft, setDraft] = React.useState(list.title)
  const renameable = canRename && Boolean(onRename)
  const Heading = heading

  React.useEffect(() => {
    setDraft(list.title)
    setRenaming(false)
  }, [list.id, list.title])

  const save = () => {
    const next = draft.trim()
    if (next && next !== list.title) onRename?.(next)
    setRenaming(false)
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <ListCoverTile
        list={list}
        // The detail route returns the whole list, so the hero's headshots come
        // straight off it rather than from the collection's `first_players`.
        players={list.players.slice(0, 3).map((entry) => entry.player)}
        size={51}
      />

      <div className="min-w-[180px] flex-[1_1_240px]">
        {renaming ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') save()
                if (event.key === 'Escape') {
                  setDraft(list.title)
                  setRenaming(false)
                }
              }}
              aria-label="List name"
              className="h-btn max-w-[320px] flex-[1_1_200px] text-[17px] font-bold"
            />
            <Button variant="blue" size="sm" onClick={save}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(list.title)
                setRenaming(false)
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="group/name inline-flex flex-wrap items-center gap-1.5">
            <Heading className="text-[24px] font-bold leading-[28px] tracking-[-0.03em] text-ink">
              {list.title}
            </Heading>
            {renameable && (
              <button
                type="button"
                title="Rename"
                onClick={() => setRenaming(true)}
                className="inline-flex h-btn-sm w-btn-sm items-center justify-center rounded-pill text-n-3 opacity-0 transition-[opacity,background-color,color] hover:bg-surface-hover hover:text-ink focus-visible:opacity-100 group-hover/name:opacity-100"
              >
                <Icon name="edit" size={12} />
              </button>
            )}
          </div>
        )}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <UserAvatar
            src={owner.avatarUrl}
            name={owner.username}
            className="h-[17px] w-[17px]"
            fallbackClassName="text-[8px]"
          />
          <UsernameLink username={owner.username} className="text-[11px] font-semibold text-ink" />
          <span className="whitespace-nowrap text-[11px] font-semibold text-n-6">
            created {formatCreated(list.created_at)}
          </span>
          <span className="whitespace-nowrap text-[11px] font-semibold text-n-6">
            · {list.players.length} {list.players.length === 1 ? 'player' : 'players'}
          </span>
          {bylineAction}
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-[5px]">{actions}</div>
    </div>
  )
}

interface HeroProps {
  list: ListWithDetails
  owner: HeroOwner
  canEdit: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
  /**
   * Lift this list into a floating window (LV.17). The panel wires it to
   * `list-windows-store`'s `open`; the hero stays presentational, like every
   * other action in this cluster.
   */
  onPopOut: () => void
  onRename: (title: string) => void
  onShare: () => void
  /** Duplicate — a list copy, a plain list's only: a ranking (the season
   *  board, a weekly board, an AI expert's board) has no Duplicate item at
   *  all (Chris, 2026-10-19; `offersDuplicate`). */
  onDuplicate: () => void
  onSetPrivate: (isPrivate: boolean) => void
  /**
   * Comments on / off — the owner's switch (Community launch plan C1), the
   * item beside Visibility. Handler-gated like the rename pencil: the panel
   * passes it only to the list's owner.
   */
  onSetCommentsEnabled?: (enabled: boolean) => void
  /**
   * The Ranked switch — **Numbers → Ranked / Unranked** (one numbering rule,
   * Chris 2026-10-16: a Basic list shows no 1-2-3 on desktop either, so the
   * owner needs a way to turn them back on after create, as the phone
   * editor's Ranked switch does). Handler-gated: the panel passes it only to
   * an owner, and never for the Big Board, which is always ranked.
   */
  onSetNumbered?: (numbered: boolean) => void
  onClearDrafted: () => void
  onDelete: () => void
  /**
   * Pin / unpin (LV.7). `list-card.tsx` was `useToggleFavorite`'s **only**
   * consumer, so without this there would be no way to pin or unpin a list
   * anywhere in the signed-in app — only `PinListButton` on the public share
   * page would survive, and unpinning your own saved list would mean finding its
   * public URL first.
   */
  onTogglePin: () => void
  /**
   * Folders (LV.7, ruled by Chris 2026-08-11 — *"Folders yes keep folders"*).
   * The design package defines no folders screen, so the **existing** gesture is
   * carried across rather than a new one designed: the same submenu the retired
   * `list-card.tsx` carried, over the same `useMoveListToFolder`. Empty list of
   * folders → no submenu, exactly as before.
   */
  folders: ListFolder[]
  onMoveToFolder: (folderId: string | null) => void
  /**
   * "Attach to league" (M2 L.B4.2 — spec §7.4's list-side entry point).
   * Optional and handler-gated like the rename pencil: the panel passes it
   * only when the leagues flag is on AND the viewer owns the list (attach
   * requires ownership), so the item never renders where it can't work.
   */
  onAttachToLeague?: () => void
  /**
   * Report (Community launch plan C10) — someone else's list only, on the
   * Community switch. Handler-gated like the rest: the panel passes it only
   * when the viewer may report this list; `reported` turns the item into
   * "Reported" once the database has answered.
   */
  report?: { reported: boolean; onReport: () => void }
}

export function ListDetailHero({
  list,
  owner,
  canEdit,
  expanded,
  onToggleExpanded,
  onClose,
  onPopOut,
  onRename,
  onShare,
  onDuplicate,
  onSetPrivate,
  onSetCommentsEnabled,
  onSetNumbered,
  onClearDrafted,
  onDelete,
  onTogglePin,
  folders,
  onMoveToFolder,
  onAttachToLeague,
  report,
}: HeroProps) {
  const numbered = isNumbered(list.ranking_mode)
  const commentsOn = list.comments_enabled ?? true
  return (
    <ListHeroShell
      list={list}
      owner={owner}
      canRename={canEdit}
      onRename={onRename}
      actions={
        <>
          <Button variant="stroke" size="sm" onClick={onShare}>
            <Icon name="send" size={11} /> Share
          </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="List options">
              <Icon name="dots" size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[184px]">
            {canEdit && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="eye" size={13} />
                  Visibility
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onSetPrivate(true)}>
                    <Icon name={list.is_private ? 'check' : 'eye-off'} size={13} />
                    Private
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onSetPrivate(false)}>
                    <Icon name={list.is_private ? 'team' : 'check'} size={13} />
                    Public
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {onSetCommentsEnabled && (
              // Off hides the thread from everyone but the owner and takes
              // the comment box away; On brings both back.
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-comments-switch>
                  <Icon name="comments" size={13} />
                  Comments
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onSetCommentsEnabled(true)}>
                    <Icon name={commentsOn ? 'check' : 'comments'} size={13} />
                    On
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onSetCommentsEnabled(false)}>
                    <Icon name={commentsOn ? 'close' : 'check'} size={13} />
                    Off
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {onSetNumbered && (
              // Ranked = the 1-2-3 numbers; Unranked = the same order without
              // them. Tiers are their own switch (the grouping control) and
              // stay as they are.
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="level" size={13} />
                  Numbers
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem onSelect={() => onSetNumbered(true)}>
                    <Icon name={numbered ? 'check' : 'level'} size={13} />
                    Ranked
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onSetNumbered(false)}>
                    <Icon name={numbered ? 'list' : 'check'} size={13} />
                    Unranked
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuItem onSelect={onTogglePin}>
              <Icon name="marker" size={13} />
              {list.is_favorited ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            {canEdit && folders.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Icon name="folder" size={13} />
                  Move to folder
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {folders.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      disabled={list.folder_id === folder.id}
                      onSelect={() => onMoveToFolder(folder.id)}
                    >
                      {folder.name}
                    </DropdownMenuItem>
                  ))}
                  {list.folder_id && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => onMoveToFolder(null)}>
                        Remove from folder
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {onAttachToLeague && (
              // §7.4 (M2 L.B4.2): the list-side "Attach to league" entry —
              // handler-gated, see the prop's doc for when the panel passes it.
              <DropdownMenuItem onSelect={onAttachToLeague}>
                <Icon name="cup" size={13} />
                Attach to league
              </DropdownMenuItem>
            )}
            {offersDuplicate(list) && (
              <DropdownMenuItem onSelect={onDuplicate}>
                <Icon name="layers" size={13} />
                Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onClearDrafted}>
              <Icon name="reset" size={13} />
              Clear drafted
            </DropdownMenuItem>
            {report && (
              <>
                <DropdownMenuSeparator />
                <ReportMenuItem type="list" reported={report.reported} onSelect={report.onReport} />
              </>
            )}
            {/* Favorites is permanent: the item is omitted, not disabled. */}
            {canEdit && !list.is_favorites && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Icon name="remove" size={13} />
                  Delete list
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleExpanded}
          title={expanded ? 'Minimize' : 'Expand to full width'}
        >
          <Icon name={expanded ? 'collapse' : 'expand'} size={13} />
        </Button>

        {/* Pop out (LV.17) — the design LAW's cluster order is Share → dots →
            expand → **pop out** → close, and this is the position it has always
            occupied; LV.15 shipped it disabled behind a tooltip saying so,
            because nothing rendered a window yet. The panel stays open behind
            the window deliberately: the prototype does the same
            (`ListsScreen.jsx`:230 calls `st.popout` and touches `st.openId`
            not at all), and the two surfaces cannot disagree — one
            `useDraftMode(listId)` cache, one `list-display-store` entry. */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPopOut}
          title="Pop out into a window"
        >
          <Icon name="arrow-up-right" size={13} />
        </Button>

        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close list">
          <Icon name="close" size={13} />
        </Button>
        </>
      }
    />
  )
}
