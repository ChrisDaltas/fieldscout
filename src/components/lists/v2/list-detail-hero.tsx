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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ListWithDetails } from '@/hooks/use-lists'
import { cn } from '@/lib/utils'

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
 */

export interface HeroOwner {
  username: string
  avatarUrl: string | null
}

interface HeroProps {
  list: ListWithDetails
  owner: HeroOwner
  canEdit: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
  onRename: (title: string) => void
  onShare: () => void
  onDuplicate: () => void
  onSetPrivate: (isPrivate: boolean) => void
  onClearDrafted: () => void
  onDelete: () => void
}

export function ListDetailHero({
  list,
  owner,
  canEdit,
  expanded,
  onToggleExpanded,
  onClose,
  onRename,
  onShare,
  onDuplicate,
  onSetPrivate,
  onClearDrafted,
  onDelete,
}: HeroProps) {
  const [renaming, setRenaming] = React.useState(false)
  const [draft, setDraft] = React.useState(list.title)

  React.useEffect(() => {
    setDraft(list.title)
    setRenaming(false)
  }, [list.id, list.title])

  const save = () => {
    const next = draft.trim()
    if (next && next !== list.title) onRename(next)
    setRenaming(false)
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      {/* 64px in the handoff → 51 at this app's ×0.8 scale. */}
      <ListCoverTile list={list} size={51} />

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
            <h3 className="text-[16px] font-bold leading-tight tracking-[-0.01em]">
              {list.title}
            </h3>
            {canEdit && (
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

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
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

        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn('inline-flex')}>
              <Button variant="stroke" size="icon-sm" disabled title="Pop out into a window">
                <Icon name="arrow-up-right" size={13} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Pop-out windows are a later task — not built yet.
          </TooltipContent>
        </Tooltip>

        <Button variant="stroke" size="icon-sm" onClick={onClose} title="Close list">
          <Icon name="close" size={13} />
        </Button>
      </div>
    </div>
  )
}
