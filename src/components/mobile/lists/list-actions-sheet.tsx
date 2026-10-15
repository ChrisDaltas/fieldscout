'use client'

import * as React from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import { useComments } from '@/hooks/use-comments'
import { useDeleteList, useDuplicateList, useToggleFavorite, useUpdateList, type ListWithDetails } from '@/hooks/use-lists'
import { toast } from '@/hooks/use-toast'
import { featureFlags } from '@/lib/feature-flags'

import { AttachLeagueSheet } from './attach-league-sheet'
import { CommentsSheet } from './comments-sheet'
import { FolderPickSheet, SheetRow } from './folder-sheets'
import { LIcon } from './lists-parts'

/**
 * FieldScout Mobile — a list's options (the List view's "⋯" on the cover).
 *
 * The design's List view has only Back and Edit; everything here is an app list
 * feature the design lacks, kept reachable in its row language (the brief:
 * delete nothing): Edit details, visibility, pin / save, folders, attach to a
 * league (leagues test cohort), comments, copy link, duplicate, delete (to the
 * trash, restorable). Every action is the desktop panel's own mutation.
 */
export function ListActionsSheet({
  open,
  onOpenChange,
  list,
  ownerUsername,
  canEdit,
  viewer,
  onEditDetails,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: ListWithDetails
  ownerUsername: string | null
  canEdit: boolean
  viewer: { username: string | null; avatarUrl: string | null }
  onEditDetails: () => void
  onDeleted: () => void
}) {
  const update = useUpdateList(list.id)
  const favorite = useToggleFavorite()
  const duplicate = useDuplicateList()
  const remove = useDeleteList()
  const comments = useComments(open ? list.id : undefined)
  const [folderOpen, setFolderOpen] = React.useState(false)
  const [commentsOpen, setCommentsOpen] = React.useState(false)
  const [attachOpen, setAttachOpen] = React.useState(false)

  const then = (next: () => void) => () => {
    onOpenChange(false)
    next()
  }

  const owned = list.is_owner
  const commentCount = comments.data?.pagination.total

  return (
    <>
      <MobileSheet bodyClassName="leading-[normal] tabular-nums" open={open} onOpenChange={onOpenChange} title="List options" subtitle={list.title} showClose>
        <div className="flex flex-col px-3 pb-2">
          {canEdit && (
            <SheetRow icon={<LIcon name="edit" size={15} />} label="Edit details" onClick={then(onEditDetails)} />
          )}
          {canEdit && (
            <SheetRow
              icon={<LIcon name={list.is_private ? 'globe' : 'lock'} size={15} />}
              label={list.is_private ? 'Make public' : 'Make private'}
              sub={list.is_private ? 'Private' : 'Public'}
              onClick={then(() =>
                update.mutate(
                  { is_private: !list.is_private },
                  {
                    onSuccess: () => toast({ title: list.is_private ? 'List is public' : 'List is private' }),
                    onError: (error) => toast({ title: 'Could not change visibility', description: error.message }),
                  },
                ),
              )}
            />
          )}
          <SheetRow
            icon={<LIcon name="pin" size={15} />}
            label={owned ? (list.is_favorited ? 'Unpin' : 'Pin') : list.is_favorited ? 'Remove from Saved' : 'Save list'}
            onClick={then(() =>
              favorite.mutate(list.id, {
                onSuccess: (result) =>
                  toast({
                    title: owned
                      ? result.is_favorited
                        ? 'Pinned'
                        : 'Unpinned'
                      : result.is_favorited
                        ? 'Saved'
                        : 'Removed from Saved',
                    description: list.title,
                  }),
                onError: (error) => toast({ title: 'Could not update the list', description: error.message }),
              }),
            )}
          />
          {canEdit && (
            <SheetRow icon={<LIcon name="folder" size={15} />} label="Move to folder" onClick={then(() => setFolderOpen(true))} />
          )}
          {featureFlags.leagues && owned && (
            <SheetRow icon={<LIcon name="league" size={15} />} label="Attach to league" onClick={then(() => setAttachOpen(true))} />
          )}
          <SheetRow
            icon={<MIcon name="chat" size={15} />}
            label="Comments"
            sub={typeof commentCount === 'number' ? String(commentCount) : undefined}
            onClick={then(() => setCommentsOpen(true))}
          />
          <SheetRow
            icon={<LIcon name="share" size={15} />}
            label="Copy link"
            onClick={then(() => {
              const username = ownerUsername ?? viewer.username ?? 'you'
              const link = `${window.location.origin}/u/${username}/lists/${list.slug}`
              void navigator.clipboard
                ?.writeText(link)
                .then(() => toast({ title: 'Link copied', description: link }))
                .catch(() => toast({ title: 'Could not copy the link', description: link }))
            })}
          />
          <SheetRow
            icon={<LIcon name="copy" size={15} />}
            label="Duplicate"
            onClick={then(() =>
              duplicate.mutate(list.id, {
                onSuccess: (copy) => toast({ title: `“${copy.title}” created` }),
                onError: (error) => toast({ title: 'Could not duplicate the list', description: error.message }),
              }),
            )}
          />
          {canEdit && !list.is_favorites && (
            <SheetRow
              tone="danger"
              icon={<LIcon name="trash" size={15} />}
              label="Delete list"
              onClick={then(() =>
                remove.mutate(list.id, {
                  onSuccess: () => {
                    toast({ title: `“${list.title}” moved to trash` })
                    onDeleted()
                  },
                  onError: (error) => toast({ title: 'Could not delete the list', description: error.message }),
                }),
              )}
            />
          )}
        </div>
      </MobileSheet>

      <FolderPickSheet open={folderOpen} onOpenChange={setFolderOpen} list={list} />
      <CommentsSheet
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        listId={list.id}
        enabled={list.comments_enabled ?? true}
        viewer={viewer}
      />
      {featureFlags.leagues && owned && (
        <AttachLeagueSheet open={attachOpen} onOpenChange={setAttachOpen} list={{ id: list.id, title: list.title }} />
      )}
    </>
  )
}
