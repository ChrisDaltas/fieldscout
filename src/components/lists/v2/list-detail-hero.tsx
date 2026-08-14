'use client'

import * as React from 'react'
import Link from 'next/link'

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
import type { ListFolder } from '@/types/database'

import { ListCoverTile } from './cover-tile'
import { formatCreated } from './list-stats'

/**
 * Lists v2 — the list hero.
 *
 * `screens/list-rail-list-view.png`: cover tile, name with a rename pencil that
 * fades in on hover (owner only), a byline of avatar + `@handle` +
 * `created Aug 8` + `· N players`, and the action cluster on the right —
 * **Share** in brand lime, then dots, expand, pop out, close.
 *
 * The Share button is brand lime carrying ink text. `Button`'s `lime` variant
 * fills `brand-strong` (the deep green), so the fill is overridden here rather
 * than by minting a variant on the shared primitive.
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
      {/* 64px in the handoff → 51 at this app's ×0.8 scale. */}
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
              className="h-btn-md max-w-[320px] flex-[1_1_200px] text-[16px] font-bold"
            />
            <Button variant="blue" size="sm" shadow onClick={save}>
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
            <Heading className="text-[16px] font-bold leading-tight tracking-[-0.01em]">
              {list.title}
            </Heading>
            {renameable && (
              <button
                type="button"
                title="Rename"
                onClick={() => setRenaming(true)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-ink opacity-0 transition-opacity hover:bg-accent-soft focus-visible:opacity-100 group-hover/name:opacity-100"
              >
                <Icon name="edit" size={12} />
              </button>
            )}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <UserAvatar
            src={owner.avatarUrl}
            name={owner.username}
            className="h-[17px] w-[17px]"
            fallbackClassName="text-[8px]"
          />
          <Link
            href={`/u/${owner.username}`}
            className="text-[9.5px] font-bold text-ink underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
          >
            @{owner.username}
          </Link>
          <span className="whitespace-nowrap text-[9px] font-medium text-n-3">
            created {formatCreated(list.created_at)}
          </span>
          <span className="whitespace-nowrap text-[9px] font-medium text-n-3">
            · {list.players.length} {list.players.length === 1 ? 'player' : 'players'}
          </span>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
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
  onDuplicate: () => void
  onSetPrivate: (isPrivate: boolean) => void
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
  onClearDrafted,
  onDelete,
  onTogglePin,
  folders,
  onMoveToFolder,
  onAttachToLeague,
}: HeroProps) {
  return (
    <ListHeroShell
      list={list}
      owner={owner}
      canRename={canEdit}
      onRename={onRename}
      actions={
        <>
          <Button
          variant="lime"
          size="sm"
          shadow
          onClick={onShare}
          className="bg-brand hover:bg-brand"
        >
          <Icon name="send" size={13} /> Share
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="stroke" size="icon-sm" title="List options">
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
            <DropdownMenuItem onSelect={onDuplicate}>
              <Icon name="layers" size={13} />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onClearDrafted}>
              <Icon name="reset" size={13} />
              Clear drafted
            </DropdownMenuItem>
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
          variant="stroke"
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
          variant="stroke"
          size="icon-sm"
          onClick={onPopOut}
          title="Pop out into a window"
        >
          <Icon name="arrow-up-right" size={13} />
        </Button>

        <Button variant="stroke" size="icon-sm" onClick={onClose} title="Close list">
          <Icon name="close" size={13} />
        </Button>
        </>
      }
    />
  )
}
