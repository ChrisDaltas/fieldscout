'use client'

import * as React from 'react'

import { MIcon } from '@/components/mobile/ui/m-icon'
import { MobileSheet } from '@/components/mobile/ui/mobile-sheet'
import {
  useCreateFolder,
  useDeleteFolder,
  useFolders,
  useMoveListToFolder,
  useUpdateFolder,
} from '@/hooks/use-folders'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type { ListFolder } from '@/types/database'
import { folderNameSchema } from '@/types/schemas/lists'

import { LIcon } from './lists-parts'

/**
 * FieldScout Mobile — Lists folders. Folders are an app feature the design
 * lacks (kept on Chris's 2026-08-11 ruling); on mobile they live in the grid's
 * chip row and in a list's options ("Move to folder"), drawn in the design's
 * sheet and row language. Same hooks and routes as the desktop folder dialog.
 */

/** Create a folder, or rename / delete one. */
export function FolderNameSheet({
  open,
  onOpenChange,
  folder,
  onCreated,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Rename mode when set. */
  folder?: ListFolder | null
  onCreated?: (folder: ListFolder) => void
  onDeleted?: () => void
}) {
  const [name, setName] = React.useState(folder?.name ?? '')
  const create = useCreateFolder()
  const update = useUpdateFolder()
  const remove = useDeleteFolder()

  React.useEffect(() => {
    if (open) setName(folder?.name ?? '')
  }, [open, folder?.name])

  const parsed = folderNameSchema.safeParse(name)
  const busy = create.isPending || update.isPending || remove.isPending

  const submit = () => {
    if (!parsed.success || busy) return
    if (folder) {
      update.mutate(
        { id: folder.id, name: parsed.data },
        {
          onSuccess: () => {
            toast({ title: 'Folder renamed' })
            onOpenChange(false)
          },
          onError: (error) => toast({ title: 'Could not rename the folder', description: error.message }),
        },
      )
    } else {
      create.mutate(
        { name: parsed.data },
        {
          onSuccess: (created) => {
            onOpenChange(false)
            onCreated?.(created)
          },
          onError: (error) => toast({ title: 'Could not create the folder', description: error.message }),
        },
      )
    }
  }

  return (
    <MobileSheet
      bodyClassName="leading-[normal] tabular-nums"
      open={open}
      onOpenChange={onOpenChange}
      title={folder ? 'Edit folder' : 'New folder'}
      showClose
      footer={
        <div className="px-4 pt-2.5">
          <button
            type="button"
            onClick={submit}
            disabled={!parsed.success || busy}
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-[14px] text-[15px] font-semibold',
              parsed.success ? 'bg-accent text-white active:bg-accent-strong' : 'bg-m-b3s text-m-t3',
            )}
          >
            {folder ? 'Save' : 'Create folder'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          maxLength={60}
          placeholder="Folder name"
          aria-label="Folder name"
          className="h-[42px] rounded-xl bg-m-b2 px-3 text-[15px] font-medium text-m-t1 outline-none placeholder:text-m-t3"
        />
        {folder && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              remove.mutate(folder.id, {
                onSuccess: () => {
                  toast({ title: 'Folder deleted — lists kept', description: folder.name })
                  onOpenChange(false)
                  onDeleted?.()
                },
                onError: (error) => toast({ title: 'Could not delete the folder', description: error.message }),
              })
            }
            className="self-start py-1 text-[14px] font-semibold text-negative-strong"
          >
            Delete folder
          </button>
        )}
      </div>
    </MobileSheet>
  )
}

/** "Move to folder" for one list: every folder, "Remove from folder", "New folder". */
export function FolderPickSheet({
  open,
  onOpenChange,
  list,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  list: { id: string; title: string; folder_id: string | null }
}) {
  const folders = useFolders()
  const move = useMoveListToFolder()
  const [naming, setNaming] = React.useState(false)

  const moveTo = (folderId: string | null) =>
    move.mutate(
      { listId: list.id, folderId },
      {
        onSuccess: () => {
          toast({ title: folderId ? 'Moved to folder' : 'Removed from folder', description: list.title })
          onOpenChange(false)
        },
        onError: (error) => toast({ title: 'Could not move the list', description: error.message }),
      },
    )

  return (
    <>
      <MobileSheet bodyClassName="leading-[normal] tabular-nums" open={open} onOpenChange={onOpenChange} title="Move to folder" subtitle={list.title} showClose>
        <div className="flex flex-col px-3 pb-2">
          {folders.isError && (
            <p className="px-2 py-3 text-[13px] font-medium text-m-t3">Your folders could not be loaded.</p>
          )}
          {(folders.data ?? []).map((folder) => {
            const current = list.folder_id === folder.id
            return (
              <SheetRow
                key={folder.id}
                icon={<LIcon name="folder" size={16} />}
                label={folder.name}
                disabled={current || move.isPending}
                trailing={current ? <MIcon name="check" size={14} stroke={2.2} className="text-accent" /> : null}
                onClick={() => moveTo(folder.id)}
              />
            )
          })}
          {list.folder_id && (
            <SheetRow
              icon={<MIcon name="close" size={14} stroke={2} />}
              label="Remove from folder"
              disabled={move.isPending}
              onClick={() => moveTo(null)}
            />
          )}
          <SheetRow
            icon={<LIcon name="plus" size={14} stroke={2.2} />}
            label="New folder"
            onClick={() => {
              onOpenChange(false)
              setNaming(true)
            }}
          />
        </div>
      </MobileSheet>
      <FolderNameSheet open={naming} onOpenChange={setNaming} onCreated={(folder) => moveTo(folder.id)} />
    </>
  )
}

/** A 48px sheet row (the league Menu sheet's row language). */
export function SheetRow({
  icon,
  label,
  sub,
  trailing,
  onClick,
  disabled,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  sub?: string
  trailing?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-12 items-center gap-3 rounded-xl px-2 text-left active:bg-m-b2 disabled:opacity-60"
    >
      <span
        className={cn(
          'flex size-8 flex-none items-center justify-center rounded-[9px] bg-m-b2',
          tone === 'danger' ? 'text-negative-strong' : 'text-m-t1',
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[15px] font-semibold',
          tone === 'danger' ? 'text-negative-strong' : 'text-m-t1',
        )}
      >
        {label}
      </span>
      {sub ? <span className="whitespace-nowrap text-[12px] font-medium text-m-t3">{sub}</span> : null}
      {trailing}
    </button>
  )
}
